import { Server } from 'http';
import sinon from 'ts-sinon';
import express from 'express';
import delay from 'delay';
import { expect, should as chaiShould } from 'chai';
import pify from 'pify';
import Sequence, { EventPayload, Track, SequenceOptions } from '../src/types';
import { version } from '../package.json';

const should = chaiShould();
const spy = sinon.spy;
const stub = sinon.stub;
const noop = () => {};

const port = 6042;
const PAYLOAD: Track = { userId: '1234', timestamp: null, event: 'User Registered' };
const INTERNAL_PAYLOAD: EventPayload = {
  type: 'track',
  userId: 'abcdef',
  properties: { firstName: 'Tom', lastName: 'Jones' },
  context: {
    library: {
      sdk: 'sequence-node',
      version: version,
    },
  },
  timestamp: new Date(),
  event: 'My Custom Event',
  messageId: 'random',
  sentAt: null,
  receivedAt: null,
};

const createClient = (_options?: SequenceOptions) => {
  const options: SequenceOptions = {
    host: `http://localhost:${port}`,
    ..._options,
  };

  const client = new Sequence('key', options);
  client.flush = pify(client.flush.bind(client));
  client.flushed = true;

  return client;
};

let server: Server = null;

before((done) => {
  server = express()
    .use(express.json())
    .post('/event/batch', (req: express.Request, res: any) => {
      const { authorization } = req.headers;
      const { batch } = req.body;

      if (!authorization) {
        return res.status(400).json({
          error: { message: 'missing api key' },
        });
      }

      const ua = req.headers['user-agent'];
      if (ua !== `sequence-node/${version}`) {
        return res.status(400).json({
          error: { message: 'invalid user-agent' },
        });
      }

      if ((batch[0] as any).message === 'Error') {
        return res.status(400).json({
          error: { message: 'error' },
        });
      }

      if ((batch[0] as any).message === 'Timeout') {
        return setTimeout(() => res.end(), 5000);
      }

      res.json({
        success: true,
      });
    })
    .listen(port, done);
});

after(() => {
  server.close();
});

describe('constructor', () => {
  it('should expose a constructor', () => {
    (typeof Sequence).should.equal('function');
  });
  it('require a api key', () => {
    // @ts-ignore
    should.Throw(() => new Sequence(), "You must pass your Sequence project's api key.");
  });

  it('create a queue', () => {
    const client = createClient();
    client.queue.should.deep.eq([]);
  });

  it('default options', () => {
    const client = new Sequence('key');
    client.apiKey.should.eq('key');
    client.host.should.eq('https://e.sequence.so');
    client.flushAt.should.eq(20);
    client.flushInterval.should.eq(10000);
  });

  it('should remove trailing slashes from host', () => {
    const client = new Sequence('key', { host: 'http://google.com///' });
    client.host.should.eq('http://google.com');
  });

  it('should overwrite defaults with options', () => {
    const client = new Sequence('key', {
      host: 'a',
      flushAt: 1,
      flushInterval: 2,
    });

    client.host.should.eq('a');
    client.flushAt.should.eq(1);
    client.flushInterval.should.eq(2);
  });
});

describe('enqueue', () => {
  it('should add a message to the queue', () => {
    const client = createClient();

    const timestamp = new Date();
    client.enqueue(
      'track',
      { userId: '1234', timestamp, event: 'User Registered', messageId: '14oxud1gkpm64vo2' },
      noop,
    );

    client.queue.length.should.eq(1);

    const item = client.queue.pop();

    item.should.deep.eq({
      message: {
        _metadata: {
          nodeVersion: '16.2.0',
        },
        timestamp,
        type: 'track',
        context: {
          library: {
            sdk: 'sequence-node',
            version: version,
          },
        },
        event: 'User Registered',
        messageId: '14oxud1gkpm64vo2',
        receivedAt: null,
        sentAt: null,
        userId: '1234',
      },
      callback: noop,
    });
  });
  it('should flush on first message', () => {
    const client = createClient({ flushAt: 2 });
    client.flushed = false;
    const flushSpy = spy(client, 'flush');

    // flush on first message
    client.enqueue('track', PAYLOAD, noop);
    flushSpy.calledOnce.should.be.true;

    // shouldn't flush - flushAt is 2
    client.enqueue('track', PAYLOAD, noop);
    flushSpy.calledOnce.should.be.true;

    // now we flush
    client.enqueue('track', PAYLOAD, noop);
    flushSpy.calledTwice.should.be.true;
  });
  it('should flush the queue if it hits the max length', () => {
    const client = createClient({
      flushAt: 3,
      flushInterval: null,
    });
    client.flushed = true;

    const flushStub = stub(client, 'flush');

    client.enqueue('track', PAYLOAD);
    flushStub.calledOnce.should.be.false;
    client.enqueue('track', PAYLOAD);
    flushStub.calledOnce.should.be.false;
    client.enqueue('track', PAYLOAD);
    flushStub.calledOnce.should.be.true;
  });
  it('should flush after a period of time', async () => {
    const client = createClient({ flushInterval: 10 });
    const flushStub = stub(client, 'flush');

    client.enqueue('track', PAYLOAD);

    flushStub.calledOnce.should.be.false;
    await delay(20);

    flushStub.calledOnce.should.be.true;
  });
  it("enqueue - don't reset an existing timer", async () => {
    const client = createClient({ flushInterval: 10 });
    const flushStub = stub(client, 'flush');

    client.enqueue('track', PAYLOAD);
    await delay(5);
    client.enqueue('track', PAYLOAD);
    await delay(5);

    flushStub.calledOnce.should.be.true;
  });
  it('should skip when client is disabled', async () => {
    const client = createClient({ enable: false });
    const flushStub = stub(client, 'flush');

    const callback = spy();
    client.enqueue('track', PAYLOAD, callback);
    await delay(5);

    callback.calledOnce.should.be.true;
    flushStub.notCalled.should.be.true;
  });
});

