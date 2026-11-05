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
  assert.match(written, /Market price evaluated/)
  assert.doesNotMatch(written, /INFO Market price evaluated/)
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


test("keeps INFO output concise and excludes stack traces and audit internals", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output })

  transport.write({
    timestamp: "2026-11-05T19:57:24.000Z",
    level: "error",
    data: {
      message: "Harvester broker workflow startup step failed",
      errorName: "Error",
      errorMessage: "Conservative TESTNET startup blocked: account has 2 open orders without matching durable Harvester ownership",
      errorStack: "Error: full stack trace with local filesystem paths and source line numbers",
      orderCount: 2,
      readiness: "BLOCKED",
      symbols: ["DOGEUSDT", "ZROUSDT"],
      sourceAssetCount: 517,
      auditReasons: ["UNRESOLVED_OWNED_ORDERS:2"],
      fingerprint: "{\"internal\":\"diagnostic\"}",
    },
  })

  const line = written.trim()
  assert.match(line, /ERROR Harvester broker workflow startup step failed/)
  assert.match(line, /"errorMessage"/)
  assert.match(line, /"orderCount":2/)
  assert.doesNotMatch(line, /errorStack|sourceAssetCount|auditReasons|fingerprint|filesystem paths/)
  assert.ok(line.length <= 200, "console line should remain bounded")
  output.destroy()
})


test("colors INFO blue and DEBUG magenta when terminal colors are enabled", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output, color: true })

  transport.write({
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    data: { message: "Harvester ready" },
  })
  transport.write({
    timestamp: "2026-11-05T12:00:01.000Z",
    level: "debug",
    data: { message: "Detailed diagnostic" },
  })

  assert.match(written, /\u001b\[34m.*INFO Harvester ready\u001b\[0m/)
  assert.match(written, /\u001b\[35m.*DEBUG Detailed diagnostic\u001b\[0m/)
  output.destroy()
})

test("does not emit ANSI color codes when color is disabled", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output, color: false })

  transport.write({
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    data: { message: "Plain terminal output" },
  })

  assert.doesNotMatch(written, /\u001b\[/)
  assert.match(written, /Plain terminal output/)
  output.destroy()
})


test("renders semantic SUCCESS and SYSTEM methods with distinct labels and colors", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output, color: true })
  const data = { message: "Lifecycle event" }

  transport.write({
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    method: "success",
    data,
  })
  transport.write({
    timestamp: "2026-11-05T12:00:01.000Z",
    level: "info",
    method: "system",
    data,
  })
  transport.write({
    timestamp: "2026-11-05T12:00:02.000Z",
    level: "info",
    method: "info",
    data,
  })
  transport.close()

  assert.match(written, /\u001b\[32m.*SUCCESS Lifecycle event\u001b\[0m/)
  assert.match(written, /\u001b\[36m.*SYSTEM Lifecycle event\u001b\[0m/)
  assert.match(written, /\u001b\[34m.*INFO Lifecycle event\u001b\[0m/)
  assert.equal((written.match(/Lifecycle event/g) ?? []).length, 3)
  assert.doesNotMatch(written, /repeated/)
  output.destroy()
})

test("keeps colored semantic labels within the configured console line limit", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output, color: true })

  transport.write({
    timestamp: "2026-11-05T12:00:00.000Z",
    level: "info",
    method: "success",
    data: { message: "x".repeat(240) },
  })

  const plainLine = written.replace(/\u001b\[[0-9;]*m/g, "").trimEnd()
  assert.ok(plainLine.length <= 200)
  output.destroy()
})

test("omits INFO labels while retaining DEBUG, WARN, and ERROR labels", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output, color: false })

  for (const [level, message] of [
    ["info", "Informational event"],
    ["debug", "Debug detail"],
    ["warn", "Warning event"],
    ["error", "Failure event"],
  ]) {
    transport.write({
      timestamp: "2026-11-05T12:00:00.000Z",
      level,
      data: { message },
    })
  }

  assert.match(written, / Informational event/)
  assert.doesNotMatch(written, /INFO Informational event/)
  assert.match(written, /DEBUG Debug detail/)
  assert.match(written, /WARN Warning event/)
  assert.match(written, /ERROR Failure event/)
  output.destroy()
})
