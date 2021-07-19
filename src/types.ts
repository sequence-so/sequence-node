import Sequence from './sequence';

export interface SequenceOptions {
  timeout?: number;
  retryCount?: number;
  flushAt?: number;
  flushInterval?: number;
  host?: string;
  enable?: boolean;
}

export interface BaseEvent {
  /**
   * Timestamp of the event.
   */
  timestamp?: string | Date;
  /**
   * Custom properties on the event.
   */
  properties?: Record<string, any>;
  /**
   * User ID associated with the event
   */
  userId: string;
  /**
   * Optional: unique message idempotency key.
   */
  messageId?: string;
}

export interface Track extends BaseEvent {
  /**
   * Defines the event name.
   */
  event: string;
  /**
   * Custom properties on the event.
   */
  properties?: Record<string, any>;
}

export interface Identify extends Omit<BaseEvent, 'properties'> {
  /**
   * Custom traits on the user.
   */
  traits?: Record<string, any>;
}

export type EventContext = {
  app?: { name: string; version: string; namespace: string };
  device?: {
    id: string;
    advertisingId: string;
    manufacturer: string;
    model: string;
    type: string;
  };
  library?: {
    sdk: string;
    version: string;
  };
  ip?: string;
  locale?: string;
  os?: {
    version: string;
  };
};

export interface EventPayload extends BaseEvent {
  /**
   * Defines the event type.
   */
  type: SequenceEventType;
  /**
   * Properties object used for track calls.
   */
  properties?: Record<string, any>;
  /**
   * Traits object used for identify calls.
   */
  traits?: Record<string, any>;
  /**
   * Idempotency key
   */
  messageId: string;
  /**
   * Name of event from track call
   */
  event?: string;
  sentAt: Date;
  context: EventContext;
  /**
   * Set on the server when the message is received.
   */
  receivedAt: Date | null;
  _metadata?: Record<string, any>;
}

export type SequenceEventType = 'track' | 'identify';

export interface QueueItem {
  message: EventPayload;
  callback: CallbackFunction;
}

export type CallbackFunction = (error?: any, data?: any) => void;

export default Sequence;
