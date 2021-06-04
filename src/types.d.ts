import Sequence from './sequence';

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
  timestamp?: string | Date;
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
  notifications?: Notifications;
}

export interface Notifications {
  discord: boolean | any;
}

export type APIEventPayload = SequenceEvent & {
  type: SequenceEventType;
  distinctId: string;
  properties: {
    $library: string;
    $libraryVersion: string;
    [k: string]: any;
  };
  messageId: string;
};

export type SequenceEventType = 'alert' | 'alias' | 'track';

export interface QueueItem {
  message: APIEventPayload;
  callback: CallbackFunction;
}

export type CallbackFunction = (error?: any, data?: any) => void;

export default Sequence;
