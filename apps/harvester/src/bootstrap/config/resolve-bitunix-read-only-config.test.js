import assert from "node:assert/strict"
import test from "node:test"
import { resolveBitunixReadOnlyConfig } from "./resolve-bitunix-read-only-config.js"

test("keeps Bitunix disabled by default even when credentials are present", () => {
  const config = resolveBitunixReadOnlyConfig({
    env: { BITUNIX_API_KEY: "read-only-key", BITUNIX_API_SECRET: "read-only-secret" },
  })
  assert.equal(config, null, "Credentials alone must not enable a production Bitunix connection.")
})

test("resolves an explicit production read-only configuration", () => {
  const config = resolveBitunixReadOnlyConfig({
    env: {
      BITUNIX_READ_ONLY_ENABLED: "true",
      BITUNIX_API_KEY: "read-only-key",
      BITUNIX_API_SECRET: "read-only-secret",
    },
  })
  assert.deepEqual(config, {
    apiKey: "read-only-key",
    apiSecret: "read-only-secret",
    tradingMode: "live",
    providerInstanceId: "bitunixSpotPrimary",
    accountId: "bitunix-primary",
  }, "The read-only config must use stable non-secret identity and the documented Spot production endpoint.")
  assert.equal(Object.isFrozen(config), true, "Resolved Bitunix credentials and identity must be immutable.")
})

test("rejects unsupported enable-flag values", () => {
  assert.throws(
    () => resolveBitunixReadOnlyConfig({ env: { BITUNIX_READ_ONLY_ENABLED: "yes" } }),
    (error) => error.code === "HARVESTER_BITUNIX_READ_ONLY_CONFIGURATION_INVALID",
    "Only the explicit true/false values may control the observer.",
  )
})

test("rejects missing API credentials without including secret values in diagnostics", () => {
  for (const env of [
    { BITUNIX_READ_ONLY_ENABLED: "true", BITUNIX_API_SECRET: "secret-must-not-appear" },
    { BITUNIX_READ_ONLY_ENABLED: "true", BITUNIX_API_KEY: "read-only-key" },
  ]) {
    assert.throws(
      () => resolveBitunixReadOnlyConfig({ env }),
      (error) => error.code === "HARVESTER_BITUNIX_READ_ONLY_CONFIGURATION_INVALID" &&
        !error.message.includes("secret-must-not-appear"),
      "Enabled configuration must require both credentials and never echo a credential.",
    )
  }
})

test("rejects invalid stable observer identity values", () => {
  assert.throws(
    () => resolveBitunixReadOnlyConfig({
      env: {
        BITUNIX_READ_ONLY_ENABLED: "true",
        BITUNIX_API_KEY: "read-only-key",
        BITUNIX_API_SECRET: "read-only-secret",
        BITUNIX_PROVIDER_INSTANCE_ID: "bad id",
      },
    }),
    (error) => error.code === "HARVESTER_BITUNIX_READ_ONLY_CONFIGURATION_INVALID",
    "Provider identity must be a stable non-secret identifier.",
  )
})
