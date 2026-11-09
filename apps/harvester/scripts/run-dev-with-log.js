import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createWriteStream, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { spawn } from "node:child_process"
import { forwardChildOutput } from "./forward-child-output.js"
import { createHarvesterLogSessionPaths } from "../src/infrastructure/logging/create-harvester-log-session-paths.js"

const logDirectory = resolve(process.cwd(), "logs")
const logPath = resolve(logDirectory, "terminal.log")
const sessionStartedAt = new Date().toISOString()
const runtimeSessionId = randomUUID()
const sessionPaths = createHarvesterLogSessionPaths({
  directory: logDirectory,
  startedAt: sessionStartedAt,
  runtimeSessionId,
})

mkdirSync(logDirectory, { recursive: true })

const logStreams = [
  createWriteStream(logPath, { flags: "a" }),
  createWriteStream(sessionPaths.terminal, { flags: "wx" }),
]
const [, sessionLogStream] = logStreams

const streamOpenResults = await Promise.allSettled(logStreams.map((stream) => new Promise((resolve, reject) => {
  if (stream.fd !== null) {
    resolve()
    return
  }
  stream.once("open", resolve)
  stream.once("error", reject)
})))
const streamOpenErrors = streamOpenResults
  .filter((result) => result.status === "rejected")
  .map((result) => result.reason)
if (streamOpenErrors.length > 0) {
  await Promise.allSettled(logStreams.map(async (stream) => {
    if (!stream.destroyed) stream.destroy()
    if (!stream.closed) await once(stream, "close")
  }))
  throw streamOpenErrors[0]
}

const child = spawn(
  process.execPath,
  ["--env-file=.env.development", "src/index.js"],
  {
    // On POSIX, isolate the child in its own process group so Ctrl+C is
    // handled once by this runner and can be forwarded deliberately.
    // Windows console control events are delivered to both processes.
    detached: process.platform !== "win32",
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      HARVESTER_LOG_COLOR: process.env.NO_COLOR === undefined && process.stdout.isTTY
        ? "1"
        : "0",
      HARVESTER_PROCESS_STARTED_AT: sessionStartedAt,
      HARVESTER_RUNTIME_SESSION_ID: runtimeSessionId,
    },
  },
)

let childClosed = false
let logStreamFailed = false

const closeLogStreams = () => Promise.all(logStreams.map((stream) => new Promise((resolveClose) => {
  if (stream.destroyed || stream.closed) { resolveClose(); return }
  stream.end(resolveClose)
})))

const handleSignal = (signal) => {
  // The child has its own process group on POSIX, so it needs an explicit
  // signal. On Windows, Ctrl+C is delivered to both console processes.
  if (process.platform !== "win32" && !childClosed && !child.killed) {
    child.kill(signal)
  }
}

const onSigint = () => handleSignal("SIGINT")
const onSigterm = () => handleSignal("SIGTERM")

process.once("SIGINT", onSigint)
process.once("SIGTERM", onSigterm)

const forwardOutput = async (stream, output) => {
  try {
    return await forwardChildOutput({
      source: stream,
      destinations: () => (!logStreamFailed ? logStreams : []),
      bestEffortDestinations: () => [output],
    })
  } catch (error) {
    if (!logStreamFailed) {
      process.stderr.write(`Failed to forward Harvester output: ${error.message}\n`)
      process.exitCode = 1
      if (!childClosed && !child.killed) child.kill("SIGTERM")
    }
    return 0
  }
}

const outputForwarding = [
  forwardOutput(child.stdout, process.stdout),
  forwardOutput(child.stderr, process.stderr),
]

logStreams.forEach((stream) => stream.on("error", (error) => {
  if (logStreamFailed) {
    return
  }
  logStreamFailed = true
  process.stderr.write(`Failed to write Harvester terminal log: ${error.message}\n`)
  process.exitCode = 1
  if (!childClosed && !child.killed) child.kill("SIGTERM")
}))

child.on("error", (error) => {
  process.stderr.write(`Failed to start Harvester: ${error.message}\n`)
  process.exitCode = 1
})

child.on("close", async (code, signal) => {
  childClosed = true
  process.removeListener("SIGINT", onSigint)
  process.removeListener("SIGTERM", onSigterm)

  const droppedChunks = (await Promise.all(outputForwarding))
    .reduce((total, count) => total + count, 0)

  await closeLogStreams()

  if (
    droppedChunks > 0
    && !process.stderr.destroyed
    && !process.stderr.writableNeedDrain
  ) {
    process.stderr.write(
      `Harvester terminal display skipped ${droppedChunks} output chunk(s); full child output remains in ${logPath} and ${sessionLogStream.path}\n`,
    )
  }

  if (logStreamFailed) {
    process.exitCode = 1
  } else if (code !== null) {
    process.exitCode = code
  } else if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1
  } else {
    process.exitCode ??= 0
  }
})
