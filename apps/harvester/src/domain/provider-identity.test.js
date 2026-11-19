import test from "node:test"
import assert from "node:assert/strict"
import {
  ProviderIdentityConfigError,
  resolveBinanceProviderIdentity,
} from "./provider-identity.js"

const testCase = (...args) => test(`[provider-identity.test.js] ${args[0]}`, ...args.slice(1))

testCase("maps the legacy TESTNET and LIVE configuration to stable Binance instance IDs", () => {
  const testnet = resolveBinanceProviderIdentity({ tradingMode: "testnet" })
  const live = resolveBinanceProviderIdentity({ tradingMode: "live" })

  assert.deepEqual(testnet, {
    providerType: "binance",
    providerInstanceId: "binanceTestnet",
    accountId: "binance-primary",
  }, "Legacy TESTNET configuration must resolve to one explicit Binance provider instance.")
  assert.deepEqual(live, {
    providerType: "binance",
    providerInstanceId: "binanceLive",
    accountId: "binance-primary",
  }, "Legacy LIVE configuration must resolve to a distinct provider instance without using NODE_ENV.")
  assert.equal(Object.isFrozen(testnet), true,
    "Resolved provider identity must be immutable before provider construction.")
})

testCase("accepts operator-defined non-secret Binance instance and account labels", () => {
  const identity = resolveBinanceProviderIdentity({
    tradingMode: "testnet",
    providerInstanceId: "binanceDeskTestnet",
    accountId: "desk-primary",
  })

  assert.equal(identity.providerType, "binance",
    "Identity overrides must not change the concrete provider type.")
  assert.equal(identity.providerInstanceId, "binanceDeskTestnet",
    "The configured instance label must be retained exactly.")
  assert.equal(identity.accountId, "desk-primary",
    "The stable account alias must be retained without treating it as a credential.")
})

testCase("rejects missing or unsupported trading environments before constructing a broker", () => {
  for (const tradingMode of [undefined, "production", "paper"]) {
    assert.throws(
      () => resolveBinanceProviderIdentity({ tradingMode }),
      (error) => error instanceof ProviderIdentityConfigError &&
        error.code === "HARVESTER_PROVIDER_IDENTITY_INVALID" &&
        error.context.field === "TRADING_MODE",
      "Only the explicit Binance TESTNET and LIVE environments may produce a provider instance.",
    )
  }
})

testCase("rejects malformed provider-instance and account identity labels without echoing values", () => {
  for (const invalidIdentity of ["", " ", " binancePrimary", "account id", "api-key=value"]) {
    for (const [field, input] of [
      ["BINANCE_PROVIDER_INSTANCE_ID", { providerInstanceId: invalidIdentity }],
      ["BINANCE_ACCOUNT_ID", { accountId: invalidIdentity }],
    ]) {
      assert.throws(
        () => resolveBinanceProviderIdentity({
          tradingMode: "testnet",
          ...input,
        }),
        (error) => error instanceof ProviderIdentityConfigError &&
          error.context.field === field &&
          error.message.startsWith("Invalid Binance provider identity configuration:"),
        "Malformed non-secret identity labels must fail without echoing potentially sensitive input.",
      )
    }
  }
})
