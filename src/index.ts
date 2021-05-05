const assert = require('assert');
const removeSlash = require('remove-trailing-slash');
import axios from 'axios';
import axiosRetry from 'axios-retry';
const ms = require('ms');
const version = require('../package.json').version;
import looselyValidate from './event-validation';

const setImmediate = global.setImmediate || process.nextTick.bind(process);
const noop = () => {};

export interface SequenceOptions {
  timeout?: number;
  retryCount?: number;
  flushAt?: number;
  flushInterval?: number;
  host?: string;
  enable?: boolean;
}

export interface SequenceEvent {
  /**
   * Defines the name of the event.
   */
  name: string;
  /**
   * The body text of the alert. Can be overriden perintegration by providing
   * custom options in the "actions" key.
   */
  message: string;
  /**
   * Timestamp of the event.
   */
  timestamp?: Date;
  /**
   * Custom properties on the event.
   */
  properties?: {
    [k: string]: any;
  };
  /** Properties for segmenting users by an Account (aka Company). */
  account?: {
    /**
     * An unique identifier for a company.
     */
    id: string;
    /**
     * Alias properties for an account.
     */
    [k: string]: any;
  };
  /**
   * Actions that you can perform on to respond to this event.
   */
  actions?: {
    /**
     * Name of the action.
     */
    name: string;
    /**
     * A link for interacting with this event.
     */
    href?: string;
    /**
     * Integration ID. Use this key if you are configuring actions via the web UI.
     */
    integrationId?: string;
  }[];
  /**
   * Defines which integrations get notified on this event.
   */
  notifications?: string[];
}

export type APIEventPayload = SequenceEvent & {
  type: SequenceEventType;
  distinctId: string;
  properties: {
    $library: string;
    $library_version: string;
    [k: string]: any;
  };
};

export type SequenceEventType = 'alert';

interface QueueItem {
  message: APIEventPayload;
  callback: CallbackFunction;
}

type CallbackFunction = (error?: any, data?: any) => void;

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
    this.host = removeSlash(options.host || 'https://e.sequence.com');
    this.timeout = options.timeout || false;
    this.flushAt = options.flushAt && Number.isInteger(options.flushAt) ? options.flushAt : 20;
    this.flushInterval = options.flushInterval || 10000;
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

  _validate(message: SequenceEvent, type: SequenceEventType) {
    looselyValidate(message, type);
  }

  /**
   * Send an alert.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Sequence}
   */

  alert(distinctId: string, message: SequenceEvent, callback?: CallbackFunction) {
    this._validate(message, 'alert');
    this.enqueue('alert', distinctId, message, callback);
    return this;
  }

  /**
   * Add a `message` of type `type` to the queue and
   * check whether it should be flushed.
   *
   * @param {String} type
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @api private
   */

  enqueue(type: SequenceEventType, distinctId: string, incomingEvent: SequenceEvent, callback?: CallbackFunction) {
    callback = callback || noop;

    if (!this.enable) {
      return setImmediate(callback);
    }

    let event: APIEventPayload = {
      ...incomingEvent,
      type: type,
      distinctId,
      properties: {
        ...incomingEvent.properties,
        $library: 'sequence-node',
        $library_version: version,
      },
      timestamp: incomingEvent.timestamp ?? new Date(),
    };

    this.queue.push({ message: event, callback });

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

  flush(callback?: (error?: Error, data?: any) => void) {
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
    const messages = items.map((item) => item.message);

    const data = {
      apiKey: this.apiKey,
      batch: messages,
    };

    const done = (err?: any) => {
      callbacks.forEach((callback) => callback(err));
      callback && callback(err, data);
    };

    const headers: any = {
      'user-agent': `sequence-node/${version}`,
    };

    const req: any = {
      method: 'POST',
      url: `${this.host}/event/batch/`,
      data,
      headers,
    };

    if (this.timeout) {
      req.timeout = typeof this.timeout === 'string' ? ms(this.timeout) : this.timeout;
    }

    axios(req)
      .then(() => done())
      .catch((err: any) => {
        if (err.response) {
          const error = new Error(err.response.statusText);
          return done(error);
        }

        done(err);
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
