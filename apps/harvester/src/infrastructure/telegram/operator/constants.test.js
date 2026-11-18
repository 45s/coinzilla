import assert from "node:assert/strict"
import test from "node:test"
import {
  TELEGRAM_OPERATOR_ACTIONS,
  TELEGRAM_OPERATOR_MARKET_ACTION_PATTERN,
  TELEGRAM_OPERATOR_QUERY_STAGES,
} from "./constants.js"

test("exposes immutable Telegram operator action values", () => {
  assert.deepEqual(TELEGRAM_OPERATOR_ACTIONS, {
    PAUSE: "PAUSE",
    RESUME: "RESUME",
    PAUSE_BUYS: "PAUSE_BUYS",
    RESUME_BUYS: "RESUME_BUYS",
    PAUSE_ALL_BUYS: "PAUSE_ALL_BUYS",
    RESUME_ALL_BUYS: "RESUME_ALL_BUYS",
    PAUSE_MENU: "PAUSE_MENU",
    RESUME_MENU: "RESUME_MENU",
  }, "Telegram operator action values must remain stable for command and callback routing.")
  assert.equal(Object.isFrozen(TELEGRAM_OPERATOR_ACTIONS), true, "Telegram operator action values must not be mutable at runtime.")
  assert.equal(TELEGRAM_OPERATOR_MARKET_ACTION_PATTERN, "PAUSE|RESUME", "The callback parser must retain its existing market action vocabulary.")
})

test("exposes immutable Telegram query lifecycle stages", () => {
  assert.deepEqual(TELEGRAM_OPERATOR_QUERY_STAGES, {
    EXECUTION: "QUERY_EXECUTION",
    STARTED: "QUERY_STARTED",
    COMPLETED: "QUERY_COMPLETED",
  }, "Query diagnostic stage values must remain stable for structured log consumers.")
  assert.equal(Object.isFrozen(TELEGRAM_OPERATOR_QUERY_STAGES), true, "Query lifecycle stages must not be mutable at runtime.")
})
