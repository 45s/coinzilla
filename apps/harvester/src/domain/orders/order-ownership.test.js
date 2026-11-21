import test from "node:test"
import assert from "node:assert/strict"
import {
  createOrderOwnership,
  validateOrderOwnerships,
  findOrderOwnership,
  hasSameOrderOwnership,
  attachBrokerOrderIdToOwnership,
} from "./order-ownership.js"

function makeOwnership(overrides = {}) {
  return {
    strategyId: "strategy-1",
    positionId: "position-1",
    purpose: "RECOVERY_SELL",
    cycleId: "cycle-1",
    ...overrides,
  }
}

function makeOrder({ clientOrderId = "client-1", brokerOrderId = "broker-1", marketId = "DOGEUSDT" } = {}) {
  return { clientOrderId, brokerOrderId, market: { id: marketId } }
}

test("normalizes and freezes valid ownership while preserving optional broker identity", () => {
  const ownership = createOrderOwnership({
    ownership: makeOwnership({ strategyId: " strategy-1 ", positionId: " position-1 ", purpose: " RECOVERY_SELL ", cycleId: " cycle-1 " }),
    clientOrderId: "client-1",
  })
  assert.deepEqual(ownership, {
    clientOrderId: "client-1",
    strategyId: "strategy-1",
    positionId: "position-1",
    purpose: "RECOVERY_SELL",
    cycleId: "cycle-1",
  }, "Valid ownership fields must be normalized and retain client identity.")
  assert.equal(Object.isFrozen(ownership), true, "Normalized ownership must be immutable.")
})

test("rejects invalid ownership shape and required fields", () => {
  for (const ownership of [null, undefined, [], "invalid"]) {
    assert.throws(() => createOrderOwnership({ ownership, clientOrderId: "client-1" }), /Order ownership must be an object/, "Non-object ownership must be rejected.")
  }
  for (const field of ["strategyId", "positionId", "purpose"]) {
    assert.throws(() => createOrderOwnership({ ownership: makeOwnership({ [field]: " " }), clientOrderId: "client-1" }), new RegExp(`non-empty ${field}`), `Blank ${field} must be rejected.`)
  }
  for (const cycleId of ["", " ", 1, null]) {
    assert.throws(() => createOrderOwnership({ ownership: makeOwnership({ cycleId }), clientOrderId: "client-1" }), /cycleId must be a non-empty string/, "Invalid optional cycle identity must be rejected.")
  }
})

test("rejects invalid and conflicting canonical order identities", () => {
  assert.throws(() => createOrderOwnership({ ownership: makeOwnership(), clientOrderId: "" }), /non-empty clientOrderId/, "Missing client identity must be rejected.")
  assert.throws(() => createOrderOwnership({ ownership: makeOwnership({ clientOrderId: "other" }), clientOrderId: "client-1" }), /clientOrderId does not match/, "Conflicting client identity must be rejected.")
  assert.throws(() => createOrderOwnership({ ownership: makeOwnership({ brokerOrderId: "other" }), clientOrderId: "client-1", brokerOrderId: "broker-1" }), /brokerOrderId does not match/, "Conflicting broker identity must be rejected.")
})

test("validates ownership references and rejects duplicate canonical identities", () => {
  const orders = [makeOrder(), makeOrder({ clientOrderId: "client-2", brokerOrderId: "broker-1" })]
  const valid = validateOrderOwnerships({ orders, ownerships: [makeOwnership(), makeOwnership({ positionId: "position-2" })] })
  assert.equal(valid.length, 2, "Each registered canonical order must receive one ownership record.")
  assert.equal(Object.isFrozen(valid), true, "Validated ownership collection must be immutable.")
  assert.throws(() => validateOrderOwnerships({ orders, ownerships: "invalid" }), /must be an array/, "Non-array ownership data must be rejected.")
  assert.throws(() => validateOrderOwnerships({ orders, ownerships: [makeOwnership({ clientOrderId: "unknown" })] }), /registered canonical order/, "Ownership must reference a registered order.")
  assert.throws(() => validateOrderOwnerships({ orders, ownerships: [makeOwnership(), makeOwnership()] }), /duplicate ownership clientOrderIds/, "Duplicate client identity must be rejected.")
  assert.throws(() => validateOrderOwnerships({ orders, ownerships: [makeOwnership(), makeOwnership({ clientOrderId: "client-2" })] }), /duplicate ownership brokerOrderIds/, "Duplicate market-scoped broker identity must be rejected.")
})

test("finds ownership by client identity, broker identity, or matching pair", () => {
  const ownership = createOrderOwnership({ ownership: makeOwnership(), clientOrderId: "client-1", brokerOrderId: "broker-1" })
  const ownerships = [ownership]
  assert.equal(findOrderOwnership({ ownerships, clientOrderId: "client-1" }), ownership, "Client identity must resolve ownership.")
  assert.equal(findOrderOwnership({ ownerships, brokerOrderId: "broker-1" }), ownership, "Broker identity must resolve ownership.")
  assert.equal(findOrderOwnership({ ownerships, clientOrderId: "client-1", brokerOrderId: "broker-1" }), ownership, "Matching identities must resolve the same record.")
  assert.equal(findOrderOwnership({ ownerships, clientOrderId: "missing" }), undefined, "Unknown client identity must return no ownership.")
  assert.throws(() => findOrderOwnership({ ownerships }), /requires clientOrderId or brokerOrderId/, "Lookup without identity must be rejected.")
  assert.throws(() => findOrderOwnership({ ownerships, clientOrderId: " ", brokerOrderId: "broker-1" }), /clientOrderId must be a non-empty string/, "Blank client identity must be rejected.")
  assert.throws(() => findOrderOwnership({ ownerships, clientOrderId: "client-1", brokerOrderId: " " }), /brokerOrderId must be a non-empty string/, "Blank broker identity must be rejected.")
  assert.throws(() => findOrderOwnership({ ownerships, clientOrderId: "client-1", brokerOrderId: "different" }), /identify different registered orders/, "Conflicting identities must not be combined.")
})

test("compares ownership and attaches broker identity immutably", () => {
  const current = createOrderOwnership({ ownership: makeOwnership(), clientOrderId: "client-1" })
  const same = createOrderOwnership({ ownership: makeOwnership(), clientOrderId: "client-1" })
  const changed = createOrderOwnership({ ownership: makeOwnership({ positionId: "position-2" }), clientOrderId: "client-1" })
  assert.equal(hasSameOrderOwnership({ current, next: same }), true, "Equivalent ownership records must compare equal.")
  assert.equal(hasSameOrderOwnership({ current, next: changed }), false, "Different position ownership must compare unequal.")
  const other = createOrderOwnership({ ownership: makeOwnership({ positionId: "position-2" }), clientOrderId: "client-2" })
  const ownerships = [current, other]
  const attached = attachBrokerOrderIdToOwnership({ ownerships, clientOrderId: "client-1", brokerOrderId: "broker-1" })
  assert.equal(attached[0].brokerOrderId, "broker-1", "Matching client identity must receive broker identity.")
  assert.equal(attached[1], other, "Unmatched ownership must preserve its record reference.")
  assert.equal(Object.isFrozen(attached), true, "Updated ownership collection must be immutable.")
  assert.equal(Object.isFrozen(attached[0]), true, "Updated ownership record must be immutable.")
  const unchanged = attachBrokerOrderIdToOwnership({ ownerships, clientOrderId: "missing", brokerOrderId: "broker-2" })
  assert.equal(unchanged[0], current, "Unmatched client identity must leave existing records unchanged.")
})
