import assert from "node:assert/strict"
import test from "node:test"

import {
  BrokerCapabilities,
  BROKER_CAPABILITY_STATUSES,
  BROKER_CAPABILITY_TYPES,
} from "./broker-capabilities.js"

const declaration = {
  provider: "binance",
  product: "spot",
  environment: {
    selector: "tradingMode",
    selectedMode: "testnet",
    supportedModes: ["testnet", "live"],
  },
  capabilities: [
    {
      type: "READ_BALANCES",
      status: "SUPPORTED",
      method: "getBalances",
      guarantee: "Returns exact canonical balances, including zero balances.",
      conditions: ["The account-read permission must be enabled."],
    },
    {
      type: "PLACE_LIMIT_ORDER",
      status: "UNSUPPORTED",
      reason: "Order placement is not implemented by this provider.",
    },
    {
      type: "READ_FILLS",
      status: "UNKNOWN",
      reason: "Available evidence does not establish complete fill history.",
      limitation: "The provider may expose only a bounded order-scoped response.",
    },
  ],
}

test("BrokerCapabilities exposes one canonical three-state vocabulary", () => {
  assert.deepEqual(BROKER_CAPABILITY_STATUSES, [
    "SUPPORTED",
    "UNSUPPORTED",
    "UNKNOWN",
  ])
  assert.ok(BROKER_CAPABILITY_TYPES.includes("READ_BALANCES"))
  assert.ok(BROKER_CAPABILITY_TYPES.includes("READ_FILLS"))
  assert.ok(!BROKER_CAPABILITY_STATUSES.includes("ENVIRONMENT_DEPENDENT"))
})

test("BrokerCapabilities retains provider, product, environment and evidence metadata", () => {
  const capabilities = new BrokerCapabilities(declaration)

  assert.equal(capabilities.provider, "binance")
  assert.equal(capabilities.product, "spot")
  assert.deepEqual(capabilities.environment, {
    selector: "tradingMode",
    selectedMode: "testnet",
    supportedModes: ["testnet", "live"],
  })
  assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "READ_FILLS" }), "UNKNOWN")
  assert.deepEqual(capabilities.getCapability({ type: "READ_BALANCES" }), declaration.capabilities[0])
})

test("omitted capabilities resolve to UNKNOWN without fabricating support", () => {
  const capabilities = new BrokerCapabilities({
    provider: "bitunix",
    product: "spot",
  })

  assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "UNKNOWN")
  assert.deepEqual(capabilities.getCapability({ type: "READ_BALANCES" }), {
    type: "READ_BALANCES",
    status: "UNKNOWN",
  })
})

test("BrokerCapabilities recursively freezes declaration metadata", () => {
  const capabilities = new BrokerCapabilities(declaration)

  assert.equal(Object.isFrozen(capabilities), true)
  assert.equal(Object.isFrozen(capabilities.capabilities), true)
  assert.equal(Object.isFrozen(capabilities.capabilities[0]), true)
  assert.equal(Object.isFrozen(capabilities.capabilities[0].conditions), true)
  assert.equal(Object.isFrozen(capabilities.environment), true)
  assert.equal(Object.isFrozen(capabilities.environment.supportedModes), true)
  assert.throws(() => capabilities.capabilities.push({
    type: "READ_FILLS",
    status: "UNKNOWN",
  }), TypeError)
  assert.throws(() => capabilities.environment.supportedModes.push("demo"), TypeError)
})

test("BrokerCapabilities value snapshots are detached and JSON serializable", () => {
  const capabilities = new BrokerCapabilities(declaration)
  const snapshot = capabilities.value

  snapshot.capabilities[0].status = "UNSUPPORTED"
  snapshot.environment.supportedModes.push("demo")

  assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.deepEqual(capabilities.environment.supportedModes, ["testnet", "live"])
  assert.deepEqual(JSON.parse(JSON.stringify(capabilities)), capabilities.value)
})

test("BrokerCapabilities rejects malformed provider declarations", () => {
  for (const input of [
    null,
    [],
    {
      provider: "",
      product: "spot",
    },
    {
      provider: "binance",
      product: "",
    },
    {
      provider: "binance",
      product: "spot",
      capabilities: {},
    },
    {
      provider: "binance",
      product: "spot",
      capabilities: [null],
    },
  ]) {
    assert.throws(() => new BrokerCapabilities(input))
  }
})

test("BrokerCapabilities rejects invalid statuses, metadata and duplicate types", () => {
  const invalid = [
    [{
      type: "READ_BALANCES",
      status: "ENVIRONMENT_DEPENDENT",
      guarantee: "x",
    }],
    [{
      type: "READ_BALANCES",
      status: "SUPPORTED",
    }],
    [{
      type: "READ_BALANCES",
      status: "UNSUPPORTED",
    }],
    [{
      type: "READ_BALANCES",
      status: "UNKNOWN",
    }],
    [{
      type: "READ_BALANCES",
      status: "SUPPORTED",
      guarantee: "x",
      conditions: "not-an-array",
    }],
    [{
      type: "READ_BALANCES",
      status: "SUPPORTED",
      guarantee: "x",
      conditions: [""],
    }],
    [
      {
        type: "READ_BALANCES",
        status: "SUPPORTED",
        guarantee: "x",
      },
      {
        type: "READ_BALANCES",
        status: "UNSUPPORTED",
        reason: "x",
      },
    ],
  ]

  for (const capabilities of invalid) {
    assert.throws(() => new BrokerCapabilities({
      provider: "binance",
      product: "spot",
      capabilities,
    }))
  }
})

test("BrokerCapabilities validates lookups against the canonical vocabulary", () => {
  const capabilities = new BrokerCapabilities({
    provider: "binance",
    product: "spot",
  })

  for (const type of [undefined, null, "NOT_A_BROKER_CAPABILITY"]) {
    assert.throws(() => capabilities.getStatus({ type }))
    assert.throws(() => capabilities.getCapability({ type }))
  }
})

test("BrokerCapabilities toJSON returns a detached declaration snapshot", () => {
  const capabilities = new BrokerCapabilities(declaration)
  const serialized = capabilities.toJSON()

  assert.deepEqual(serialized, capabilities.value)
  assert.notEqual(serialized, capabilities.value)
  assert.notEqual(serialized.capabilities, capabilities.capabilities)
})

test("BrokerCapabilities rejects empty or inconsistent environment modes", () => {
  for (const environment of [
    {
      selector: "tradingMode",
      selectedMode: "testnet",
      supportedModes: [],
    },
    {
      selector: "tradingMode",
      selectedMode: "live",
      supportedModes: ["testnet"],
    },
  ]) {
    assert.throws(() => new BrokerCapabilities({
      provider: "binance",
      product: "spot",
      environment,
    }))
  }
})
