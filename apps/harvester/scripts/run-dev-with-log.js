import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { finished } from "node:stream/promises"
import { createWriteStream, mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import {
  createHarvesterArchiveProcessIdentity,
  persistHarvesterArchiveProcessIdentity,
} from "./capture-harvester-archive-process-identity.js"
import { forwardChildOutput } from "./forward-child-output.js"
import { createHarvesterLogSessionPaths } from "../src/infrastructure/logging/create-harvester-log-session-paths.js"

async function readLoggerStreamsCompletion({ sessionDirectory, runtimeSessionId } = {}) {
  try {
    const completion = JSON.parse(await readFile(resolve(sessionDirectory, "log-streams-completed.json"), "utf8"))
    return completion.runtimeSessionId === runtimeSessionId
      && completion.logStreamsComplete === true
      && completion.streams?.harvesterLog === true
      && completion.streams?.traceLog === true
  } catch {
    return false
  }
}

function resolveTerminalCaptureComplete({ childStarted, logStreamFailed, outputForwardingFailed, logStreamsClosed } = {}) {
  return childStarted && !logStreamFailed && !outputForwardingFailed && logStreamsClosed
}

async function persistDevRunnerProcessCompletion({
  sessionDirectory,
  runtimeSessionId,
  sessionStartedAt,
  processId,
  code,
  signal,
  childStarted,
  logStreamFailed,
  outputForwardingFailed,
  logStreamsClosed,
} = {}) {
  const loggerStreamsComplete = await readLoggerStreamsCompletion({ sessionDirectory, runtimeSessionId })
  const terminalCaptureComplete = resolveTerminalCaptureComplete({
    childStarted,
    logStreamFailed,
    outputForwardingFailed,
    logStreamsClosed,
  })
  const completion = {
    formatVersion: 1,
    application: "harvester",
    runtimeSessionId,
    startedAt: sessionStartedAt,
    endedAt: new Date().toISOString(),
    processId,
    exitCode: code,
    signal,
    loggerStreamsComplete,
    terminalCaptureComplete,
    logStreamsComplete: loggerStreamsComplete && terminalCaptureComplete,
  }
  await writeFile(resolve(sessionDirectory, "process-completed.json"), `${JSON.stringify(completion, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
}

function sumOutputChunkCounts({ outputChunkCounts } = {}) {
  let total = 0
  for (const count of outputChunkCounts) {
    total += count
  }
  return total
}

function reportDroppedOutputChunks({ droppedChunks, logPath, sessionLogStream } = {}) {
  if (droppedChunks > 0 && !process.stderr.destroyed && !process.stderr.writableNeedDrain) {
    process.stderr.write(
      `Harvester terminal display skipped ${droppedChunks} output chunk(s); full child output remains in ${logPath} and ${sessionLogStream.path}\n`,
    )
  }
}

function resolveDevRunnerExitCode({ code, signal, logStreamFailed } = {}) {
  if (logStreamFailed) {
    process.exitCode = 1
  } else if (code !== null) {
    process.exitCode = code
  } else if (signal === "SIGINT") {
    process.exitCode = 130
  } else if (signal === "SIGTERM") {
    process.exitCode = 143
  } else if (signal) {
    process.exitCode = 1
  } else {
    process.exitCode ??= 0
  }
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cliArguments = process.argv.slice(2)
const buildMetadata = captureBuildMetadata({
  application: "harvester-dev-runner",
  version: packageMetadata.version,
  cwd: packageDirectory,
  env: process.env,
})
const runnerIdentity = [
  `harvester-dev-runner ${packageMetadata.version}`,
  `commit ${buildMetadata.source.commit ?? "unknown"}`,
  `worktree ${buildMetadata.source.workingTree}`,
  `node ${process.version}`,
].join(" | ")
if (cliArguments.length === 1 && cliArguments[0] === "--version") {
  process.stdout.write(`${runnerIdentity}\n`)
} else {
  if (cliArguments.length > 0) {
    throw new TypeError("Usage: dev [--version]")
  }
  if (process.env.TRADING_MODE !== "testnet") {
    throw new Error("The Harvester DEV runner requires TRADING_MODE=testnet; LIVE execution must use the explicit production entrypoint.")
  }
  process.stdout.write(`${runnerIdentity}\n`)
  const logDirectory = resolve(packageDirectory, "logs")
  const cumulativeDirectory = resolve(logDirectory, "cumulative")
  const logPath = resolve(cumulativeDirectory, "terminal.log")
  const sessionStartedAt = new Date().toISOString()
  const runtimeSessionId = randomUUID()
  const archiveProcessIdentity = createHarvesterArchiveProcessIdentity({
    startedAt: sessionStartedAt,
    runtimeSessionId,
    tradingMode: process.env.TRADING_MODE,
    source: buildMetadata.source,
  })
  const sessionPaths = createHarvesterLogSessionPaths({
    directory: logDirectory,
    startedAt: sessionStartedAt,
    runtimeSessionId,
  })

  mkdirSync(cumulativeDirectory, { recursive: true })
  mkdirSync(sessionPaths.sessionDirectory, { recursive: true })
  await persistHarvesterArchiveProcessIdentity({
    filename: resolve(sessionPaths.sessionDirectory, "process-identity.json"),
    identity: archiveProcessIdentity,
  })

  const logStreams = [
    createWriteStream(logPath, { flags: "a" }),
    createWriteStream(sessionPaths.terminal, { flags: "wx" }),
  ]
  const [, sessionLogStream] = logStreams
  const childProcess = { current: undefined }
  let childStarted = false
  let childClosed = false
  let logStreamFailed = false
  let outputForwardingFailed = false
  const onLogStreamError = (error) => {
    if (logStreamFailed) {
      return
    }
    logStreamFailed = true
    process.stderr.write(`Failed to write Harvester terminal log: ${error.message}\n`)
    process.exitCode = 1
    if (childProcess.current && !childClosed && !childProcess.current.killed) {
      childProcess.current.kill("SIGTERM")
    }
  }
  logStreams.forEach((stream) => stream.on("error", onLogStreamError))

  const streamOpenResults = await Promise.allSettled(logStreams.map((stream) => new Promise((...callbacks) => {
    const [resolveOpen, rejectOpen] = callbacks
    stream.once("open", resolveOpen)
    stream.once("error", rejectOpen)
  })))
  const streamOpenErrors = streamOpenResults
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
  if (streamOpenErrors.length > 0) {
    await Promise.allSettled(logStreams.map(async (stream) => {
      if (!stream.destroyed) {
        stream.destroy()
      }
      if (!stream.closed) {
        await once(stream, "close")
      }
    }))
    throw streamOpenErrors[0]
  }

  childProcess.current = spawn(
    process.execPath,
    ["src/index.js"],
    {
      cwd: packageDirectory,
      // On POSIX, isolate the child in its own process group so Ctrl+C is
      // handled once by this runner and can be forwarded deliberately.
      // Windows console control events are delivered to both processes.
      detached: process.platform !== "win32",
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        COINZILLA_LOG_COLOR: process.env.NO_COLOR === undefined && process.stdout.isTTY
          ? "1"
          : "0",
        COINZILLA_PROCESS_STARTED_AT: sessionStartedAt,
        COINZILLA_RUNTIME_SESSION_ID: runtimeSessionId,
      },
    },
  )
  if (logStreamFailed) {
    childProcess.current.kill("SIGTERM")
  }

  const closeLogStreams = async () => {
    const results = await Promise.allSettled(logStreams.map(async (stream) => {
      if (stream.closed) {
        return
      }
      if (stream.destroyed) {
        await once(stream, "close")
        return
      }
      const completion = finished(stream)
      stream.end()
      await completion
    }))
    const streamsClosed = results.every((result) => result.status === "fulfilled")
    if (!streamsClosed) {
      process.exitCode = 1
    }
    return streamsClosed
  }

  const handleSignal = (signal) => {
    // The child has its own process group on POSIX, so it needs an explicit
    // signal. On Windows, Ctrl+C is delivered to both console processes.
    if (process.platform !== "win32" && !childClosed && !childProcess.current.killed) {
      childProcess.current.kill(signal)
    }
  }

  const onSigint = () => handleSignal("SIGINT")
  const onSigterm = () => handleSignal("SIGTERM")

  process.once("SIGINT", onSigint)
  process.once("SIGTERM", onSigterm)

  const forwardOutput = async ({ stream, output }) => {
    try {
      return await forwardChildOutput({
        source: stream,
        destinations: () => (!logStreamFailed ? logStreams : []),
        bestEffortDestinations: () => [output],
      })
    } catch (error) {
      outputForwardingFailed = true
      if (!logStreamFailed) {
        process.stderr.write(`Failed to forward Harvester output: ${error.message}\n`)
        process.exitCode = 1
        if (!childClosed && !childProcess.current.killed) {
          childProcess.current.kill("SIGTERM")
        }
      }
      return 0
    }
  }

  const outputForwarding = [
    forwardOutput({
      stream: childProcess.current.stdout,
      output: process.stdout,
    }),
    forwardOutput({
      stream: childProcess.current.stderr,
      output: process.stderr,
    }),
  ]

  childProcess.current.on("spawn", () => {
    childStarted = true
  })

  childProcess.current.on("error", (error) => {
    process.stderr.write(`Failed to start Harvester: ${error.message}\n`)
    process.exitCode = 1
  })

  childProcess.current.on("close", async (...closeArguments) => {
    const [code, signal] = closeArguments
    childClosed = true
    process.removeListener("SIGINT", onSigint)
    process.removeListener("SIGTERM", onSigterm)
    const outputChunkCounts = await Promise.all(outputForwarding)
    const droppedChunks = sumOutputChunkCounts({ outputChunkCounts })
    const logStreamsClosed = await closeLogStreams()
    try {
      await persistDevRunnerProcessCompletion({
        sessionDirectory: sessionPaths.sessionDirectory,
        runtimeSessionId,
        sessionStartedAt,
        processId: childProcess.current.pid ?? null,
        code,
        signal,
        childStarted,
        logStreamFailed,
        outputForwardingFailed,
        logStreamsClosed,
      })
    } catch (error) {
      process.stderr.write(`Failed to persist Harvester session completion: ${error.message}\n`)
      process.exitCode = 1
    }
    reportDroppedOutputChunks({ droppedChunks, logPath, sessionLogStream })
    resolveDevRunnerExitCode({ code, signal, logStreamFailed })
  }))

}