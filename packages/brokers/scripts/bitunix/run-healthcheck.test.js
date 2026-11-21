import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const scriptPath = fileURLToPath(new URL("./run-healthcheck.js", import.meta.url))

test("Bitunix health-check help lists every mode without credentials or network access", () => {
  const env = { ...process.env }
  delete env.BITUNIX_API_KEY
  delete env.BITUNIX_API_SECRET
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    encoding: "utf8",
    env,
  })

  assert.equal(result.status, 0, "help must exit successfully without credentials or network access")
  assert.match(result.stdout, /--local/, "help must describe local-only diagnostics")
  assert.match(result.stdout, /--publish/, "help must describe sanitized report publishing")
  assert.match(result.stdout, /--place-order/, "help must describe the guarded operator order mode")
  assert.equal(result.stderr, "", "help must not emit credential or runtime errors")
})

test("Bitunix --version prints source identity and exits without credentials", () => {
  const env = { ...process.env }
  delete env.BITUNIX_API_KEY
  delete env.BITUNIX_API_SECRET
  const result = spawnSync(process.execPath, [scriptPath, "--version"], {
    encoding: "utf8",
    env,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.match(
    result.stdout,
    /bitunix:healthcheck v1\.0\.0 \| commit [a-f0-9]{40} \| worktree (clean|dirty) \| Node v\d+/,
  )
  assert.equal(result.stderr, "")
})
