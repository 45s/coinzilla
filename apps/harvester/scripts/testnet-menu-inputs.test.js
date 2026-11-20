import test from "node:test"
import assert from "node:assert/strict"

import {
  buildTestnetMenuArguments,
  normalizePromptAnswer,
  TESTNET_MENU_ACTIONS,
  resolveTestnetMenuKeypress,
} from "./testnet-menu-inputs.js"

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
      answers: { symbol: "DOGEUSDT",
limit: "50" },
    }),
    ["DOGEUSDT", "50"],
  )
})

test("builds trade-history arguments and omits an optional fromId", () => {
  assert.deepEqual(buildTestnetMenuArguments({ actionId: "trades" }), ["DOGEUSDT", "1000"])
  assert.deepEqual(
    buildTestnetMenuArguments({
      actionId: "trades",
      answers: { symbol: "ZROUSDT",
limit: "25",
fromId: "123" },
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
  assert.equal(normalizePromptAnswer({ answer: undefined }), "")
  assert.equal(normalizePromptAnswer({ answer: null }), "")
  assert.equal(normalizePromptAnswer({ answer: "  " }), "")
  assert.equal(normalizePromptAnswer({ answer: "  DOGEUSDT  " }), "DOGEUSDT")
  assert.equal(normalizePromptAnswer({ answer: undefined,
fallback: "DOGEUSDT" }), "DOGEUSDT")
})

test("exits menu navigation for Ctrl+C, Escape, and Q", () => {
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: undefined,
      key: {
        ctrl: true,
        name: "c",
      },
      selectedIndex: 2,
      actionCount: 5,
    }),
    {
      type: "EXIT",
      selectedIndex: 2,
    },
    "Ctrl+C must exit without changing the selected action",
  )
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: undefined,
      key: {
        name: "escape",
      },
      selectedIndex: 1,
      actionCount: 5,
    }),
    {
      type: "EXIT",
      selectedIndex: 1,
    },
    "Escape must exit without changing the selected action",
  )
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: "q",
      key: {},
      selectedIndex: 3,
      actionCount: 5,
    }),
    {
      type: "EXIT",
      selectedIndex: 3,
    },
    "Q must exit without changing the selected action",
  )
})

test("wraps menu selection when navigating up and down", () => {
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: undefined,
      key: {
        name: "up",
      },
      selectedIndex: 0,
      actionCount: 5,
    }),
    {
      type: "MOVE",
      selectedIndex: 4,
    },
    "Up from the first action must wrap to the final action",
  )
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: undefined,
      key: {
        name: "down",
      },
      selectedIndex: 4,
      actionCount: 5,
    }),
    {
      type: "MOVE",
      selectedIndex: 0,
    },
    "Down from the final action must wrap to the first action",
  )
})

test("selects on Enter and ignores unrelated keypresses", () => {
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: undefined,
      key: {
        name: "return",
      },
      selectedIndex: 2,
      actionCount: 5,
    }),
    {
      type: "SELECT",
      selectedIndex: 2,
    },
    "Enter must select the currently highlighted action",
  )
  assert.deepEqual(
    resolveTestnetMenuKeypress({
      character: "x",
      key: {
        name: "x",
      },
      selectedIndex: 2,
      actionCount: 5,
    }),
    {
      type: "CONTINUE",
      selectedIndex: 2,
    },
    "An unrelated keypress must preserve the current selection",
  )
})
