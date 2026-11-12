import assert from "node:assert/strict"
import test from "node:test"
import { runInitializeDurableFacts } from "./initialize-durable-facts.js"

test("disables the legacy initializer because it bypasses the process-wide lock", async () => {
  let storeCreated = false
  const messages = []
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/coinzilla-facts" },
    argv: ["--confirm"],
    stdout: (message) => messages.push(message),
    stderr: (message) => messages.push(message),
    createStore: () => {
      storeCreated = true
      throw new Error("legacy initializer must never construct a store")
    },
  })

  assert.equal(exitCode, 1)
  assert.equal(storeCreated, false, "The old command must not bypass the lock-protected package command.")
  assert.match(messages.join("\n"), /durable-facts:init/)
  assert.match(messages.join("\n"), /process lock/i)
})
