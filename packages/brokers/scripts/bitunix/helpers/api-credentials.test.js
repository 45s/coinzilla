import assert from "node:assert/strict"
import test from "node:test"
import {
  parseApiCredentials,
  redactApiSecrets,
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
