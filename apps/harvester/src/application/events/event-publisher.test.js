import test from "node:test"
import assert from "node:assert/strict"
import { makeEventPublisher } from "./event-publisher.js"

test("publishes events and delegates durable flush", async () => {
  const events = []
  const publisher = makeEventPublisher({
    eventBus: { publish: (event) => { events.push(event); return { ok: true } } },
    flush: async () => ({ ok: true, durable: true }),
    logger: { error() {} },
  })
  const event = { name: "account.snapshot_captured" }
  assert.deepEqual(publisher.publish(event), { ok: true })
  assert.deepEqual(events, [event])
  assert.deepEqual(await publisher.flush(), { ok: true, durable: true })
})

test("fails closed when durable flush is unavailable or fails", async () => {
  const eventBus = { publish: () => ({ ok: true }) }
  const withoutFlush = makeEventPublisher({ eventBus, logger: { error() {} } })
  const missing = await withoutFlush.flush()
  assert.equal(missing.ok, false)
  assert.match(missing.errors[0].message, /no durable flush capability/)

  const withFailedFlush = makeEventPublisher({
    eventBus,
    flush: async () => ({ ok: false, errors: [new Error("fsync failed")] }),
    logger: { error() {} },
  })
  const failed = await withFailedFlush.flush()
  assert.equal(failed.ok, false)
  assert.match(failed.errors[0].message, /fsync failed/)
})

test("normalizes a thrown flush failure without throwing across the publisher boundary", async () => {
  const publisher = makeEventPublisher({
    eventBus: { publish: () => ({ ok: true }) },
    flush: async () => { throw new Error("disk unavailable") },
    logger: { error() {} },
  })
  const result = await publisher.flush()
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /disk unavailable/)
})
