import assert from "node:assert/strict"
import test from "node:test"
import { createUserDataObservationHandler } from "./create-user-data-observation-handler.js"

test("records only non-authoritative observation metadata without touching execution state", () => {
  const logs = []
  const handler = createUserDataObservationHandler({
    logger: {
      system: (entry) => logs.push(entry),
    },
  })

  handler({
    observation: {
      mode: "POLLING",
      observedAt: 1234,
      sourceTime: null,
      symbols: [{ symbol: "BTCUSDT" }],
      balances: [{ free: "secret-account-data" }],
      matchingOrderObservations: [{ orderId: "private-order-id" }],
    },
  })

  assert.deepEqual(logs, [{
    message: "Received non-authoritative broker user-data observation",
    deliveryMode: "POLLING_OBSERVATIONS",
    observedAt: 1234,
    sourceTime: null,
    symbols: ["BTCUSDT"],
    balanceCount: 1,
    trackedOrderCount: 1,
  }], "Only safe observation metadata may be logged.")
  assert.equal(JSON.stringify(logs).includes("secret-account-data"), false, "Financial payloads must not be logged.")
  assert.equal(JSON.stringify(logs).includes("private-order-id"), false, "Private order identities must not be logged.")
})
