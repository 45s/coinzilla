import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PassThrough } from "node:stream"
import { configureHarvesterLogging, createHarvesterConsoleTransport } from "./configure-harvester-logging.js"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"

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
    const logging = await configureHarvesterLogging({ logger, directory, processIdentity: { startedAt: "2026-11-05T12:00:00.000Z", runtimeSessionId: "session-one" } })
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
    const sessionDebugPath = path.join(directory, "harvester-2026-11-05_12-00-00-session-one.log")
    const sessionTracePath = path.join(directory, "harvester-trace-2026-11-05_12-00-00-session-one.log")
    assert.deepEqual(JSON.parse(debugLines[0]), entry)
    assert.equal(JSON.parse(traceLines[0]).level, "trace")
    assert.deepEqual(JSON.parse((await readFile(sessionDebugPath, "utf8")).trim()), entry, "each run must receive a timestamped DEBUG session file")
    assert.equal(JSON.parse((await readFile(sessionTracePath, "utf8")).trim()).level, "trace", "each run must receive a matching timestamped TRACE session file")

    await logging.close()
    assert.deepEqual((await readdir(directory)).sort(), [
      "harvester-2026-11-05_12-00-00-session-one.log",
      "harvester-trace-2026-11-05_12-00-00-session-one.log",
      "harvester-trace.log",
      "harvester.log",
    ])
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


