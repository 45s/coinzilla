import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createContainer } from "../../src/bootstrap/container.js"
import {
  shutdownRuntime,
  startRuntime,
} from "../../src/bootstrap/startup.js"
import { createValidConfig } from "../helpers/config.js"

test("runtime starts and stops with EventBus and Journal without a broker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coin-farmer-runtime-"))
  const logger = {
    info() {},
    error() {},
  }

  try {
    const runtime = createContainer({
      config: createValidConfig(),
      logger,
      journalDirectory: directory,
    })

    await startRuntime(runtime)
    assert.equal(runtime.state, "started")

    await shutdownRuntime(runtime)
    assert.equal(runtime.state, "stopped")

    const [fileName] = await readdir(directory)
    const journal = await readFile(join(directory, fileName), "utf8")
    const events = journal.trim().split("\n").map((line) => JSON.parse(line))

    assert.deepEqual(events.map(({ name }) => name), [
      "runtime.started",
      "runtime.stopped",
    ])
    assert.ok(events.every(({ data }) => data.tradingEnabled === false))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
