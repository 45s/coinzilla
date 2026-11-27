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
          orderQuantity: 100,
          keepQuantity: 0,
          minProfit: 0.05,
          priceStepPercent: 0.3,
          pricePrecision: 4,
          quantityPrecision: 1,
          // The two archived BUY executions below are replayed as partial fills of one pre-existing order.
          // This preserves their execution economics without creating a new BUY during recovery.
          // Actual fill commissions are supplied explicitly.
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

async function fillAdaBuy({
  replay,
  order,
  price,
  tradeId,
  fillQuantity,
  cumulativeExecutedQuantity,
}) {
  const fillOccurrence = replay.receivedLifecycleEvents.filter(
    ({ name }) => name === "execution.fill_applied",
  ).length + 1
  const fillApplied = replay.waitForLifecycleEvent({
    eventName: "execution.fill_applied",
    occurrence: fillOccurrence,
  })
  await replay.publishOrderFill({
    order,
    price,
    tradeId,
    fillQuantity,
    cumulativeExecutedQuantity,
    commissionAmount: "0.05",
    commissionAsset: "ADA",
  })
  await fillApplied
  assert.equal(
    replay.receivedExecutionReports.at(-1)?.fill.id,
    tradeId,
    "the replay must record and apply the normalized BUY execution before evaluating the next order",
  )
}

async function submitAdaFirstBuyAndWait({ replay, initialBuy }) {
  const firstSellSubmission = waitForAdaOrder({ replay, side: "SELL" })
  await fillAdaBuy({
    replay,
    order: initialBuy,
    price: "0.1524",
    tradeId: "900000001",
    fillQuantity: "50",
    cumulativeExecutedQuantity: "50",
  })
  const firstSell = await firstSellSubmission
  assert.equal(firstSell.price, "0.1539")
  assert.equal(firstSell.quantity, "49.9")
  return {
    firstSell,
    initialBuy,
  }
}

async function submitAdaLateBuyFillAndWait({ replay, firstSell, initialBuy }) {
  const replacementSellSubmission = waitForAdaOrder({ replay, side: "SELL", occurrence: 2 })
  await fillAdaBuy({
    replay,
    order: initialBuy,
    price: "0.1519",
    tradeId: "900000002",
    fillQuantity: "50",
    cumulativeExecutedQuantity: "100",
  })
  const replacementSell = await replacementSellSubmission
  assert.equal(replacementSell.price, scenarioExpectations.sellPrice)
  assert.equal(replacementSell.quantity, scenarioExpectations.expectedSellQuantity)
  assert.ok(
    replay.confirmedCanceledOrders.some((order) => order.clientOrderId === firstSell.clientOrderId),
    "the superseded recovery SELL must be authoritatively canceled before replacement",
  )
  assert.equal(
    replay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
    1,
    "The late fill must remain part of the pre-existing BUY order; no second BUY may be submitted.",
  )
  return replacementSell
}

async function submitAdaBuySequence(replay) {
  const initialBuySubmission = waitForAdaOrder({
    replay,
    side: "BUY",
  })
  await replay.publishMarketPrice(scenarioExpectations.initialPrice)
  const initialBuy = await initialBuySubmission
  const { firstSell } = await submitAdaFirstBuyAndWait({
    replay,
    initialBuy,
  })
  return submitAdaLateBuyFillAndWait({
    replay,
    firstSell,
    initialBuy,
  })
}

