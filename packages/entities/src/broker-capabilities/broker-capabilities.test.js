import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  BrokerCapabilities,
  brokerCapabilitiesErrMsgs,
  BROKER_CAPABILITY_TYPES,
  BROKER_CAPABILITY_STATUSES,
} from "./broker-capabilities.js"

describe(BrokerCapabilities.name, () => {
  it("stores supported and unsupported broker capabilities", () => {
    const capabilities = new BrokerCapabilities({
      capabilities: [
        { type: "PLACE_LIMIT_ORDER",
          status: "SUPPORTED" },
        { type: "PLACE_MARKET_ORDER",
          status: "UNSUPPORTED" },
        { type: "SUBSCRIBE_USER_DATA",
          status: "SUPPORTED" },
      ],
    })

    assert.deepEqual(capabilities.value, {
      capabilities: [
        { type: "PLACE_LIMIT_ORDER",
          status: "SUPPORTED" },
        { type: "PLACE_MARKET_ORDER",
          status: "UNSUPPORTED" },
        { type: "SUBSCRIBE_USER_DATA",
          status: "SUPPORTED" },
      ],
    })
    assert.equal(capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "SUPPORTED")
    assert.equal(capabilities.getStatus({ type: "PLACE_MARKET_ORDER" }), "UNSUPPORTED")
    assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "UNKNOWN")
  })

  it("exposes a stable exchange-neutral capability vocabulary", () => {
    assert.ok(BROKER_CAPABILITY_TYPES.includes("READ_BALANCES"))
    assert.ok(BROKER_CAPABILITY_TYPES.includes("PLACE_LIMIT_ORDER"))
    assert.ok(BROKER_CAPABILITY_TYPES.includes("SUBSCRIBE_USER_DATA"))
    assert.deepEqual(BROKER_CAPABILITY_STATUSES, ["SUPPORTED", "UNSUPPORTED", "UNKNOWN"])
  })

  it("treats an empty capability report as unknown rather than unsupported", () => {
    const capabilities = new BrokerCapabilities()

    assert.deepEqual(capabilities.value, { capabilities: [] })
    for (const type of BROKER_CAPABILITY_TYPES) {
      assert.equal(capabilities.getStatus({ type }), "UNKNOWN")
    }
  })

})

describe(`${BrokerCapabilities.name} validation`, () => {
  it("rejects invalid capability collections", () => {
    for (const capabilities of [null, {}, "capabilities", [undefined]]) {
      assert.throws(() => new BrokerCapabilities({ capabilities }), {
        message: brokerCapabilitiesErrMsgs.capabilities,
      })
    }
  })

  it("rejects malformed capability entries", () => {
    for (const capability of [null, "READ_BALANCES", [], 1]) {
      assert.throws(
        () => new BrokerCapabilities({ capabilities: [capability] }),
        { message: brokerCapabilitiesErrMsgs.capability },
      )
    }
  })

  it("rejects unsupported capability types and statuses", () => {
    assert.throws(
      () => new BrokerCapabilities({
        capabilities: [{ type: "BINANCE_MARGIN_BORROW",
          status: "SUPPORTED" }],
      }),
      { message: brokerCapabilitiesErrMsgs.type },
    )
    assert.throws(
      () => new BrokerCapabilities({
        capabilities: [{ type: "READ_BALANCES",
          status: "MAYBE" }],
      }),
      { message: brokerCapabilitiesErrMsgs.status },
    )
  })

  it("rejects duplicate capability types", () => {
    assert.throws(
      () => new BrokerCapabilities({
        capabilities: [
          { type: "READ_BALANCES",
            status: "SUPPORTED" },
          { type: "READ_BALANCES",
            status: "UNSUPPORTED" },
        ],
      }),
      { message: brokerCapabilitiesErrMsgs.duplicate },
    )
  })

  it("rejects invalid capability status queries", () => {
    const capabilities = new BrokerCapabilities()

    for (const type of [undefined, null, "BINANCE_MARGIN_BORROW"]) {
      assert.throws(() => capabilities.getStatus({ type }), {
        message: brokerCapabilitiesErrMsgs.query,
      })
    }
  })

})

describe(`${BrokerCapabilities.name} immutability`, () => {
  it("returns independent snapshots and immutable capability collections", () => {
    const capabilities = new BrokerCapabilities({
      capabilities: [{ type: "READ_BALANCES",
        status: "SUPPORTED" }],
    })
    const snapshot = capabilities.value

    snapshot.capabilities[0].status = "UNSUPPORTED"

    assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
    assert.throws(() => {
      capabilities.capabilities.push({ type: "READ_ORDER",
        status: "SUPPORTED" })
    }, TypeError)
    assert.throws(() => {
      capabilities.capabilities[0].status = "UNSUPPORTED"
    }, TypeError)
  })
})

describe(`${BrokerCapabilities.name} provider evidence`, () => {
  it("supports the richer provider declaration through the shared Entities contract", () => {
    const declaration = new BrokerCapabilities({
      provider: "binance",
      product: "spot",
      environment: {
        selector: "tradingMode",
        selectedMode: "testnet",
        supportedModes: ["testnet", "live"],
      },
      capabilities: [
        {
          type: "READ_ACCOUNT_SNAPSHOT",
          status: "SUPPORTED",
          method: "getAccountSnapshot",
          guarantee: "Returns timestamped canonical account balances.",
          conditions: ["The account-read permission must be enabled."],
        },
        {
          type: "READ_COMPLETE_FILL_HISTORY",
          status: "UNKNOWN",
          reason: "Exhaustive fill-history coverage is not established.",
        },
      ],
    })

    assert.equal(declaration.contractVersion, 1)
    assert.equal(declaration.provider, "binance")
    assert.equal(declaration.product, "spot")
    assert.equal(declaration.getStatus({ type: "READ_ACCOUNT_SNAPSHOT" }), "SUPPORTED")
    assert.equal(declaration.getStatus({ type: "READ_COMPLETE_FILL_HISTORY" }), "UNKNOWN")
    assert.equal(declaration.getCapability({ type: "READ_ACCOUNT_SNAPSHOT" }).method, "getAccountSnapshot")
    assert.deepEqual(declaration.environment.supportedModes, ["testnet", "live"])
    assert.equal(declaration.getStatus({ type: "READ_SERVER_TIME" }), "UNKNOWN")
  })

  it("preserves legacy Entities snapshots without provider evidence metadata", () => {
    const declaration = new BrokerCapabilities({
      capabilities: [{ type: "READ_BALANCES", status: "SUPPORTED" }],
    })

    assert.deepEqual(declaration.value, {
      capabilities: [{ type: "READ_BALANCES", status: "SUPPORTED" }],
    })
    assert.equal(declaration.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  })
})
