import assert from "node:assert/strict"
import test from "node:test"
import { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"

test("parses supported read-only, entry, market and emergency BUY commands", () => {
  const scenarios = [
    ["/start", { type: "START" }],
    ["/menu", { type: "MENU" }],
    ["/help", { type: "HELP" }],
    ["/status", { type: "STATUS" }],
    ["/markets", { type: "MARKETS" }],
    ["/positions", { type: "POSITIONS" }],
    ["/orders", { type: "ORDERS" }],
    ["/balances", { type: "BALANCES" }],
    ["/pause LINKUSDT", { type: "PAUSE",
 symbol: "LINKUSDT" }],
    ["/resume linkusdt", { type: "RESUME",
 symbol: "LINKUSDT" }],
    ["/pauseallbuys", { type: "PAUSE_ALL_BUYS" }],
    ["/resumeallbuys", { type: "RESUME_ALL_BUYS" }],
    ["/pausebuys LINKUSDT", { type: "PAUSE_BUYS",
 symbol: "LINKUSDT" }],
    ["/resumebuys LINKUSDT", { type: "RESUME_BUYS",
 symbol: "LINKUSDT" }],
  ]
  for (const [commandText, expected] of scenarios) {
    assert.deepEqual(
      parseTelegramOperatorCommand(commandText),
      expected,
      "Every supported Command Center command must map to its stable action and normalized market.",
    )
  }
})

test("ignores ordinary text and commands addressed to another bot", () => {
  assert.deepEqual(
    parseTelegramOperatorCommand("hello"),
    { type: "IGNORE" },
    "Ordinary chat text must not become an operator command.",
  )
  assert.deepEqual(
    parseTelegramOperatorCommand("/status@another_bot", { botUsername: "coinzilla_bot" }),
    { type: "IGNORE" },
    "A command explicitly addressed to another bot must not reach this adapter.",
  )
})

test("rejects malformed commands without accepting extra or invalid arguments", () => {
  const invalidCommands = [
    "/pause",
    "/pause LINK-USDT",
    "/pause LINKUSDT extra",
    "/resumeallbuys LINKUSDT",
    "/balances extra",
    "/start extra",
  ]
  for (const commandText of invalidCommands) {
    assert.equal(
      parseTelegramOperatorCommand(commandText).type,
      "INVALID",
      "Malformed operator commands must be rejected instead of partially dispatched.",
    )
  }
})

test("maps persistent keyboard labels to the same read and control actions", () => {
  const scenarios = [
    ["Pause", "PAUSE_MENU"],
    ["Resume", "RESUME_MENU"],
    ["Status", "STATUS"],
    ["Markets", "MARKETS"],
    ["Portfolio", "POSITIONS"],
    ["Open Orders", "ORDERS"],
  ]
  for (const [label, type] of scenarios) {
    assert.equal(
      parseTelegramOperatorCommand(label).type,
      type,
      "Persistent keyboard labels must preserve the established Command Center action mapping.",
    )
  }
})
