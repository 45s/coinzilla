import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const serializerPath = fileURLToPath(new URL("./json-serializer.js", import.meta.url))

test("Bitunix exact JSON serializer parses as valid JavaScript before consumers import it", () => {
  const result = spawnSync(process.execPath, ["--check", serializerPath], {
    encoding: "utf8",
  })

  assert.equal(
    result.status,
    0,
    `Bitunix JSON serializer must be valid JavaScript; Node reported: ${result.stderr || result.stdout}`,
  )
})

test("Bitunix funds mutation request adapter parses as valid JavaScript", () => {
  const adapterPath = fileURLToPath(new URL("../adapters/funds-mutation-requests.js", import.meta.url))
  const result = spawnSync(process.execPath, ["--check", adapterPath], {
    encoding: "utf8",
  })

  assert.equal(
    result.status,
    0,
    `Bitunix funds mutation adapter must be valid JavaScript; Node reported: ${result.stderr || result.stdout}`,
  )
})