describe('flush', () => {
  it("shouldn't fail when queue is empty", () => {
    const client = createClient();
    expect(() => client.flush()).to.not.throw;
  });
  it('should send messages', async () => {
    const client = createClient({ flushAt: 2 });

    const callbackA = spy();
    const callbackB = spy();
    const callbackC = spy();

    const messageA: EventPayload = { ...INTERNAL_PAYLOAD, event: 'Event A' };
    const messageB: EventPayload = { ...INTERNAL_PAYLOAD, event: 'Event B' };
    const messageC: EventPayload = { ...INTERNAL_PAYLOAD, event: 'Event C' };

    client.queue = [
      {
        message: messageA,
        callback: callbackA,
      },
      {
        message: messageB,
        callback: callbackB,
      },
      {
        message: messageC,
        callback: callbackC,
      },
    ];

    const data = await client.flush();
    data.data.success.should.eq(true);
    Object.keys(data).should.deep.eq(['status', 'statusText', 'headers', 'config', 'request', 'data']);
    callbackA.calledOnce.should.be.true;
    callbackB.calledOnce.should.be.true;
    callbackC.called.should.be.false;
  });

  it('respond with an error', (cb) => {
    const client = createClient();
    const callback = spy();

    const payload = { ...INTERNAL_PAYLOAD, message: 'Error' };
    client.queue = [
      {
        message: payload,
        callback,
      },
    ];
    let error: Error;
    client.flush((_error) => {
      error = _error;
      callback.calledOnce.should.be.true;
      error.message.should.eq('Bad Request');
      cb();
    });
  });
  it('should time out if configured', (cb) => {
    const client = createClient({ timeout: 500 });
    const callback = spy();
    const payload = { ...INTERNAL_PAYLOAD, message: 'Timeout' };

    client.queue = [
      {
        message: payload,
        callback,
      },
    ];
    client.flush((error) => {
      callback.calledOnce.should.be.true;
      error.message.should.eq('timeout of 500ms exceeded');
      cb();
    });
  });
  it('should skip when client is disabled', (cb) => {
    const client = createClient({ enable: false });
    const callback = spy();

    client.queue = [
      {
        message: INTERNAL_PAYLOAD,
        callback,
      },
    ];

    client.flush(() => {
      cb();
      callback.called.should.be.false;
    });
  });
});

describe('track', () => {
  it('should enqueue a message', () => {
    const clock = sinon.useFakeTimers();
    const client = createClient({
      flushAt: 5,
    });
    client.flushed = true;
    const enqueueSpy = spy(client, 'enqueue');
    const eventPayload = { ...PAYLOAD, messageId: 'random' };
    const apiMessage: EventPayload = {
      userId: PAYLOAD.userId,
      event: PAYLOAD.event,
      type: 'track',
      context: {
        library: {
          sdk: 'sequence-node',
          version: version,
        },
      },
      _metadata: {
        nodeVersion: process.versions.node,
      },
      messageId: 'random',
      receivedAt: null,
      sentAt: null,
      timestamp: new Date(),
    };

    client.queue.length.should.eq(0);
    client.track(eventPayload, noop);
    enqueueSpy.calledOnce.should.be.true;
    enqueueSpy.firstCall.args.should.deep.eq(['track', eventPayload, noop]);
    client.queue.should.deep.eq([{ message: apiMessage, callback: noop }]);
    clock.restore();
  });
});

describe('isErrorRetryable', () => {
  it('should retry', () => {
    const client = createClient();

    client._isErrorRetryable({}).should.be.false;

    // ETIMEDOUT is retryable as per `is-retry-allowed` (used by axios-retry in `isNetworkError`).
    client._isErrorRetryable({ code: 'ETIMEDOUT' }).should.be.true;

    // ECONNABORTED is not retryable as per `is-retry-allowed` (used by axios-retry in `isNetworkError`).
    client._isErrorRetryable({ code: 'ECONNABORTED' }).should.be.false;

    client._isErrorRetryable({ response: { status: 500 } }).should.be.true;
    client._isErrorRetryable({ response: { status: 429 } }).should.be.true;

    client._isErrorRetryable({ response: { status: 200 } }).should.be.false;
  });
});

describe('message size', () => {
  it("shouldn't allow messages > 32kb", () => {
    const client = createClient();

    const event: Track = { ...PAYLOAD, properties: {} };
    for (var i = 0; i < 10000; i++) {
      event.properties[`${i}`] = 'a';
    }

    expect(() => client.track(event)).to.throw('Your message must be < 32kb.');
  });
});
