import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

test("Bitunix order probe CLI refuses non-interactive execution before credentials or network", () => {
  const scriptPath = fileURLToPath(new URL("../run-healthcheck.js", import.meta.url))
  const env = {
    ...process.env,
  }
  delete env.BITUNIX_API_KEY
  delete env.BITUNIX_API_SECRET
  const result = spawnSync(process.execPath, [scriptPath, "--probe-order=limit-buy-1"], {
    encoding: "utf8",
    env,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /interactive terminal/i)
  assert.match(result.stdout, /^@coinzilla\/brokers bitunix:healthcheck v1\.0\.0 \| commit [a-f0-9]{40} \| worktree (clean|dirty) \| Node v\d+(?:\.\d+)*\r?\n$/)
})


test("Bitunix order probe CLI rejects unknown probe identifiers before terminal or credential checks", () => {
  const scriptPath = fileURLToPath(new URL("../run-healthcheck.js", import.meta.url))
  const env = {
    ...process.env,
  }
  delete env.BITUNIX_API_KEY
  delete env.BITUNIX_API_SECRET
  const result = spawnSync(process.execPath, [scriptPath, "--probe-order=not-a-probe"], {
    encoding: "utf8",
    env,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unsupported Bitunix order probe/i)
  assert.doesNotMatch(result.stderr, /interactive terminal/i)
  assert.doesNotMatch(result.stderr, /BITUNIX_API_KEY/i)
})
