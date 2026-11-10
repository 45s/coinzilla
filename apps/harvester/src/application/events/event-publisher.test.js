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

test("preserves explicit terminal recovery metadata from a failed durable flush", async () => {
  const recoveryFailure = {
    category: "DURABILITY",
    stage: "JOURNAL_WRITE_FAILURE",
    retryable: false,
  }
  const publisher = makeEventPublisher({
    eventBus: { publish: () => ({ ok: true }) },
    flush: async () => ({
      ok: false,
      errors: [new Error("Journal writer is permanently failed")],
      recoveryFailure,
    }),
    logger: { error() {} },
  })

  const result = await publisher.flush()

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.recoveryFailure,
    recoveryFailure,
    "The event publisher must not discard the Journal's explicit terminal failure classification.",
  )
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


test("exposes structured failure reporting for lifecycle DTO mapping errors", () => {
  const logs = []
  const publisher = makeEventPublisher({
    eventBus: {
      publish: () => ({ ok: true }),
    },
    flush: async () => ({ ok: true, durable: true }),
    logger: { error: (entry) => logs.push(entry) },
  })
  const error = new TypeError("broker transactionTime must be a non-negative safe integer")

  publisher.reportFailure({ event: { name: "order.updated" }, error })

  assert.equal(logs.length, 1, "A mapper failure must be sent through the event publisher's structured logger.")
  assert.equal(logs[0].eventName, "order.updated", "The diagnostic must identify the lifecycle event that could not be mapped.")
  assert.equal(logs[0].error, error, "The diagnostic must retain the original mapper error.")
})
