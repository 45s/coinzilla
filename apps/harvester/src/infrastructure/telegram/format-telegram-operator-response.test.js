import nodeTest from "node:test"
const test = (...args) => {
  const [name, ...testArguments] = args
  return nodeTest(`[format-telegram-operator-response.test.js] ${  name}`, ...testArguments)
}
import assert from "node:assert/strict"
import {
  formatTelegramOperatorMarkets,
  formatTelegramOperatorPositions,
  formatTelegramOperatorOrders,
  formatTelegramOperatorBalances,
} from "./format-telegram-operator-response.js"

test("formats active and retained position inventory separately", () => {
  const text = formatTelegramOperatorPositions({
    snapshot: {
      observedAt: 1000,
      positions: [{
        symbol: "DOGEUSDT",
        baseAsset: "DOGE",
        quoteAsset: "USDT",
        activeQuantity: "8",
        freeQuantity: "1",
        totalQuantity: "9",
        investedQuote: "0.96",
        quoteNetCashFlow: "-0.96",
        recovery: null,
      }],
    },
  })
  assert.match(text, /active 8 DOGE/)
  assert.match(text, /Free inventory: 1 DOGE/)
  assert.match(text, /Total inventory: 9 DOGE/)
})

test("formats Harvester and external order ownership explicitly", () => {
  const text = formatTelegramOperatorOrders({
    snapshot: {
      observedAt: 1000,
      orders: [
        { ownership: "HARVESTER",
symbol: "DOGEUSDT",
side: "BUY",
status: "OPEN",
brokerOrderId: "101" },
        { ownership: "EXTERNAL",
symbol: "BTCUSDT",
side: "SELL",
status: "OPEN",
brokerOrderId: "202" },
      ],
    },
  })
  assert.match(text, /HARVESTER DOGEUSDT BUY/)
  assert.match(text, /EXTERNAL BTCUSDT SELL/)
})

test("formats exchange balance freshness and free/locked/total values", () => {
  const text = formatTelegramOperatorBalances({
    snapshot: {
      observedAt: 1000,
      sourceTime: 900,
      ageMs: 100,
      balances: [{ asset: "USDT",
free: "100",
locked: "10",
total: "110" }],
    },
  })
  assert.match(text, /100ms ago/)
  assert.match(text, /USDT: free 100 \| locked 10 \| total 110/)
})

test("formats emergency BUY pause state separately from the legacy market pause", () => {
  const text = formatTelegramOperatorMarkets({
    snapshot: {
      observedAt: 1000,
      markets: [{
        symbol: "DOGEUSDT",
        enabled: true,
        readiness: "READY",
        operatorPaused: false,
        operatorBuysPaused: true,
        safetyPaused: false,
        recoveryManagedPaused: false,
        blockers: ["OPERATOR_BUYS_PAUSED"],
      }],
    },
  })

  assert.match(text, /Operator pause: OFF/, "Emergency BUY pause must not be conflated with the legacy market pause.")
  assert.match(text, /BUY pause: ACTIVE/, "Market status must expose the independent emergency BUY gate.")
})
