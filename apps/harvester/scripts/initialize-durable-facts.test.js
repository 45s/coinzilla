import assert from "node:assert/strict"
import test from "node:test"
import os from "node:os"
import path from "node:path"
import { runInitializeDurableFacts } from "./initialize-durable-facts.js"

const absoluteDirectory = path.join(os.tmpdir(), "coinzilla-durable-facts")

test("requires explicit confirmation and never constructs the store without it", async () => {
  let storeCreated = false
  const messages = []
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/coinzilla-facts" },
    argv: [],
    stdout: (message) => messages.push(message),
    stderr: (message) => messages.push(message),
    createStore: () => {
      storeCreated = true
      throw new Error("must not be called")
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(storeCreated, false)
  assert.match(messages.join("\n"), /--confirm/)
})

test("requires an absolute durable-facts directory", async () => {
  const messages = []
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: "relative/facts" },
    argv: ["--confirm"],
    stdout: () => {},
    stderr: (message) => messages.push(message),
    createStore: () => {
      throw new Error("must not be called")
    },
  })
  assert.equal(exitCode, 1)
  assert.match(messages.join("\n"), /absolute local directory/)
})

test("initializes exactly the configured directory and reports the genesis identity", async () => {
  const output = []
  let receivedOptions
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: absoluteDirectory },
    argv: ["--confirm"],
    stdout: (message) => output.push(message),
    stderr: (message) => output.push(message),
    createStore: (options) => {
      receivedOptions = options
      return {
        initialize: async () => ({
          ok: true,
          data: {
            record: {
              sequence: "0",
              digest: "a".repeat(64),
            },
          },
        }),
      }
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(receivedOptions.directory, absoluteDirectory)
  assert.match(receivedOptions.runtimeSessionId, /^ledger-initialization:/)
  assert.match(output.join("\n"), /Genesis sequence: 0/)
  assert.match(output.join("\n"), new RegExp("Genesis digest: " + "a".repeat(64)))
})

test("returns a nonzero exit code when the store refuses initialization", async () => {
  const errors = []
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: absoluteDirectory },
    argv: ["--confirm"],
    stdout: () => {},
    stderr: (message) => errors.push(message),
    createStore: () => ({
      initialize: async () => ({
        ok: false,
        errors: [{ message: "directory is not empty" }],
      }),
    }),
  })
  assert.equal(exitCode, 1)
  assert.match(errors.join("\n"), /directory is not empty/)
})

test("rejects unknown command-line arguments", async () => {
  const errors = []
  const exitCode = await runInitializeDurableFacts({
    env: { DURABLE_FACTS_DIRECTORY: absoluteDirectory },
    argv: ["--confirm", "--force"],
    stdout: () => {},
    stderr: (message) => errors.push(message),
    createStore: () => {
      throw new Error("must not be called")
    },
  })
  assert.equal(exitCode, 1)
  assert.match(errors.join("\n"), /Unknown arguments/)
})
