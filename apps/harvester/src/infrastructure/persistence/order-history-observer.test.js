import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createOrderHistoryObserver } from "./create-order-history-observer.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

function publishOrderLifecycleFixtures(eventBus) {
  const publish = ({ name, data }) => eventBus.publish({
    name,
    source: "harvester",
    data,
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
    data: createOrderHistoryEventData({
    status: "FILLED",
    executedQuantity: "1.0000",
    remainingQuantity: "0.0000",
    }),
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    data: createOrderHistoryEventData(),
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    data: createOrderHistoryEventData({
    executedQuantity: "1.0000",
    remainingQuantity: "0.0000",
    status: "FILLED",
    updatedAt: 200,
    }),
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_CANCELLED,
    data: createOrderHistoryEventData({
    status: "CANCELED",
    executedQuantity: "0.2500",
    }),
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED,
    data: createOrderHistoryEventData({
    status: "UNKNOWN",
    executedQuantity: "0.2500",
    }),
  })
  publish({
    name: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
    data: createOrderHistoryEventData({
    status: "OPEN",
    executedQuantity: "0.0000",
    remainingQuantity: "1.0000",
    }),
  })
}

test("projects immediate acknowledgements, partial fills, final fills, and partial cancellations", async (t) => {
  const eventBus = new EventBus()
  const records = []
  const repository = {
    upsert: async (record) => {
      records.push(record)
      return record
    },
  }
  const observer = createOrderHistoryObserver({
    eventBus,
    repository,
    environment: "testnet",
  })
  t.after(async () => {
    await observer.close()
    await eventBus.close()
  })

  publishOrderLifecycleFixtures(eventBus)

  await eventBus.flush()
  const result = await observer.flush()

  assert.equal(result.ok, true, "Valid order lifecycle events must drain without projection errors.")
  assert.equal(records.length, 5, "Only orders with positive cumulative execution must be projected.")
  assert.equal(records[0].status, "FILLED", "A fully filled acknowledgement must be persisted immediately.")
  assert.equal(records[1].executedQuantity, "0.2500", "A partial fill must be persisted from the canonical order update.")
  assert.equal(records[2].status, "FILLED", "The final fill must update the same logical order identity.")
  assert.equal(records[3].status, "CANCELED", "A partially filled order must retain its later cancellation state.")
  assert.equal(records[4].status, "UNKNOWN", "A partially filled order must retain an unconfirmed cancellation state.")
})

test("bounds pending writes and reports queue overflow without throwing into EventBus", async (t) => {
  const eventBus = new EventBus()
  const logEntries = []
  let releaseWrite
  const blockedWrite = new Promise((resolve) => {
    releaseWrite = resolve
  })
  const repository = {
    upsert: async () => blockedWrite,
  }
  const observer = createOrderHistoryObserver({
    eventBus,
    repository,
    environment: "testnet",
    maxPending: 1,
    logger: {
      error: (entry) => logEntries.push(entry),
    },
  })
  t.after(async () => {
    releaseWrite()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData({
      clientOrderId: "harvester-BTCUSDT-002",
    }),
  })
  await eventBus.flush()

  assert.equal(observer.getDiagnostics().pendingCount, 1, "The observer must not exceed its configured write queue bound.")
  assert.equal(observer.getDiagnostics().droppedCount, 1, "Queue overflow must be counted as an observable history gap.")
  assert.equal(logEntries[0].errorCode, "HARVESTER_ORDER_HISTORY_QUEUE_FULL", "Queue overflow must emit a stable diagnostic code.")

  releaseWrite()
  await observer.flush()
})

test("isolates repository failures without rejecting EventBus delivery", async (t) => {
  const eventBus = new EventBus()
  const logEntries = []
  const repository = {
    upsert: async () => {
      throw new Error("database filename must not be logged")
    },
  }
  const observer = createOrderHistoryObserver({
    eventBus,
    repository,
    environment: "testnet",
    logger: {
      error: (entry) => logEntries.push(entry),
    },
  })
  t.after(async () => {
    await observer.close()
    await eventBus.close()
  })

  const publication = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  assert.equal(publication.ok, true, "A history repository failure must not reject the order lifecycle publisher.")
  await eventBus.flush()
  const result = await observer.flush()

  assert.equal(result.ok, false, "A failed database projection must be visible to the observer flush result.")
  assert.equal(logEntries.length, 1, "A failed projection must be reported exactly once.")
  assert.equal(logEntries[0].message, "Order history projection failed", "Projection diagnostics must use a stable message.")
  assert.equal(logEntries[0].errorMessage, undefined, "Raw database errors must not leak paths or provider details.")
})

test("drains accepted writes on close and unsubscribes before later events", async (t) => {
  const eventBus = new EventBus()
  let releaseWrite
  let writes = 0
  const blockedWrite = new Promise((resolve) => {
    releaseWrite = resolve
  })
  const repository = {
    upsert: async () => {
      writes += 1
      return blockedWrite
    },
  }
  const observer = createOrderHistoryObserver({
    eventBus,
    repository,
    environment: "testnet",
  })
  t.after(async () => {
    releaseWrite()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await eventBus.flush()
  const closePromise = observer.close()
  let closeFinished = false
  closePromise.then(() => {
    closeFinished = true
  })
  await Promise.resolve()

  assert.equal(writes, 1, "The accepted order update must be queued exactly once.")
  assert.equal(closeFinished, false, "Observer close must wait for accepted database writes to drain.")
  releaseWrite()
  await closePromise
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData({
      clientOrderId: "harvester-BTCUSDT-002",
    }),
  })
  await eventBus.flush()

  assert.equal(writes, 1, "Events published after observer close must not enqueue database writes.")
})
