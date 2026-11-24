import assert from "node:assert/strict"
import test from "node:test"
import {
  createArchiveName,
  validateArchiveRequest,
} from "./archive-debug-evidence.js"

test("requires TESTNET mode and explicit stopped-process confirmation", () => {
  assert.throws(
    () => validateArchiveRequest({
      args: ["--confirm-stopped"],
      env: { TRADING_MODE: "live" },
    }),
    /TRADING_MODE=testnet/,
  )
  assert.throws(
    () => validateArchiveRequest({
      args: [],
      env: { TRADING_MODE: "testnet" },
    }),
    /--confirm-stopped/,
  )
  assert.doesNotThrow(
    () => validateArchiveRequest({
      args: ["--confirm-stopped"],
      env: { TRADING_MODE: "testnet" },
    }),
  )
})

test("names debug archives as directly inspectable tar.gz files", () => {
  const name = createArchiveName({ createdAt: "2026-11-24T18:30:00.000Z" })
  assert.match(name, /^harvester-debug-2026-11-24T18-30-00-000Z-[0-9a-f-]+\.tar\.gz$/)
  assert.equal(name.endsWith(".enc"), false)
})
