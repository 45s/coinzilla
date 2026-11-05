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
  { stdio: ["inherit", "pipe", "pipe"] }
)

const forwardOutput = (stream, output) => {
  stream.on("data", (chunk) => {
    output.write(chunk)
    logStream.write(chunk)
  })
}

forwardOutput(child.stdout, process.stdout)
forwardOutput(child.stderr, process.stderr)

logStream.on("error", (error) => {
  process.stderr.write(`Failed to write Harvester terminal log: ${error.message}\n`)
  child.kill()
  process.exitCode = 1
})

child.on("error", (error) => {
  process.stderr.write(`Failed to start Harvester: ${error.message}\n`)
  process.exitCode = 1
})

child.on("close", (code, signal) => {
  logStream.end(() => {
    process.exitCode = code ?? (signal ? 1 : 0)
  })
})
