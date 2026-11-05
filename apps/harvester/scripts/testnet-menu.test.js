import test from "node:test"
import assert from "node:assert/strict"

import {
  buildTestnetMenuArguments,
  normalizePromptAnswer,
  TESTNET_MENU_ACTIONS,
} from "./testnet-menu-utils.js"

test("menu exposes all existing TESTNET and journal operations", () => {
  assert.deepEqual(
    TESTNET_MENU_ACTIONS.filter(({ script }) => script).map(({ script }) => script),
    [
      "list-testnet-open-orders.js",
      "cancel-testnet-open-orders.js",
      "list-testnet-balances.js",
      "sell-testnet-zro.js",
      "list-testnet-order-history.js",
      "list-testnet-trades.js",
      "reconcile-journal-account-balances.js",
      "audit-testnet-account.js",
    ],
  )
})

test("does not mark order cancellation or ZRO sale for interactive confirmation", () => {
  assert.equal(TESTNET_MENU_ACTIONS.find(({ id }) => id === "cancel-orders").destructive, undefined)
  assert.equal(TESTNET_MENU_ACTIONS.find(({ id }) => id === "sell-zro").destructive, undefined)
})

test("builds order-history arguments with defaults and supplied values", () => {
  assert.deepEqual(buildTestnetMenuArguments({ actionId: "history" }), ["ZROUSDT", "20"])
  assert.deepEqual(
    buildTestnetMenuArguments({
      actionId: "history",
      answers: { symbol: "DOGEUSDT", limit: "50" },
    }),
    ["DOGEUSDT", "50"],
  )
})

test("builds trade-history arguments and omits an optional fromId", () => {
  assert.deepEqual(buildTestnetMenuArguments({ actionId: "trades" }), ["DOGEUSDT", "1000"])
  assert.deepEqual(
    buildTestnetMenuArguments({
      actionId: "trades",
      answers: { symbol: "ZROUSDT", limit: "25", fromId: "123" },
    }),
    ["ZROUSDT", "25", "123"],
  )
})

test("passes an optional journal directory only when supplied", () => {
  assert.deepEqual(buildTestnetMenuArguments({ actionId: "journal-audit" }), [])
  assert.deepEqual(
    buildTestnetMenuArguments({
      actionId: "journal-audit",
      answers: { directory: "test-logs" },
    }),
    ["test-logs"],
  )
})

test("normalizes prompt answers safely when input is missing or blank", () => {
  assert.equal(normalizePromptAnswer(undefined), "")
  assert.equal(normalizePromptAnswer(null), "")
  assert.equal(normalizePromptAnswer("  "), "")
  assert.equal(normalizePromptAnswer("  DOGEUSDT  "), "DOGEUSDT")
  assert.equal(normalizePromptAnswer(undefined, "DOGEUSDT"), "DOGEUSDT")
})
