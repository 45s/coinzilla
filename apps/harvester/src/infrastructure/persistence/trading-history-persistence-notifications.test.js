import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { createFillHistoryObserver } from "./create-fill-history-observer.js"
import { createOrderHistoryObserver } from "./create-order-history-observer.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

const HISTORY_UPDATED_EVENT = "trading-history.updated"

function subscribeToHistoryChanges(eventBus, notifications) {
  const result = eventBus.subscribe({
    name: HISTORY_UPDATED_EVENT,
    handler: (event) => notifications.push(event.data.resources),
  })
  assert.equal(result.ok, true, "The notification test must subscribe to persisted-history change events.")
  return result.subscription
}

test("publishes an order-history notification only after the order upsert succeeds", async (t) => {
  const eventBus = new EventBus()
  const notifications = []
  let finishUpsert
  const pendingUpsert = new Promise((resolve) => {
    finishUpsert = resolve
  })
  const observer = createOrderHistoryObserver({
    eventBus,
    repository: {
      upsert: () => pendingUpsert,
    },
    environment: "testnet",
  })
  const subscription = subscribeToHistoryChanges(eventBus, notifications)
  t.after(async () => {
    finishUpsert()
    subscription.unsubscribe()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await eventBus.flush()

  assert.deepEqual(notifications, [], "An order change must not be announced while its database upsert is pending.")

  finishUpsert()
  await observer.flush()
  await eventBus.flush()

  assert.deepEqual(notifications, [["orders"]], "A successful order upsert must announce the Orders resource exactly once.")
})

test("does not publish an order-history notification when the order upsert fails", async (t) => {
  const eventBus = new EventBus()
  const notifications = []
  const observer = createOrderHistoryObserver({
    eventBus,
    repository: {
      upsert: async () => {
        throw new Error("database failure")
      },
    },
    environment: "testnet",
    logger: { error() {} },
  })
  const subscription = subscribeToHistoryChanges(eventBus, notifications)
  t.after(async () => {
    subscription.unsubscribe()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await eventBus.flush()
  await observer.flush()
  await eventBus.flush()

  assert.deepEqual(notifications, [], "A failed order upsert must never produce a persisted-history notification.")
})

test("publishes fill and commission notifications only after the fill upsert succeeds", async (t) => {
  const eventBus = new EventBus()
  const notifications = []
  let finishUpsert
  const pendingUpsert = new Promise((resolve) => {
    finishUpsert = resolve
  })
  const observer = createFillHistoryObserver({
    eventBus,
    repository: {
      upsert: () => pendingUpsert,
    },
    environment: "testnet",
  })
  const subscription = subscribeToHistoryChanges(eventBus, notifications)
  t.after(async () => {
    finishUpsert()
    subscription.unsubscribe()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: {
      tradeId: "trade-001",
    },
  })
  await eventBus.flush()

  assert.deepEqual(notifications, [], "Fill and commission changes must remain unannounced while their database upsert is pending.")

  finishUpsert()
  await observer.flush()
  await eventBus.flush()

  assert.deepEqual(notifications, [["fills", "commissions"]], "A successful fill upsert must invalidate both Fills and Commissions exactly once.")
})

test("does not publish fill or commission notifications when the fill upsert fails", async (t) => {
  const eventBus = new EventBus()
  const notifications = []
  const observer = createFillHistoryObserver({
    eventBus,
    repository: {
      upsert: async () => {
        throw new Error("database failure")
      },
    },
    environment: "testnet",
    logger: { error() {} },
  })
  const subscription = subscribeToHistoryChanges(eventBus, notifications)
  t.after(async () => {
    subscription.unsubscribe()
    await observer.close()
    await eventBus.close()
  })

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: {
      tradeId: "trade-001",
    },
  })
  await eventBus.flush()
  await observer.flush()
  await eventBus.flush()

  assert.deepEqual(notifications, [], "A failed fill upsert must never produce fill or commission notifications.")
})
