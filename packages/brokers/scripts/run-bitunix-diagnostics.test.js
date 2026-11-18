import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const scriptPath = fileURLToPath(new URL("./run-bitunix-diagnostics.js", import.meta.url))

test("Bitunix diagnostic help describes the current source-constant configuration", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    encoding: "utf8",
  })

  assert.equal(result.status, 0, "the diagnostic help command must exit successfully without credentials or network access")
  assert.equal(
    result.stdout.includes("BITUNIX_DIAGNOSTICS_CONFIRM_LIVE_READS"),
    false,
    "the help output must not advertise the removed live-read environment variable",
  )
  assert.equal(
    result.stdout.includes("BITUNIX_API_KEY") && result.stdout.includes("BITUNIX_API_SECRET"),
    true,
    "the help output must identify the two supported Bitunix credential variables",
  )
  assert.equal(
    result.stdout.includes("Public-only mode runs unsigned REST checks; authenticated REST and WebSocket RPC checks are skipped unless both credentials are set."),
    true,
    "the help output must clearly distinguish public-only and authenticated diagnostic modes",
  )
})
