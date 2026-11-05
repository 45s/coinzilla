import { createWriteStream, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { spawn } from "node:child_process"

const logDirectory = resolve(process.cwd(), "../../logs_harvester")
const logPath = resolve(logDirectory, "terminal.log")

mkdirSync(logDirectory, { recursive: true })

const logStream = createWriteStream(logPath, { flags: "a" })
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
    },
  },
)

let childClosed = false
let logStreamFailed = false

const closeLogStream = () => new Promise((resolveClose) => {
  if (logStream.destroyed || logStream.closed) {
    resolveClose()
    return
  }
  logStream.end(resolveClose)
})

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

const forwardOutput = (stream, output) => {
  stream.on("data", (chunk) => {
    output.write(chunk)
    if (!logStreamFailed) logStream.write(chunk)
  })
}

forwardOutput(child.stdout, process.stdout)
forwardOutput(child.stderr, process.stderr)

logStream.on("error", (error) => {
  if (logStreamFailed) return
  logStreamFailed = true
  process.stderr.write(`Failed to write Harvester terminal log: ${error.message}\\n`)
  process.exitCode = 1
  if (!childClosed && !child.killed) child.kill("SIGTERM")
})

child.on("error", (error) => {
  process.stderr.write(`Failed to start Harvester: ${error.message}\\n`)
  process.exitCode = 1
})

child.on("close", async (code, signal) => {
  childClosed = true
  process.removeListener("SIGINT", onSigint)
  process.removeListener("SIGTERM", onSigterm)

  await closeLogStream()
  if (code !== null) {
    process.exitCode = code
  } else if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1
  } else {
    process.exitCode = logStreamFailed ? 1 : 0
  }
})
