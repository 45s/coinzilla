import { EventEmitter } from 'node:events'

export const EVENTS = {
  PRICE_UPDATE: 'PRICE_UPDATE',
}

export const eventEmitter = new EventEmitter()