test("retains the machine-readable Journal error code in compact console output", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({ output })

  transport.write({
    timestamp: "2026-11-09T12:00:00.000Z",
    level: "error",
    data: {
      message: "Optional Harvester Journal startup failed",
      errorCode: "JOURNAL_DIRECTORY_LOCKED",
    },
  })

  assert.match(written, /"errorCode":"JOURNAL_DIRECTORY_LOCKED"/)
  assert.doesNotMatch(written, /diagnosticId/)
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

  assert.match(written, /\u001b\[34m.*Harvester ready\u001b\[0m/)
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


test("renders semantic SUCCESS and SYSTEM methods with distinct colors without redundant labels", () => {
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
  assert.match(written, /\u001b\[36m.*Lifecycle event\u001b\[0m/)
  assert.match(written, /\u001b\[34m.*Lifecycle event\u001b\[0m/)
  assert.equal((written.match(/Lifecycle event/g) ?? []).length, 3)
  assert.doesNotMatch(written, /SYSTEM Lifecycle event/)
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
    ["INFO", "Informational event"],
    ["DEBUG", "Debug detail"],
    ["WARN", "Warning event"],
    ["ERROR", "Failure event"],
  ]) {
    transport.write({
      timestamp: "2026-11-05T12:00:00.000Z",
      level: level.toLowerCase(),
      method: level,
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

test("appends cumulative logs while keeping separate timestamped session histories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-log-sessions-"))
  try {
    const firstLogger = createLogger()
    const firstSession = await configureHarvesterLogging({ logger: firstLogger, directory, processIdentity: { startedAt: "2026-11-05T12:00:00.000Z", runtimeSessionId: "first-session" } })
    const firstEntry = { timestamp: "2026-11-05T12:00:01.000Z", level: "debug", data: { message: "first run" } }
    await firstLogger.transports.get("harvester-debug-file").write(firstEntry)
    await firstSession.close()

    const secondLogger = createLogger()
    const secondSession = await configureHarvesterLogging({ logger: secondLogger, directory, processIdentity: { startedAt: "2026-11-05T13:00:00.000Z", runtimeSessionId: "second-session" } })
    const secondEntry = { timestamp: "2026-11-05T13:00:01.000Z", level: "debug", data: { message: "second run" } }
    await secondLogger.transports.get("harvester-debug-file").write(secondEntry)
    await secondSession.close()

    const cumulativeEntries = (await readFile(path.join(directory, "harvester.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(cumulativeEntries, [firstEntry, secondEntry], "cumulative logs must retain entries from previous and current sessions")
    const firstEntries = (await readFile(path.join(directory, "harvester-2026-11-05_12-00-00-first-session.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    const secondEntries = (await readFile(path.join(directory, "harvester-2026-11-05_13-00-00-second-session.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(firstEntries, [firstEntry], "the first session file must contain only first-run diagnostics")
    assert.deepEqual(secondEntries, [secondEntry], "the second session file must contain only second-run diagnostics")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test("preserves pre-existing transports after partial logging setup failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-logs-existing-transport-"))
  const logger = createLogger()
  let existingDebugCloseCount = 0
  const existingDebugTransport = {
    name: "harvester-debug-file",
    level: "debug",
    write() {},
    close() { existingDebugCloseCount += 1 },
  }
  const processIdentity = {
    startedAt: "2026-11-09T12:10:00.000Z",
    runtimeSessionId: "existing-debug",
  }
  const sessionPaths = createHarvesterLogSessionPaths({
    directory,
    startedAt: processIdentity.startedAt,
    runtimeSessionId: processIdentity.runtimeSessionId,
  })
  try {
    logger.addTransport(existingDebugTransport)
    await writeFile(sessionPaths.trace, "preserve trace session\\n")

    await assert.rejects(
      configureHarvesterLogging({ logger, directory, processIdentity }),
      /EEXIST/,
      "a TRACE session collision must fail setup",
    )

    assert.equal(
      logger.transports.get("harvester-debug-file"),
      existingDebugTransport,
      "failed setup must not remove or close a pre-existing DEBUG transport",
    )
    assert.equal(existingDebugCloseCount, 0, "the existing DEBUG transport must remain open")
    assert.deepEqual(
      [...logger.transports.keys()],
      ["harvester-debug-file"],
      "failed setup must leave the logger's original transport configuration intact",
    )
    assert.equal(
      await readFile(sessionPaths.trace, "utf8"),
      "preserve trace session\\n",
      "failed setup must preserve the colliding session file",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects an existing session file before registering transports or leaking streams", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-logs-collision-"));
  const logger = createLogger();
  const sessionFile = path.join(directory, "harvester-2026-11-09_12-00-00-session-collision.log");
  try {
    await writeFile(sessionFile, "preserve existing session\n");
    await assert.rejects(
      configureHarvesterLogging({
        logger,
        directory,
        processIdentity: {
          startedAt: "2026-11-09T12:00:00.000Z",
          runtimeSessionId: "session-collision",
        },
      }),
      /EEXIST/,
      "a session filename collision must fail startup instead of silently omitting or mixing a session",
    );
    assert.equal(logger.transports.size, 0, "failed logging setup must not leave partially registered transports");
    assert.equal(
      await readFile(sessionFile, "utf8"),
      "preserve existing session\n",
      "exclusive session creation must never truncate an existing session file",
    );
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["harvester-2026-11-09_12-00-00-session-collision.log", "harvester.log"],
      "failed setup must close its cumulative stream while preserving the pre-existing session file",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("appends cumulative files while isolating and flushing consecutive process sessions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-log-restarts-"));
  const sessionIdentities = [
    { startedAt: "2026-11-09T12:00:00.000Z", runtimeSessionId: "first-run" },
    { startedAt: "2026-11-09T12:01:00.000Z", runtimeSessionId: "second-run" },
  ];
  try {
    for (const [index, processIdentity] of sessionIdentities.entries()) {
      const logger = createLogger();
      const logging = await configureHarvesterLogging({ logger, directory, processIdentity });
      const debugEntry = {
        timestamp: processIdentity.startedAt,
        level: "debug",
        method: "debug",
        data: { message: "session diagnostic " + (index + 1) },
      };
      const traceEntry = { ...debugEntry, level: "trace", method: "trace" };
      await logger.transports.get("harvester-debug-file").write(debugEntry);
      await logger.transports.get("harvester-trace-file").write(traceEntry);
      await logging.close();
      assert.deepEqual(
        [...logger.transports.keys()],
        ["console"],
        "graceful logging shutdown must unregister both structured file transports and retain the console transport",
      );
    }

    const cumulativeDebugEntries = (await readFile(path.join(directory, "harvester.log"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    const cumulativeTraceEntries = (await readFile(path.join(directory, "harvester-trace.log"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      cumulativeDebugEntries.map(({ data }) => data.message),
      ["session diagnostic 1", "session diagnostic 2"],
      "cumulative DEBUG history must append in order across process restarts",
    );
    assert.deepEqual(
      cumulativeTraceEntries.map(({ data }) => data.message),
      ["session diagnostic 1", "session diagnostic 2"],
      "cumulative TRACE history must append in order across process restarts",
    );

    for (const processIdentity of sessionIdentities) {
      const paths = createHarvesterLogSessionPaths({
        directory,
        startedAt: processIdentity.startedAt,
        runtimeSessionId: processIdentity.runtimeSessionId,
      });
      const debugEntries = (await readFile(paths.debug, "utf8")).trim().split("\n");
      const traceEntries = (await readFile(paths.trace, "utf8")).trim().split("\n");
      assert.equal(debugEntries.length, 1, "each DEBUG session file must contain only its own process entries");
      assert.equal(traceEntries.length, 1, "each TRACE session file must contain only its own process entries");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("closes the already-open DEBUG streams when TRACE session creation fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-logs-partial-"));
  const logger = createLogger();
  const processIdentity = {
    startedAt: "2026-11-09T12:05:00.000Z",
    runtimeSessionId: "trace-collision",
  };
  const traceSessionFile = path.join(directory, "harvester-trace-2026-11-09_12-05-00-trace-collision.log");
  try {
    await writeFile(traceSessionFile, "preserve trace history\n");
    await assert.rejects(
      configureHarvesterLogging({ logger, directory, processIdentity }),
      /EEXIST/,
      "TRACE session collision must abort setup after cleaning up the already-open DEBUG transport",
    );
    assert.equal(logger.transports.size, 0, "partial startup must not leave any file or console transport registered");
    assert.equal(
      await readFile(traceSessionFile, "utf8"),
      "preserve trace history\n",
      "failed TRACE setup must never overwrite the existing session file",
    );
    assert.equal(
      await readFile(path.join(directory, "harvester-2026-11-09_12-05-00-trace-collision.log"), "utf8"),
      "",
      "the partial DEBUG session file must be closed and remain available as an empty failed-start record",
    );
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [
        "harvester-2026-11-09_12-05-00-trace-collision.log",
        "harvester-trace-2026-11-09_12-05-00-trace-collision.log",
        "harvester-trace.log",
        "harvester.log",
      ],
      "failed partial setup must close every stream without deleting any created or pre-existing log file",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
