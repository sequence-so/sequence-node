import {
  EventPayload,
  CallbackFunction,
  Track,
  SequenceEventType,
  SequenceOptions,
  Identify,
  BaseEvent,
} from './types';
import assert from 'assert';
import removeSlash from 'remove-trailing-slash';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { version } from '../package.json';
import uniqid from 'uniqid';
import { QueueItem } from './types';
import md5 from 'md5';
import { v4 as uuid } from 'uuid';
const looselyValidate = require('@segment/loosely-validate-event');

const setImmediate = global.setImmediate || process.nextTick.bind(process);
const noop = () => {};
const DEFAULT_HOST = 'https://e.sequence.com';
const BATCH_UPLOAD_API = 'event/batch/';
const DEFAULT_FLUSH_AT = 20;
const DEFAULT_FLUSH_INTERVAL = 10000;

/**
 * NodeJS SDK for sending data to Sequence. Accepts track() and identify() calls right now.
 */
class Sequence {
  /**
   * Initialize a new `Sequence` with your Sequence project's `apiKey` and an
   * optional dictionary of `options`.
   *
   * @param {String} apiKey
   * @param {Object} [options] (optional)
   *   @property {Number} flushAt (default: 20)
   *   @property {Number} flushInterval (default: 10000)
   *   @property {String} host (default: 'https://e.sequence.com')
   *   @property {Boolean} enable (default: true)
   */
  queue: QueueItem[];
  apiKey: string;
  host: string;
  timeout: number | boolean;
  /**
   * Minimum number of items in queue to flush at.
   */
  flushAt: number;
  flushInterval: number;
  flushed: boolean;
  enable: boolean;
  timer: NodeJS.Timeout;
  constructor(apiKey: string, _options?: SequenceOptions) {
    const options: SequenceOptions = _options || {};

    assert(apiKey, "You must pass your Sequence project's api key.");

    this.queue = [];
    this.apiKey = apiKey;
    this.host = removeSlash(options.host || DEFAULT_HOST);
    this.timeout = options.timeout || false;
    this.flushAt = options.flushAt && Number.isInteger(options.flushAt) ? options.flushAt : DEFAULT_FLUSH_AT;
    this.flushInterval = options.flushInterval || DEFAULT_FLUSH_INTERVAL;
    this.flushed = false;
    this.enable = typeof options.enable === 'boolean' ? options.enable : true;
    this.timer = null;
    Object.defineProperty(this, 'enable', {
      configurable: false,
      writable: false,
      enumerable: true,
      value: typeof options.enable === 'boolean' ? options.enable : true,
    });

    axiosRetry(axios, {
      retries: options.retryCount || 3,
      retryCondition: this._isErrorRetryable,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  _validate(event: BaseEvent, type: SequenceEventType) {
    looselyValidate(event, type);
  }

  track(event: Track, callback?: CallbackFunction) {
    this._validate(event, 'track');
    this.enqueue('track', event, callback);
    return this;
  }

  identify(event: Identify, callback?: CallbackFunction) {
    this._validate(event, 'identify');
    this.enqueue('identify', event, callback);
    return this;
  }

  /**
   * Add a event to the queue and
   * checks whether it should be flushed.
   *
   * @param {String} event
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @api private
   */
  enqueue(event: SequenceEventType, message: Track | Identify, callback?: CallbackFunction) {
    callback = callback || noop;

    if (!this.enable) {
      return setImmediate(callback);
    }

    let payload: EventPayload = {
      ...message,
      _metadata: {
        nodeVersion: process.versions.node,
      },
      type: event,
      userId: message.userId,
      timestamp: message.timestamp ?? new Date(),
      messageId: message.messageId ?? uniqid(),
      context: {
        library: {
          sdk: 'sequence-node',
          version: version,
        },
      },
      sentAt: null,
      receivedAt: null,
    };

    if (!payload.messageId) {
      payload.messageId = `node-${md5(JSON.stringify(payload))}-${uuid()}`;
    }

    this.queue.push({ message: payload, callback });

    if (!this.flushed) {
      this.flushed = true;
      this.flush();
      return;
    }

    if (this.queue.length >= this.flushAt) {
      this.flush();
    }

    if (this.flushInterval && !this.timer) {
      this.timer = setTimeout(this.flush.bind(this), this.flushInterval);
    }
  }

  /**
   * Flush the current queue
   *
   * @param {Function} [callback] (optional)
   * @return {Sequence}
   */

  async flush(callback?: (error?: Error, data?: any) => void) {
    const originalCallback = callback;
    callback = callback || noop;

    if (!this.enable) {
      return setImmediate(callback);
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.queue.length) {
      return setImmediate(callback);
    }

    const items = this.queue.splice(0, this.flushAt);
    const callbacks = items.map((item) => item.callback);
    const messages = items.map((item) => {
      item.message.sentAt = new Date();
      return item.message;
    });

    const data = {
      batch: messages,
      sentAt: new Date(),
    };

    const done = (err?: any, data?: any) => {
      callbacks.forEach((callback) => callback(err, data));
      callback && callback(err, data);
    };

    const headers: any = {
      'user-agent': `sequence-node/${version}`,
      Authorization: `Bearer ${this.apiKey}`,
    };

    const req: any = {
      method: 'POST',
      url: `${this.host}/${BATCH_UPLOAD_API}`,
      data,
      headers,
    };

    if (this.timeout) {
      req.timeout = this.timeout;
    }

    if (originalCallback) {
      return axios(req)
        .then((res) => done(null, res))
        .catch((err: any) => {
          if (err.response) {
            // console.error(err);
            const error = new Error(err.response.statusText);
            return done(error);
          }

          done(err);
        });
    }
    return new Promise((resolve, reject) => {
      axios(req)
        .then((res) => {
          done(null, res);
          resolve(res);
        })
        .catch((err: any) => {
          if (err.response) {
            // console.error(err);
            const error = new Error(err.response.statusText);
            done(error);
            return reject(error);
          }

          done(err);
          reject(err);
        });
    });
  }

  _isErrorRetryable(error: any) {
    // Retry Network Errors.
    if (axiosRetry.isNetworkError(error)) {
      return true;
    }

    if (!error.response) {
      // Cannot determine if the request can be retried
      return false;
    }

    // Retry Server Errors (5xx).
    if (error.response.status >= 500 && error.response.status <= 599) {
      return true;
    }

    // Retry if rate limited.
    if (error.response.status === 429) {
      return true;
    }

    return false;
  }
}

export default Sequence;
