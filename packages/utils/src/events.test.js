import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EVENTS, eventEmitter } from './events.js'

describe('events', () => {
  it('defines the price update event name', () => {
    assert.equal(EVENTS.PRICE_UPDATE, 'PRICE_UPDATE')
  })

  it('emits and receives events through the shared emitter', () => {
    const payload = { symbol: 'BTCUSDT', price: 65000 }
    const listener = (received) => {
      assert.deepEqual(received, payload)
    }

    eventEmitter.once(EVENTS.PRICE_UPDATE, listener)
    eventEmitter.emit(EVENTS.PRICE_UPDATE, payload)
    eventEmitter.off(EVENTS.PRICE_UPDATE, listener)
  })
})

it("does not deliver unrelated event names to a listener", () => {
  const received = []
  const listener = (payload) => received.push(payload)
  eventEmitter.on(EVENTS.PRICE_UPDATE, listener)
  try {
    eventEmitter.emit("UNRELATED_EVENT", { ignored: true })
    assert.deepEqual(received, [])
  } finally {
    eventEmitter.off(EVENTS.PRICE_UPDATE, listener)
  }
})
