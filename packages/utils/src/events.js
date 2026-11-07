import { EventEmitter } from 'node:events'

/** @typedef {{ PRICE_UPDATE: 'PRICE_UPDATE' }} EventNames */

/** Shared event-name constants used by package consumers. @type {EventNames} */
export const EVENTS = {
  PRICE_UPDATE: 'PRICE_UPDATE',
}

/**
 * Shared Node.js event emitter singleton.
 * Consumers that subscribe with `on` or `once` must remove listeners when
 * their lifecycle ends; this instance is shared across importing modules.
 * @type {EventEmitter}
 */
export const eventEmitter = new EventEmitter()
