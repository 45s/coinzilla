import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { cleanupBroker } from "./cleanup-broker.js"

const test = (name, ...args) => nodeTest("[cleanup-broker.test.js] " + name, ...args)

test("stops every intake before disconnecting the broker and publishes a successful outcome", async () => {
  const calls = []
  const publishedEvents = []
  const errors = await cleanupBroker({
    broker: { disconnect: async () => calls.push("broker:disconnect") },
    brokerName: "binance",
    eventPublisher: { publish: (event) => publishedEvents.push(event) },
    subscriptions: [{ unsubscribe: async () => calls.push("market:unsubscribe") }],
    bookSubscriptions: [{ unsubscribe: async () => calls.push("book:unsubscribe") }],
    userDataSubscription: { disconnect: async () => calls.push("user-data:disconnect") },
  })

  assert.deepEqual(errors, [], "Successful intake cleanup and broker disconnect must return no errors.")
  assert.equal(calls.includes("market:unsubscribe"), true, "Market-price intake must be stopped during broker cleanup.")
  assert.equal(calls.includes("book:unsubscribe"), true, "Book-ticker intake must be stopped during broker cleanup.")
  assert.equal(calls.includes("user-data:disconnect"), true, "User-data intake must be stopped during broker cleanup.")
  assert.equal(calls.at(-1), "broker:disconnect", "The broker must remain connected until all intake cleanup settles.")
  assert.equal(publishedEvents.length, 1, "A single broker-disconnected lifecycle event must be published.")
  assert.equal(publishedEvents[0].name, HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED, "The lifecycle event must use the stable broker-disconnected name.")
  assert.equal(publishedEvents[0].data.outcome, "success", "The lifecycle event must report a successful broker disconnect.")
})

test("attempts every cleanup operation and returns all failures when resources reject", async () => {
  const calls = []
  const publishedEvents = []
  const expectedErrors = [
    new Error("market unsubscribe failed"),
    new Error("book unsubscribe failed"),
    new Error("user-data disconnect failed"),
    new Error("broker disconnect failed"),
  ]
  const errors = await cleanupBroker({
    broker: { disconnect: async () => { calls.push("broker:disconnect"); throw expectedErrors[3] } },
    brokerName: "binance",
    eventPublisher: { publish: (event) => publishedEvents.push(event) },
    subscriptions: [{ unsubscribe: async () => { calls.push("market:unsubscribe"); throw expectedErrors[0] } }],
    bookSubscriptions: [{ unsubscribe: async () => { calls.push("book:unsubscribe"); throw expectedErrors[1] } }],
    userDataSubscription: { disconnect: async () => { calls.push("user-data:disconnect"); throw expectedErrors[2] } },
  })

  assert.deepEqual(
    errors.map((error) => error.message).sort(),
    expectedErrors.map((error) => error.message).sort(),
    "Cleanup must preserve every rejected unsubscribe/disconnect error instead of stopping at the first failure.",
  )
  assert.equal(calls.includes("market:unsubscribe"), true, "A failed market unsubscribe must not prevent other cleanup attempts.")
  assert.equal(calls.includes("book:unsubscribe"), true, "A failed book unsubscribe must not prevent other cleanup attempts.")
  assert.equal(calls.includes("user-data:disconnect"), true, "A failed user-data disconnect must not prevent broker disconnect.")
  assert.equal(calls.at(-1), "broker:disconnect", "Broker disconnect must still be attempted after intake cleanup failures.")
  assert.equal(publishedEvents[0].data.outcome, "failed", "The lifecycle event must report a failed broker disconnect.")
  assert.equal(publishedEvents[0].data.error.message, "broker disconnect failed", "The lifecycle event must preserve a safe broker-disconnect diagnostic.")
})