async function fillAdaRecoverySell({ replay, replacementSell }) {
  const timestamp = Math.max(Date.now(), replacementSell.createdAt + 1)
  await replay.publishMarketPrice(scenarioExpectations.sellPrice)
  await replay.publishFullOrderFill({
    order: replacementSell,
    price: scenarioExpectations.sellPrice,
    // The issue evidence records broker order IDs, not trade IDs; use deterministic numeric replay IDs.
    tradeId: "900000003",
    timestamp,
    commissionAmount: "0.01527938",
    commissionAsset: "USDT",
  })
  assert.equal(
    replay.receivedExecutionReports.at(-1)?.fill.id,
    "900000003",
    "the replay must record the normalized SELL execution before evaluating completion",
  )
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
  assert.equal(
    position.baseQuantity.amount,
    "0.1",
    JSON.stringify({
      runtimeErrors: replay.harvesterRuntimeErrors.map((error) => error.message ?? String(error)),
      lifecycleEvents: replay.receivedLifecycleEvents.map(({ name, data }) => ({
        name,
        data,
      })),
      lastExecutionReport: replay.receivedExecutionReports.at(-1),
    }),
  )
  assert.equal(position.freeBaseQuantity.amount, "0")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(position.quoteNetCashFlow.amount, scenarioExpectations.expectedProfit)
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "0.04910062 USDT is below the configured 0.05 USDT minimum",
  )
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "strategy.paused"),
    false,
    "valid MIN_NOTIONAL dust must not pause the pair or release BUY admission before shutdown",
  )
  const notCompleted = replay.receivedLifecycleEvents.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(notCompleted, "the terminal SELL must persist an explicit non-completed recovery outcome")
  assert.equal(notCompleted.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(notCompleted.data.reason, "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY")
  assert.equal(notCompleted.data.realizedNetProfit, scenarioExpectations.expectedProfit)
  assert.equal(notCompleted.data.minProfit, "0.05")
  assert.equal(notCompleted.data.activeQuantity, "0.1")
  assert.equal(notCompleted.data.keepQuantity, "0")
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

function collectShutdownErrorEvidence({ error, seen = new Set() } = {}) {
  if (!(error instanceof Error) || seen.has(error)) {
    return ""
  }
  seen.add(error)
  const diagnostics = error.shutdownDiagnostics
  const diagnosticText = diagnostics === undefined ? "" : JSON.stringify(diagnostics)
  const nested = [
    ...(Array.isArray(error.errors) ? error.errors : []),
    ...(error.cause instanceof Error ? [error.cause] : []),
  ]
  return [
    error.name,
    error.message,
    error.code,
    diagnosticText,
    ...nested.map((item) => collectShutdownErrorEvidence({
      error: item,
      seen,
    })),
  ].filter(Boolean).join(" ")
}

function assertAdaShutdownOutcome({ replay, shutdownError }) {
  assert.equal(
    replay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
    1,
    "The recovery cycle must not have opened a second BUY before shutdown.",
  )
  assert.ok(shutdownError instanceof Error, "shutdown must fail closed while recovery SELL coverage is unproven")
  const evidence = collectShutdownErrorEvidence({
    error: shutdownError,
  })
  assert.match(evidence, /CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN/)
  assert.match(evidence, /RECOVERY_SELL_COVERAGE_UNVERIFIED/)
  assert.match(evidence, /SHUTDOWN_RECOVERY_REPLACEMENT_NOT_SUBMITTED/)
  assert.equal(
    replay.receivedLifecycleEvents.some(({ name }) => name === "recovery.cycle_completed"),
    false,
    "shutdown must not convert an incomplete recovery cycle into a completed one",
  )
}

test("replays ADA below-target accounting from a late fill on one pre-existing BUY and preserves fail-closed shutdown", async (t) => {
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
      try {
        await replay.runtime.stop()
      } catch {
        // The recovery cycle is intentionally unresolved at test cleanup.
      }
    }
  })
  const replacementSell = await submitAdaBuySequence(replay)
  const timestamp = await fillAdaRecoverySell({
    replay,
    replacementSell,
  })
  await replay.waitForLifecycleEvent("recovery.cycle_not_completed")
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
  let shutdownError
  try {
    await replay.runtime.stop()
  } catch (error) {
    shutdownError = error
  }
  stopped = true
  assertAdaShutdownOutcome({
    replay,
    shutdownError,
  })
})
