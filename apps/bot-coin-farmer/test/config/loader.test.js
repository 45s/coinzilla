import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadConfig } from "../../src/config/loader.js"

test("loadConfig reads JSON from the supplied path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coin-farmer-config-"))

  try {
    const configPath = join(directory, "config.json")
    await writeFile(configPath, JSON.stringify({ trading: { enabled: false } }))

    assert.deepEqual(await loadConfig({ configPath }), {
      trading: { enabled: false },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("loadConfig reports a missing file with its original cause", async () => {
  await assert.rejects(
    loadConfig({ configPath: join(tmpdir(), "missing-coin-farmer-config.json") }),
    (error) => {
      assert.match(error.message, /Unable to read Coin Farmer config/)
      assert.equal(error.cause?.code, "ENOENT")
      return true
    },
  )
})

test("loadConfig reports malformed JSON with its original cause", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coin-farmer-config-"))

  try {
    const configPath = join(directory, "invalid.json")
    await writeFile(configPath, "{ invalid")

    await assert.rejects(
      loadConfig({ configPath }),
      (error) => {
        assert.match(error.message, /invalid JSON/)
        assert.ok(error.cause instanceof SyntaxError)
        return true
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("loadConfig rejects an empty path", async () => {
  await assert.rejects(loadConfig({ configPath: " " }), {
    name: "TypeError",
    message: "configPath must be a non-empty string",
  })
})
