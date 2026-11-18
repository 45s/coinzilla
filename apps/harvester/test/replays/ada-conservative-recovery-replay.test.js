import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

const test = (...args) => {
  const [name, ...options] = args
  return nodeTest("[ada-conservative-recovery-replay.test.js] " + name, ...options)
}

const MARKET_SYMBOL = "ADAUSDT"
const SELL_TIMESTAMP = 1794909224000
const scenarioExpectations = {
  initialPrice: "0.15286",
  buyPrice: "0.1524",
  sellPrice: "0.1531",
  expectedSellQuantity: "99.8",
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
          // Historical 2026-11-17 pair config; actual fill commissions are supplied explicitly.
          makerPercent: 0.075,
          takerPercent: 0.075,
        },
      },
    },
  },
}

async function fillAdaBuy(replay, order, price, tradeId) {
  await replay.publishMarketPrice(price)
  const result = await replay.publishFullOrderFill({
    order,
    price,
    tradeId,
    commissionAmount: "0.05",
    commissionAsset: "ADA",
  })
  assert.equal(result.ok, true, result.errors?.[0]?.message)
}

async function submitAdaBuySequence(replay) {
  const initialBuySubmission = replay.waitForSubmittedOrder("BUY")
  await replay.publishMarketPrice(scenarioExpectations.initialPrice)
  const firstBuy = await initialBuySubmission
  assert.equal(firstBuy.price, "0.1524")
  assert.equal(firstBuy.quantity, "50")

  const firstSellSubmission = replay.waitForSubmittedOrder("SELL")
  const secondBuySubmission = replay.waitForSubmittedOrder("BUY", 2)
  await fillAdaBuy(replay, firstBuy, "0.1524", "ADA-BUY-738419")
  const [firstSell, secondBuy] = await Promise.all([firstSellSubmission, secondBuySubmission])
  assert.equal(firstSell.price, "0.1539")
  assert.equal(firstSell.quantity, "49.9")
  assert.equal(secondBuy.price, "0.1519")
  assert.equal(secondBuy.quantity, "50")

  const replacementSellSubmission = replay.waitForSubmittedOrder("SELL", 2)
  const thirdBuySubmission = replay.waitForSubmittedOrder("BUY", 3)
  await fillAdaBuy(replay, secondBuy, "0.1519", "ADA-BUY-738559")
  const [replacementSell, thirdBuy] = await Promise.all([replacementSellSubmission, thirdBuySubmission])
  assert.equal(replacementSell.price, scenarioExpectations.sellPrice)
  assert.equal(replacementSell.quantity, scenarioExpectations.expectedSellQuantity)
  assert.ok(
    replay.confirmedCanceledOrders.some((order) => order.clientOrderId === firstSell.clientOrderId),
    "the superseded recovery SELL must be authoritatively canceled before replacement",
  )
  assert.equal(thirdBuy.price, "0.1514")
  assert.equal(thirdBuy.quantity, "50")
  return { replacementSell, thirdBuy }
}

async function fillAdaRecoverySell(replay, replacementSell) {
  const result = await replay.publishFullOrderFill({
    order: replacementSell,
    price: scenarioExpectations.sellPrice,
    tradeId: "ADA-SELL-738736",
    timestamp: SELL_TIMESTAMP,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  assert.equal(result.ok, true, result.errors?.[0]?.message)
}

function assertAdaExecutionReports(replay) {
  const buys = replay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "BUY")
    .map(({ fill }) => ({
      quantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }))
  assert.deepEqual(buys, [
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

  const sells = replay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "SELL")
    .map(({ fill }) => ({
      quantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }))
  assert.deepEqual(sells, [
    {
      quantity: "99.8",
      quoteQuantity: "15.27938",
      commissionAmount: "0.01527938",
      commissionAsset: "USDT",
    },
  ])
}

function assertAdaBelowTargetOutcome(replay, replacementSell) {
  const position = replay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL })
  assert.equal(position.baseQuantity.amount, "0.1")
  assert.equal(position.freeBaseQuantity.amount, "0")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(position.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "0.04910062 USDT is below the configured 0.05 USDT minimum",
  )
  const notCompleted = replay.receivedLifecycleEvents.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(notCompleted, "the terminal SELL must persist an explicit non-completed recovery outcome")
  assert.equal(notCompleted.data.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(notCompleted.data.sellOrderClientId, replacementSell.clientOrderId)
  assert.equal(notCompleted.data.sellOrderBrokerOrderId, replacementSell.brokerOrderId)
  return replay.receivedLifecycleEvents.length
}

async function assertAdaDuplicateFillIsIdempotent(replay, replacementSell, eventCount) {
  await replay.publishFullOrderFill({
    order: replacementSell,
    price: scenarioExpectations.sellPrice,
    tradeId: "ADA-SELL-738736",
    timestamp: SELL_TIMESTAMP,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  const position = replay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL })
  assert.equal(position.baseQuantity.amount, "0.1")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(position.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(replay.receivedLifecycleEvents.length, eventCount)
}

function assertAdaShutdownOutcome(replay, thirdBuy) {
  assert.ok(
    replay.confirmedCanceledOrders.some((order) => order.clientOrderId === thirdBuy.clientOrderId),
    "shutdown must cancel the still-open next BUY without completing the below-target recovery cycle",
  )
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "shutdown must not convert an incomplete recovery cycle into a completed one",
  )
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
  const { replacementSell, thirdBuy } = await submitAdaBuySequence(replay)
  await fillAdaRecoverySell(replay, replacementSell)
  assertAdaExecutionReports(replay)
  const eventCount = assertAdaBelowTargetOutcome(replay, replacementSell)
  await assertAdaDuplicateFillIsIdempotent(replay, replacementSell, eventCount)
  await replay.runtime.stop()
  stopped = true
  assertAdaShutdownOutcome(replay, thirdBuy)
})
