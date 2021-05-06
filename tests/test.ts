import { Server } from 'http';
import sinon from 'ts-sinon';
import express from 'express';
import delay from 'delay';
import { expect, should as chaiShould } from 'chai';
const should = chaiShould();
const pify = require('pify');
const version = require('../package.json').version;
import Sequence, { APIEventPayload, SequenceEvent, SequenceOptions } from '../src/types';

const spy = sinon.spy;
const stub = sinon.stub;
const noop = () => {};

const port = 6042;
const PAYLOAD: SequenceEvent = { timestamp: new Date(), name: 'My Custom Alert', message: 'New customer' };
const INTERNAL_PAYLOAD: APIEventPayload = {
  type: 'alert',
  distinctId: 'abcdef',
  properties: { $library: 'sequence-node', $library_version: version },
  timestamp: new Date(),
  name: 'My Custom Alert',
  message: 'New customer',
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
        // console.log('shut it down 1');
        return res.status(400).json({
          error: { message: 'missing api key' },
        });
      }

      const ua = req.headers['user-agent'];
      if (ua !== `sequence-node/${version}`) {
        // console.log('shut it down 2');
        return res.status(400).json({
          error: { message: 'invalid user-agent' },
        });
      }

      if ((batch[0] as APIEventPayload).message === 'Error') {
        // console.log('shut it down 3');
        return res.status(400).json({
          error: { message: 'error' },
        });
      }

      if ((batch[0] as APIEventPayload).message === 'Timeout') {
        return setTimeout(() => res.end(), 5000);
      }

      res.json({});
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
    client.host.should.eq('https://e.sequence.com');
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
    client.enqueue('alert', '1234', { timestamp, name: 'My Custom Alert', message: 'New customer' }, noop);

    client.queue.length.should.eq(1);

    const item = client.queue.pop();

    item.should.deep.eq({
      message: {
        timestamp,
        type: 'alert',
        name: 'My Custom Alert',
        message: 'New customer',
        properties: {
          $library: 'sequence-node',
          $library_version: version,
        },
        distinctId: '1234',
      },
      callback: noop,
    });
  });
  it('should flush on first message', () => {
    const client = createClient({ flushAt: 2 });
    client.flushed = false;
    const flushSpy = spy(client, 'flush');

    // flush on first message
    client.enqueue('alert', '1234', PAYLOAD, noop);
    flushSpy.calledOnce.should.be.true;

    // shouldn't flush - flushAt is 2
    client.enqueue('alert', '1234', PAYLOAD, noop);
    flushSpy.calledOnce.should.be.true;

    // now we flush
    client.enqueue('alert', '1234', PAYLOAD, noop);
    flushSpy.calledTwice.should.be.true;
  });
  it('should flush the queue if it hits the max length', () => {
    const client = createClient({
      flushAt: 3,
      flushInterval: null,
    });
    client.flushed = true;

    const flushStub = stub(client, 'flush');

    client.enqueue('alert', '5678', PAYLOAD);
    flushStub.calledOnce.should.be.false;
    client.enqueue('alert', '5678', PAYLOAD);
    flushStub.calledOnce.should.be.false;
    client.enqueue('alert', '5678', PAYLOAD);
    flushStub.calledOnce.should.be.true;
  });
  it('should flush after a period of time', async () => {
    const client = createClient({ flushInterval: 10 });
    const flushStub = stub(client, 'flush');

    client.enqueue('alert', 'abc', PAYLOAD);

    flushStub.calledOnce.should.be.false;
    await delay(20);

    flushStub.calledOnce.should.be.true;
  });
  it("enqueue - don't reset an existing timer", async () => {
    const client = createClient({ flushInterval: 10 });
    const flushStub = stub(client, 'flush');

    client.enqueue('alert', 'abc', PAYLOAD);
    await delay(5);
    client.enqueue('alert', 'abc', PAYLOAD);
    await delay(5);

    flushStub.calledOnce.should.be.true;
  });
  it('should skip when client is disabled', async () => {
    const client = createClient({ enable: false });
    const flushStub = stub(client, 'flush');

    const callback = spy();
    client.enqueue('alert', '1234', PAYLOAD, callback);
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

    const messageA: APIEventPayload = { ...INTERNAL_PAYLOAD, name: 'Alert Event A' };
    const messageB: APIEventPayload = { ...INTERNAL_PAYLOAD, name: 'Alert Event B' };
    const messageC: APIEventPayload = { ...INTERNAL_PAYLOAD, name: 'Alert Event C' };

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
    Object.keys(data).should.deep.eq(['batch']);
    data.batch.should.deep.eq([messageA, messageB]);
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

describe('alert', () => {
  it('should enqueue a message', () => {
    const client = createClient({
      flushAt: 5,
    });
    client.flushed = true;
    const enqueueSpy = spy(client, 'enqueue');
    const apiMessage: APIEventPayload = {
      ...PAYLOAD,
      distinctId: '1234',
      type: 'alert',
      properties: { ...PAYLOAD.properties, $library: 'sequence-node', $library_version: version },
    };

    client.queue.length.should.eq(0);
    client.alert('1234', PAYLOAD, noop);
    enqueueSpy.calledOnce.should.be.true;
    enqueueSpy.firstCall.args.should.deep.eq(['alert', '1234', PAYLOAD, noop]);
    client.queue.should.deep.eq([{ message: apiMessage, callback: noop }]);
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

    const event: SequenceEvent = { ...PAYLOAD, properties: {} };
    for (var i = 0; i < 10000; i++) {
      event.properties[`${i}`] = 'a';
    }

    expect(() => client.alert('12345', event)).to.throw('Your message must be < 32kb.');
  });
});
