import assert from "node:assert/strict"
import test from "node:test"
import { prepareTelegramOperatorControl } from "./prepare-telegram-operator-control.js"

test("exposes the local application operator even when Telegram is disabled", async () => {
  let appendedFact
  const operationalStateStore = {
    async append(fact) {
      appendedFact = fact
      return { ok: true }
    },
  }
  const lifecycle = await prepareTelegramOperatorControl({
    telegramConfig: { enabled: false },
    operationalStateStore,
  })
  assert.equal(lifecycle.enabled, false)
  assert.equal(lifecycle.getOperator(), undefined)

  await lifecycle.start({
    engine: {
      async pauseBuys({ beforeApply } = {}) {
        await beforeApply?.()
        return { ok: true }
      },
      async resumeBuys() {
        return { ok: true }
      },
    },
  })
  const operator = lifecycle.getOperator()
  assert.equal(typeof operator.pauseMarket, "function")
  assert.equal(typeof operator.resumeMarket, "function")
  assert.equal(typeof operator.pauseAllBuys, "function")
  assert.equal(typeof operator.resumeAllBuys, "function")
  await operator.pauseMarket({
    actor: {
      id: "local-dashboard",
      roles: ["trading-operator"],
    },
    requestId: "local-pause-1",
    symbol: "BTCUSDT",
  })
  assert.equal(appendedFact.factType, "OPERATOR_MARKET_BUYS_PAUSED")

  await lifecycle.stop()
  assert.equal(lifecycle.getOperator(), undefined)
})
