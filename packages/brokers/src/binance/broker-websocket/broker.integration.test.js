import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const integrationTestPath = fileURLToPath(
  new URL("./broker.integration.js", import.meta.url),
)

test("native broker integration suite skips cleanly without credentials", () => {
  const result = spawnSync(process.execPath, ["--test", integrationTestPath], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      BINANCE_API_KEY: "",
      BINANCE_API_SECRET_KEY: "",
    },
  })

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n")

  assert.equal(result.error, undefined, output)
  assert.equal(result.status, 0, output)
  assert.match(output, /Set Binance TESTNET credentials to run these tests/)
  assert.doesNotMatch(output, /Binance API credentials are required/)
})
