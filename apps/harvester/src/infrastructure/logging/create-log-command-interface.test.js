import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import test from "node:test"
import { createLogCommandInterface } from "./create-log-command-interface.js"

const createLogger = () => {
  const levels = []
  return {
    levels,
    setLevel: (input) => {
      levels.push(input)
      return { transports: [{ name: "console", level: input.level }] }
    },
    getConfig: () => ({ transports: [{ name: "console", level: levels.at(-1)?.level ?? "info" }] }),
  }
}

test("registers /log level and status commands only for TTY input", () => {
  const input = new PassThrough()
  input.isTTY = true
  const output = new PassThrough()
  let outputText = ""
  output.on("data", (chunk) => { outputText += chunk.toString() })
  const logger = createLogger()
  const command = createLogCommandInterface({ logger, input, output })

  assert.equal(command.enabled, true)
  input.write("/log debug\n")
  input.write("/log trace\n")
  input.write("/log info\n")
  input.write("/log status\n")

  assert.deepEqual(logger.levels, [
    { transport: "console", level: "debug" },
    { transport: "console", level: "trace" },
    { transport: "console", level: "info" },
  ])
  assert.match(outputText, /Console log level: debug/)
  assert.match(outputText, /"level": "info"/)
  command.close()
  input.destroy()
  output.destroy()
})

test("does not attach a readline listener to non-interactive stdin", () => {
  const input = new PassThrough()
  input.isTTY = false
  const output = new PassThrough()
  const logger = createLogger()
  const command = createLogCommandInterface({ logger, input, output })

  assert.equal(command.enabled, false)
  input.write("/log debug\n")
  assert.deepEqual(logger.levels, [])
  command.close()
  input.destroy()
  output.destroy()
})

test("reports invalid commands without changing logger configuration", () => {
  const input = new PassThrough()
  input.isTTY = true
  const output = new PassThrough()
  let outputText = ""
  output.on("data", (chunk) => { outputText += chunk.toString() })
  const logger = createLogger()
  const command = createLogCommandInterface({ logger, input, output })

  input.write("/log verbose\n")
  input.write("/log debug extra\n")
  assert.deepEqual(logger.levels, [])
  assert.equal((outputText.match(/Usage:/g) ?? []).length, 2)
  command.close()
  input.destroy()
  output.destroy()
})
