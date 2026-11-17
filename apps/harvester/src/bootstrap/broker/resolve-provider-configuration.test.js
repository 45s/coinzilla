import test from "node:test"
import assert from "node:assert/strict"
import { resolveProviderConfiguration } from "./resolve-provider-configuration.js"

test("maps legacy configuration to one explicit Binance instance", () => {
  const result = resolveProviderConfiguration({ tradingMode: "testnet" })
  assert.deepEqual(result.instances, [{
    id: "binancePrimary", provider: "binance", accountId: "binance-primary", tradingMode: "testnet",
  }], "Legacy configuration must resolve through one deterministic named-instance boundary.")
  assert.deepEqual(result.selections, {
    execution: "binancePrimary", account: "binancePrimary", marketData: "binancePrimary",
  }, "All current broker consumers must resolve to the same explicit instance.")
  assert.equal(result.legacyCompatibility, true)
})

test("resolves explicit instances without mutating configuration", () => {
  const brokers = {
    instances: { binancePrimary: { provider: "binance", accountId: "primary" } },
    selection: { execution: "binancePrimary", account: "binancePrimary", marketData: "binancePrimary" },
  }
  const result = resolveProviderConfiguration({ brokers, tradingMode: "live" })
  assert.equal(result.instances[0].tradingMode, "live")
  assert.equal(brokers.instances.binancePrimary.tradingMode, undefined, "Runtime mode must not mutate loaded configuration.")
})

test("rejects missing or split provider selections", () => {
  const missing = {
    instances: { binancePrimary: { provider: "binance", accountId: "primary" } },
    selection: { execution: "missing", account: "binancePrimary", marketData: "binancePrimary" },
  }
  assert.throws(() => resolveProviderConfiguration({ brokers: missing, tradingMode: "testnet" }), /must reference/)
  const split = {
    instances: {
      binancePrimary: { provider: "binance", accountId: "primary" },
      binanceSecondary: { provider: "binance", accountId: "secondary" },
    },
    selection: { execution: "binancePrimary", account: "binanceSecondary", marketData: "binancePrimary" },
  }
  assert.throws(() => resolveProviderConfiguration({ brokers: split, tradingMode: "testnet" }), /requires execution, account, and market data/)
})
