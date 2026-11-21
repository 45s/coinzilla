import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import test from "node:test"
import { askForOrderConfirmation } from "./run-order-command.js"

const order = {
  symbol: "HYPEUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "30",
  quantity: "0.4",
  notional: "12",
}

test("operator approves the exact displayed order with Enter and no typed phrase", async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const output = []
  stdout.on("data", (chunk) => output.push(chunk.toString()))
  const confirmation = askForOrderConfirmation({
    order,
    stdin,
    stdout,
  })

  stdin.end("\n")

  assert.equal(await confirmation, true, "an empty Enter response is the explicit final approval")
  assert.match(output.join(""), /HYPEUSDT.*0\.4 HYPE at 30 USDT.*12 USDT notional/)
})

test("any typed response or EOF declines the order", async () => {
  const typedInput = new PassThrough()
  const typedOutput = new PassThrough()
  const typedConfirmation = askForOrderConfirmation({
    order,
    stdin: typedInput,
    stdout: typedOutput,
  })
  typedInput.end("no\n")
  assert.equal(await typedConfirmation, false, "a non-empty response must decline")

  const closedInput = new PassThrough()
  const closedOutput = new PassThrough()
  const closedConfirmation = askForOrderConfirmation({
    order,
    stdin: closedInput,
    stdout: closedOutput,
  })
  closedInput.end()
  assert.equal(await closedConfirmation, false, "EOF must never be interpreted as operator approval")
})
