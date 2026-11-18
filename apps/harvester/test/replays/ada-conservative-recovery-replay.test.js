import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

const test = (...args) => {
  const [name, ...options] = args
  return nodeTest(`[ada-conservative-recovery-replay.test.js] ${name}`, ...options)
}

const MARKET_SYMBOL = "ADAUSDT"
const scenarioExpectations = {
  initialPrice: "0.15286",
  buyPrice: "0.1524",
  nextBuyPrice: "0.1519",
  sellPrice: "0.1531",
  sellFillPrice: "0.1531",
  expectedSellQuantity: "99.8",
  expectedFreeQuantity: "0.1",
  expectedProfit: "0.04910062",
}

const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        ADAUSDT: {
          enabled: true,
          tradingEnvironment: "testnet",
          enableVolatilityProtection: false,
          externalOrdersPolicy: "ignore",
          investment: 200,
          orderQuantity: 50,
          keepQuantity: 0,
          minProfit: 0.05,
          priceStepPercent: 0.3,
          pricePrecision: 4,
          quantityPrecision: 1,
          // Historical 2026-11-17 pair configuration; actual fill commissions are supplied explicitly below.
          makerPercent: 0.075,
          takerPercent: 0.075,
        },
      },
    },
  },
}

test("replays the 2026-11-17 ADA cycle and preserves the below-target outcome through shutdown", async (t) => {
  const replay = await createDogeTradingReplay({
    marketSymbol: MARKET_SYMBOL,
    appConfig,
    scenarioExpectations,
    exchangeFilters: {
      tickSize: "0.0001",
      minQty: "0.1",
      stepSize: "0.1",
      minNotional: "5",
    },
  })
  let stopped = false
  t.after(async () => {
    if (!stopped) {
      await replay.runtime.stop()
    }
  })

  const initialBuySubmission = replay.waitForSubmittedOrder("BUY")
  await replay.publishMarketPrice(scenarioExpectations.initialPrice)
  const firstBuy = await initialBuySubmission
  assert.equal(firstBuy.price, "0.1524")
  assert.equal(firstBuy.quantity, "50")

  const firstRecoverySellSubmission = replay.waitForSubmittedOrder("SELL")
  const secondBuySubmission = replay.waitForSubmittedOrder("BUY", 2)
  await replay.publishMarketPrice(scenarioExpectations.buyPrice)
  const firstBuyFill = await replay.publishFullOrderFill({
    order: firstBuy,
    price: "0.1524",
    tradeId: "ADA-BUY-738419",
    commissionAmount: "0.05",
    commissionAsset: "ADA",
  })
  assert.equal(firstBuyFill.ok, true, firstBuyFill.errors?.[0]?.message)
  const [firstRecoverySell, secondBuy] = await Promise.all([
    firstRecoverySellSubmission,
    secondBuySubmission,
  ])
  assert.equal(firstRecoverySell.price, "0.1539")
  assert.equal(firstRecoverySell.quantity, "49.9")
  assert.equal(secondBuy.price, "0.1519")
  assert.equal(secondBuy.quantity, "50")

  const replacementRecoverySellSubmission = replay.waitForSubmittedOrder("SELL", 2)
  const thirdBuySubmission = replay.waitForSubmittedOrder("BUY", 3)
  await replay.publishMarketPrice(secondBuy.price)
  const secondBuyFill = await replay.publishFullOrderFill({
    order: secondBuy,
    price: "0.1519",
    tradeId: "ADA-BUY-738559",
    commissionAmount: "0.05",
    commissionAsset: "ADA",
  })
  assert.equal(secondBuyFill.ok, true, secondBuyFill.errors?.[0]?.message)
  const [replacementRecoverySell, thirdBuy] = await Promise.all([
    replacementRecoverySellSubmission,
    thirdBuySubmission,
  ])
  assert.equal(replacementRecoverySell.price, scenarioExpectations.sellPrice)
  assert.equal(replacementRecoverySell.quantity, scenarioExpectations.expectedSellQuantity)
  assert.ok(
    replay.confirmedCanceledOrders.some((order) => order.clientOrderId === firstRecoverySell.clientOrderId),
    "the superseded recovery SELL must be authoritatively canceled before replacement",
  )
  assert.equal(thirdBuy.price, "0.1514")
  assert.equal(thirdBuy.quantity, "50")

  const finalSellFill = await replay.publishFullOrderFill({
    order: replacementRecoverySell,
    price: scenarioExpectations.sellFillPrice,
    tradeId: "ADA-SELL-738736",
    timestamp: 1794909224000,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  assert.equal(finalSellFill.ok, true, finalSellFill.errors?.[0]?.message)

  const buyReports = replay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "BUY")
    .map(({ fill }) => ({
      quantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }))
  assert.deepEqual(buyReports, [
    {
      quantity: "50",
      quoteQuantity: "7.62",
      commissionAmount: "0.05",
      commissionAsset: "ADA",
    },
    {
      quantity: "50",
      quoteQuantity: "7.595",
      commissionAmount: "0.05",
      commissionAsset: "ADA",
    },
  ])

  const sellReports = replay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "SELL")
    .map(({ fill }) => ({
      quantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }))
  assert.deepEqual(sellReports, [{
    quantity: "99.8",
    quoteQuantity: "15.27938",
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  }])

  const position = replay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL })
  assert.equal(position.baseQuantity.amount, "0.1")
  assert.equal(position.freeBaseQuantity.amount, "0")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(position.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "the 0.04910062 USDT realized profit is below the configured 0.05 USDT minimum",
  )
  const notCompleted = replay.receivedLifecycleEvents.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(notCompleted, "the terminal SELL must persist an explicit non-completed recovery outcome")
  assert.equal(notCompleted.data.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(notCompleted.data.sellOrderClientId, replacementRecoverySell.clientOrderId)
  assert.equal(notCompleted.data.sellOrderBrokerOrderId, replacementRecoverySell.brokerOrderId)

  const lifecycleEventCountBeforeDuplicate = replay.receivedLifecycleEvents.length
  await replay.publishFullOrderFill({
    order: replacementRecoverySell,
    price: scenarioExpectations.sellFillPrice,
    tradeId: "ADA-SELL-738736",
    timestamp: 1794909224000,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  const positionAfterDuplicate = replay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL })
  assert.equal(positionAfterDuplicate.baseQuantity.amount, "0.1")
  assert.equal(positionAfterDuplicate.spent.amount, "15.215")
  assert.equal(positionAfterDuplicate.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(replay.receivedLifecycleEvents.length, lifecycleEventCountBeforeDuplicate)

  await replay.runtime.stop()
  stopped = true
  assert.ok(
    replay.confirmedCanceledOrders.some((order) => order.clientOrderId === thirdBuy.clientOrderId),
    "shutdown must cancel the still-open next BUY without completing the below-target recovery cycle",
  )
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "shutdown must not convert an incomplete recovery cycle into a completed one",
  )
})
