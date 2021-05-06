import { SequenceEvent, SequenceEventType } from './types';

var type = require('component-type');
var join = require('join-component');
var assert = require('assert');

// Sequence messages can be a maximum of 32kb.
var MAX_SIZE = 32 << 10;

/**
 * Validate an event.
 */

export default function eventValidation(event: SequenceEvent, type: SequenceEventType) {
  validateGenericEvent(event);
  assert(type, 'You must pass an event type.');
  switch (type) {
    case 'alert':
      return validateAlertEvent(event);
    default:
      assert(0, 'Invalid event type: "' + type + '"');
  }
}

/**
 * Validate a "capture" event.
 */

function validateAlertEvent(event: SequenceEvent) {
  assert(event.message, 'You must pass a "message".');
  assert(event.name, 'You must pass a "name".');
}

/**
 * Validation rules.
 */

const genericValidationRules = {
  event: 'string',
  properties: 'object',
  alias: 'string',
  timestamp: 'date',
  distinctId: 'string',
  type: 'string',
};

interface GenericValidationRules {
  event: string;
  properties: string;
  alias: string;
  timestamp: string;
  distinctId: string;
  type: string;
}

type GenericValidationKeys = keyof GenericValidationRules;

/**
 * Validate an event object.
 */

function validateGenericEvent(event: any) {
  assert(type(event) === 'object', 'You must pass a message object.');
  let json = JSON.stringify(event);
  // Strings are variable byte encoded, so json.length is not sufficient.
  assert(Buffer.byteLength(json, 'utf8') < MAX_SIZE, 'Your message must be < 32kb.');

  Object.keys(genericValidationRules).forEach((key: string) => {
    let val = event[key];
    if (!val) {
      return;
    }
    let rule: string | string[] = genericValidationRules[key as GenericValidationKeys];
    if (type(rule) !== 'array') {
      rule = [rule];
    }
    let a = rule[0] === 'object' ? 'an' : 'a';
    assert(
      Array.isArray(rule) &&
        rule.some(function (e) {
          return type(val) === e;
        }),
      '"' + key + '" must be ' + a + ' ' + join(rule, 'or') + '.',
    );
  });
}
