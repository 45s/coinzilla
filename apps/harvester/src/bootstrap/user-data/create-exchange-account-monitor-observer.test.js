import assert from "node:assert/strict"
import test from "node:test"
import { createExchangeAccountMonitorObserver } from "./create-exchange-account-monitor-observer.js"

test("notifies registered dashboard listeners after the existing user-data observer", async () => {
  const sequence = []
  const listeners = new Set([
    () => sequence.push("dashboard"),
  ])
  const observer = createExchangeAccountMonitorObserver({
    onUserDataEvent: async () => {
      sequence.push("existing-observer")
    },
    listeners,
  })

  await observer({ event: { eventType: "accountUpdate" } })

  assert.deepEqual(sequence, ["existing-observer", "dashboard"])
})

test("contains dashboard listener failures without rejecting the user-data observer", async () => {
  const warnings = []
  const observer = createExchangeAccountMonitorObserver({
    onUserDataEvent: async () => undefined,
    listeners: new Set([
      () => { throw new Error("websocket closed") },
    ]),
    logger: {
      warn: (entry) => warnings.push(entry),
    },
  })

  await assert.doesNotReject(() => observer({ event: { eventType: "accountUpdate" } }))
  assert.equal(warnings[0]?.message, "exchange account update listener failed")
})

test("notifies dashboard listeners even when the existing observer rejects", async () => {
  const notifications = []
  const observer = createExchangeAccountMonitorObserver({
    onUserDataEvent: async () => {
      throw new Error("existing observer failed")
    },
    listeners: new Set([
      () => notifications.push("updated"),
    ]),
  })

  await assert.rejects(
    observer({ event: { eventType: "accountUpdate" } }),
    /existing observer failed/,
  )
  assert.deepEqual(notifications, ["updated"])
})
