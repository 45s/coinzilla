import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PassThrough } from "node:stream"
import { configureHarvesterLogging, createHarvesterConsoleTransport } from "./configure-harvester-logging.js"

function createLogger() {
  const transports = new Map()
  const levels = []
  return {
    transports,
    levels,
    addTransport(transport) {
      if (transports.has(transport.name)) throw new Error("duplicate transport")
      transports.set(transport.name, transport)
    },
    async removeTransport(name) {
      const transport = transports.get(name)
      if (!transport) return false
      transports.delete(name)
      await transport.close?.()
      return true
    },
    setLevel(input) {
      levels.push(input)
      return { transports: [...transports.values()].map(({ name, level }) => ({ name, level })) }
    },
  }
}

test("configures independent DEBUG and TRACE JSONL files and INFO console threshold", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-logs-"))
  const logger = createLogger()
  try {
    const logging = await configureHarvesterLogging({ logger, directory })
    assert.deepEqual(logger.levels, [{ transport: "console", level: "info" }])
    assert.equal(logger.transports.get("console").level, "info")
    assert.equal(logger.transports.get("harvester-debug-file").level, "debug")
    assert.equal(logger.transports.get("harvester-trace-file").level, "trace")

    const entry = {
      timestamp: "2026-11-05T12:00:00.000Z",
      level: "debug",
      method: "debug",
      data: { message: "diagnostic", symbol: "ZROUSDT" },
    }
    await logger.transports.get("harvester-debug-file").write(entry)
    await logger.transports.get("harvester-trace-file").write({ ...entry, level: "trace" })

    const debugLines = (await readFile(path.join(directory, "harvester.log"), "utf8")).trim().split("\n")
    const traceLines = (await readFile(path.join(directory, "harvester-trace.log"), "utf8")).trim().split("\n")
    assert.deepEqual(JSON.parse(debugLines[0]), entry)
    assert.equal(JSON.parse(traceLines[0]).level, "trace")

    await logging.close()
    assert.deepEqual((await readdir(directory)).sort(), ["harvester-trace.log", "harvester.log"])
    assert.deepEqual([...logger.transports.keys()], ["console"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("fails clearly when the shared logger transport API is unavailable", async () => {
  await assert.rejects(
    configureHarvesterLogging({ logger: {}, directory: os.tmpdir() }),
    /shared utils dependency first/,
  )
})


test("formats console entries as one compact line while retaining structured fields", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output })

  transport.write({
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    data: {
      message: "Market price evaluated",
      symbol: "ZROUSDT",
      price: "1.74100000",
    },
  })

  assert.equal(written.trim().split("\n").length, 1)
  assert.match(written, /INFO Market price evaluated/)
  assert.match(written, /"symbol":"ZROUSDT"/)
  assert.match(written, /"price":"1.74100000"/)
  output.destroy()
})


test("suppresses consecutive duplicate console entries and reports their count", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output })
  const entry = {
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    data: { message: "Market data ready", symbol: "ZROUSDT", price: "1.70" },
  }

  transport.write(entry)
  transport.write({ ...entry, timestamp: "2026-11-05T12:00:01.000Z" })
  transport.write({ ...entry, timestamp: "2026-11-05T12:00:02.000Z" })
  transport.write({ ...entry, timestamp: "2026-11-05T12:00:03.000Z", data: { ...entry.data, price: "1.71" } })
  transport.close()

  assert.equal((written.match(/Market data ready/g) ?? []).length, 2)
  assert.match(written, /"price":"1.70"/)
  assert.match(written, /"price":"1.71"/)
  assert.match(written, /repeated 2 additional time\(s\)/)
  output.destroy()
})
