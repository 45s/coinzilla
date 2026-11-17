import assert from "node:assert/strict"
import test from "node:test"
import { mapUserDataReadinessChangedData } from "./user-data-readiness-event-dto.js"

test("maps bounded user-data readiness transitions", () => {
  const blocked = mapUserDataReadinessChangedData({
    broker: "binance",
    ready: false,
    status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    trigger: "connectionClosed",
    account: { balances: ["must-not-leak"] },
  })

  assert.equal(blocked.ok, true)
  assert.deepEqual(blocked.data, {
    broker: "binance",
    ready: false,
    status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    trigger: "connectionClosed",
  })
})

test("rejects invalid readiness values and malformed transition context", () => {
  assert.equal(mapUserDataReadinessChangedData({
    broker: "binance",
    ready: "false",
    status: "READY",
  }).ok, false)
  assert.equal(mapUserDataReadinessChangedData({
    broker: "binance",
    ready: true,
    status: "",
  }).ok, false)
  assert.equal(mapUserDataReadinessChangedData({
    broker: "binance",
    ready: true,
    status: "READY",
    trigger: " ",
  }).ok, false)
})
