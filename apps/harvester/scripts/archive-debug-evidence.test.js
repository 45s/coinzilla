import assert from "node:assert/strict"
import test from "node:test"
import {
  createArchiveName,
  createTarInvocation,
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
  assert.doesNotThrow(
    () => validateArchiveRequest({
      args: ["--", "--confirm-stopped"],
      env: { TRADING_MODE: "testnet" },
    }),
  )
})

test("names debug archives as directly inspectable tar.gz files", () => {
  const name = createArchiveName({ createdAt: "2026-11-24T18:30:00.000Z" })
  assert.match(name, /^harvester-debug-2026-11-24T18-30-00-000Z-[0-9a-f-]+\.tar\.gz$/)
  assert.equal(name.endsWith(".enc"), false)
})

test("uses a relative tar output path so Windows drive letters are not parsed as remote hosts", () => {
  const invocation = createTarInvocation({
    staging: "C:\\Users\\od_user\\AppData\\Local\\Temp\\harvester-debug-test\\evidence",
  })
  assert.deepEqual(invocation.args, [
    "-czf",
    "evidence.tar.gz",
    "-C",
    "C:\\Users\\od_user\\AppData\\Local\\Temp\\harvester-debug-test\\evidence",
    ".",
  ])
  assert.equal(invocation.args[1].includes(":"), false)
})
