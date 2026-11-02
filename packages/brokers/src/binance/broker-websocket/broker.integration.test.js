import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const integrationTestPaths = [
  new URL("./broker.integration.js", import.meta.url),
  new URL("./methods/user-data-session.integration.js", import.meta.url),
].map(fileURLToPath)

test("Binance TESTNET integration suites stay offline without explicit opt-in", () => {
  for (const integrationTestPath of integrationTestPaths) {
    const childEnvironment = { ...process.env }
    delete childEnvironment.NODE_TEST_CONTEXT

    const result = spawnSync(process.execPath, ["--test", integrationTestPath], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...childEnvironment,
        NODE_ENV: "test",
        BINANCE_API_KEY: "ci-test-api-key",
        BINANCE_API_SECRET_KEY: "ci-test-api-secret",
        BINANCE_TESTNET_INTEGRATION: "",
      },
    })

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n")

    assert.equal(result.error, undefined, output)
    assert.equal(result.status, 0, output)
    assert.match(
      output,
      /Set BINANCE_TESTNET_INTEGRATION=1 and non-placeholder Binance TESTNET credentials to run these tests/,
      integrationTestPath,
    )
    assert.doesNotMatch(output, /Binance API credentials are required/)
  }
})
