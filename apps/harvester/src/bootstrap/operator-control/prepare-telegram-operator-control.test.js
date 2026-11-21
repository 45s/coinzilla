import assert from "node:assert/strict"
import test from "node:test"
import { prepareTelegramOperatorControl } from "./prepare-telegram-operator-control.js"

test("exposes the local application operator even when Telegram is disabled", async () => {
  const lifecycle = await prepareTelegramOperatorControl({
    telegramConfig: { enabled: false },
  })
  assert.equal(lifecycle.enabled, false)
  assert.equal(lifecycle.getOperator(), undefined)

  await lifecycle.start({
    engine: {
      pauseBuys() {},
      resumeBuys() {},
    },
  })
  const operator = lifecycle.getOperator()
  assert.equal(typeof operator.pauseMarket, "function")
  assert.equal(typeof operator.resumeMarket, "function")
  assert.equal(typeof operator.pauseAllBuys, "function")
  assert.equal(typeof operator.resumeAllBuys, "function")

  await lifecycle.stop()
  assert.equal(lifecycle.getOperator(), undefined)
})
