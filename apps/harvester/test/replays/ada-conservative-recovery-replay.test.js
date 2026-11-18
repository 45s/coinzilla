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

async function waitForAdaOrder({ replay, side, occurrence = 1 }) {
  try {
    return await replay.waitForSubmittedOrder(side, occurrence)
  } catch (error) {
    const submitted = replay.submittedCanonicalOrders.map((order) => ({
      side: order.side,
      status: order.status,
      price: order.price ?? order.limitPrice?.amount,
      quantity: order.quantity ?? order.originalQuantity?.amount,
    }))
    const runtimeErrors = replay.harvesterRuntimeErrors.map((runtimeError) =>
      runtimeError.message ?? String(runtimeError))
    error.message += `\nSubmitted orders: ${JSON.stringify(submitted)}\nRuntime errors: ${JSON.stringify(runtimeErrors)}`
    throw error
  }
}

async function fillAdaBuy({ replay, order, price, tradeId }) {
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

async function submitAdaFirstBuyAndWait({ replay, firstBuy }) {
  const firstSellSubmission = replay.waitForSubmittedOrder("SELL")
  const secondBuySubmission = waitForAdaOrder({
    replay,
    side: "BUY",
    occurrence: 2,
  })
  await fillAdaBuy({
    replay,
    order: firstBuy,
    price: "0.1524",
    tradeId: "900000001",
  })
  const [firstSell, secondBuy] = await Promise.all([
    firstSellSubmission,
    secondBuySubmission,
  ])
  assert.equal(firstSell.price, "0.1539")
  assert.equal(firstSell.quantity, "49.9")
  assert.equal(secondBuy.price, "0.1519")
  assert.equal(secondBuy.quantity, "50")
  return { firstSell, secondBuy }
}

async function submitAdaSecondBuyAndWait({ replay, firstSell, secondBuy }) {
  const replacementSellSubmission = replay.waitForSubmittedOrder("SELL", 2)
  const thirdBuySubmission = waitForAdaOrder({
    replay,
    side: "BUY",
    occurrence: 3,
  })
  await fillAdaBuy({
    replay,
    order: secondBuy,
    price: "0.1519",
    tradeId: "900000002",
  })
  const [replacementSell, thirdBuy] = await Promise.all([
    replacementSellSubmission,
    thirdBuySubmission,
  ])
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

async function submitAdaBuySequence(replay) {
  const initialBuySubmission = waitForAdaOrder({
    replay,
    side: "BUY",
  })
  await replay.publishMarketPrice(scenarioExpectations.initialPrice)
  const initialBuy = await initialBuySubmission
  const { firstSell, secondBuy } = await submitAdaFirstBuyAndWait({
    replay,
    firstBuy: initialBuy,
  })
  return submitAdaSecondBuyAndWait({
    replay,
    firstSell,
    secondBuy,
  })
}

async function fillAdaRecoverySell({ replay, replacementSell }) {
  const timestamp = Math.max(Date.now(), replacementSell.createdAt + 1)
  const result = await replay.publishFullOrderFill({
    order: replacementSell,
    price: scenarioExpectations.sellPrice,
    // The issue evidence records broker order IDs, not trade IDs; use deterministic numeric replay IDs.
    tradeId: "900000003",
    timestamp,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  assert.equal(result.ok, true, result.errors?.[0]?.message)
  return timestamp
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

function assertAdaBelowTargetOutcome({ replay, replacementSell }) {
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

async function assertAdaDuplicateFillIsIdempotent({ replay, replacementSell, eventCount, timestamp }) {
  await replay.publishFullOrderFill({
    order: replacementSell,
    price: scenarioExpectations.sellPrice,
    tradeId: "900000003",
    timestamp,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  const position = replay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL })
  assert.equal(position.baseQuantity.amount, "0.1")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(position.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(replay.receivedLifecycleEvents.length, eventCount)
}

function assertAdaShutdownOutcome({ replay, thirdBuy }) {
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
  const timestamp = await fillAdaRecoverySell({
    replay,
    replacementSell,
  })
  assertAdaExecutionReports(replay)
  const eventCount = assertAdaBelowTargetOutcome({
    replay,
    replacementSell,
  })
  await assertAdaDuplicateFillIsIdempotent({
    replay,
    replacementSell,
    eventCount,
    timestamp,
  })
  await replay.runtime.stop()
  stopped = true
  assertAdaShutdownOutcome({
    replay,
    thirdBuy,
  })
})
