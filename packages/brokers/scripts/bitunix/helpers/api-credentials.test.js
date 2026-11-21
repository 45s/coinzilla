import assert from "node:assert/strict"
import test from "node:test"
import {
  parseApiCredentials,
  redactApiSecrets,
  getConfiguredApiSecrets,
  getMissingApiCredentialNames,
  hasApiCredentials,
} from "./api-credentials.js"

test("API credential parser trims required values and rejects incomplete pairs", () => {
  assert.deepEqual(parseApiCredentials({
    env: {
      BITUNIX_API_KEY: " key ",
      BITUNIX_API_SECRET: " secret ",
    },
  }), {
    apiKey: "key",
    apiSecret: "secret",
  }, "credentials should be trimmed before Broker construction")
  assert.throws(() => parseApiCredentials({
    env: {
      BITUNIX_API_KEY: "key",
    },
  }), /BITUNIX_API_SECRET/, "an incomplete LIVE credential pair must be rejected")
})

test("operator output redaction removes every configured secret", () => {
  assert.equal(redactApiSecrets({
    message: "key-secret failed",
    secrets: ["key", "secret"],
  }), "[REDACTED]-[REDACTED] failed", "operator output must not expose configured API credentials")
})

test("diagnostic credential helpers report configured secrets without exposing them", () => {
  const incompleteEnvironment = {
    BITUNIX_API_KEY: "key",
  }
  assert.deepEqual(getConfiguredApiSecrets({ env: incompleteEnvironment }), ["key"], "only configured secrets should be returned")
  assert.deepEqual(getMissingApiCredentialNames({ env: incompleteEnvironment }), ["BITUNIX_API_SECRET"], "missing credential names should be explicit")
  assert.equal(hasApiCredentials({ env: incompleteEnvironment }), false, "private diagnostics require both credentials")
  assert.equal(hasApiCredentials({
    env: {
      BITUNIX_API_KEY: "key",
      BITUNIX_API_SECRET: "secret",
    },
  }), true, "a complete credential pair enables private diagnostics")
})
