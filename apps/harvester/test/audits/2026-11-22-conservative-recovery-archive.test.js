import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test as nodeTest } from "node:test"

import {
  Asset,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"

import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../src/domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../../src/domain/strategies/conservative/recovery-completion.js"
import { StrategyId } from "../../src/domain/strategies/strategy-ids.js"
import { updateTradingAccounting } from "../../src/use-cases/update-trading-accounting.js"

const test = (name, fn) =>
  nodeTest(`[2026-11-22-conservative-recovery-archive.test.js] ${name}`, fn)

const archive = JSON.parse(
  readFileSync(
    new URL("./fixtures/2026-11-22-conservative-recovery.json", import.meta.url),
    "utf8",
  ),
)

function createMarket(cycle) {
  const baseAsset = new Asset({ id: cycle.baseAssetId, code: cycle.baseAssetCode })
  const quoteAsset = new Asset({ id: cycle.quoteAssetId, code: cycle.quoteAssetCode })

  return new Market({
    venue: "binance",
    symbol: cycle.symbol,
    baseAsset,
    quoteAsset,
  })
}

function createFill(record, market) {
  const assetsById = new Map([
    [market.baseAsset.id, market.baseAsset],
    [market.quoteAsset.id, market.quoteAsset],
  ])

  const commissions = record.commissions.map((commission) => {
    let asset = assetsById.get(commission.assetId)
    if (!asset) {
      asset = new Asset({ id: commission.assetId, code: commission.assetCode })
      assetsById.set(commission.assetId, asset)
    }

    const quoteValue =
      commission.quoteValue === null || commission.quoteValue === undefined
        ? undefined
        : new Money({ amount: commission.quoteValue, asset: market.quoteAsset })

    return new Commission({
      amount: new Money({ amount: commission.amount, asset }),
      ...(quoteValue ? { quoteValue } : {}),
    })
  })

  return new Fill({
    tradeId: record.tradeId,
    brokerOrderId: record.brokerOrderId,
    clientOrderId: record.clientOrderId,
    market,
    side: record.side,
    price: new Money({ amount: record.price, asset: market.quoteAsset }),
    quantity: new Quantity({ amount: record.quantity, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: record.quoteQuantity, asset: market.quoteAsset }),
    commissions,
    commissionStatus: record.commissionStatus,
  })
}

function replayCycle(cycle) {
  const market = createMarket(cycle)
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })
  const fillById = new Map(archive.fills.map((fill) => [fill.fillId, fill]))

  for (const fillId of cycle.appliedFillIds) {
    const record = fillById.get(fillId)
    assert.ok(record, `Missing archived fill ${fillId}`)
    const fill = createFill(record, market)
    assert.equal(fill.id, record.fillId)

    const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    portfolio = result.data.portfolio
    recoveryLedger = result.data.recoveryLedger
  }

  const position = portfolio.getPosition({
    marketId: market.id,
    strategyId: StrategyId.COIN_GRABBER,
  })

  return { market, portfolio, recoveryLedger, position }
}

test(
  "reconstructs all three archived recovery cycles with exact Portfolio and RecoveryLedger accounting",
  () => {
    assert.equal(archive.source.factsRecordCount, 49)
    assert.equal(archive.source.lastSequence, 48)
    assert.equal(archive.source.runtimeSessionId, archive.processStarted.runtimeSessionId)
    assert.equal(archive.fills.length, 13)
    assert.equal(archive.cycleOutcomes.length, 3)

    for (const cycle of archive.cycleOutcomes) {
      const replay = replayCycle(cycle)
      assert.equal(replay.market.id, cycle.marketId)
      assert.equal(replay.position.baseQuantity.amount, cycle.activeQuantity)
      assert.equal(replay.position.spent.amount, cycle.spent)
      assert.equal(replay.position.quoteNetCashFlow.amount, cycle.realizedNetProfit)
      assert.equal(replay.recoveryLedger.buyCost, cycle.spent)
      assert.equal(replay.recoveryLedger.netSellProceeds, cycle.netSellProceeds)
      assert.equal(replay.recoveryLedger.realizedNetProfit, cycle.realizedNetProfit)
      assert.deepEqual(replay.recoveryLedger.appliedFillIds, cycle.appliedFillIds)
    }
  },
)

test(
  "keeps archived residuals in CONTINUE_SELL_THROUGH without inferring dust",
  () => {
    assert.equal(archive.filterEvidence.filterSnapshotFactCount, 0)
    assert.equal(archive.filterEvidence.lotSizeValuesCaptured, false)
    assert.equal(archive.filterEvidence.minNotionalValuesCaptured, false)
    assert.equal(archive.filterEvidence.databaseDumpStatus, "PRESENT_NOT_INSPECTED")

    for (const cycle of archive.cycleOutcomes) {
      const completion = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: cycle.spent,
        netSellProceeds: cycle.netSellProceeds,
        activeQuantity: cycle.activeQuantity,
        keepQuantity: cycle.keepQuantity,
        minProfit: cycle.minProfit,
      })

      assert.equal(cycle.outcome, "CONTINUE_SELL_THROUGH")
      assert.equal(cycle.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
      assert.equal(completion.eligible, false)
      assert.equal(completion.pause, false)
      assert.equal(completion.reason, cycle.reason)
      assert.equal(completion.realizedNetProfit, cycle.realizedNetProfit)
      assert.equal(completion.dust, undefined)
    }
  },
)

test(
  "preserves the archived owned-order and delayed-fill chronology",
  () => {
    const zroOrder = archive.orderTimelines.find(order => order.orderId === "1001164")
    const linkOrder = archive.orderTimelines.find(order => order.orderId === "3029796")

    assert.ok(Date.parse(zroOrder.submittedAtUtc) < Date.parse(zroOrder.pauseAtUtc))
    assert.ok(Date.parse(zroOrder.pauseAtUtc) < Date.parse(zroOrder.fillExecutedAtUtc))
    assert.equal(zroOrder.cancellationIntentPresent, false)
    assert.ok(
      archive.openOrderSnapshots
        .find(snapshot => snapshot.phase === "RECOVERY")
        .trackedOrders.some(order => order.orderId === zroOrder.orderId),
    )

    const zroCycle = archive.cycleOutcomes.find(cycle => cycle.symbol === "ZROUSDT")
    const zroReplay = replayCycle(zroCycle)
    const postPauseFill = archive.fills.find(fill => fill.brokerOrderId === zroOrder.orderId)
    assert.ok(!zroCycle.appliedFillIds.includes(postPauseFill.fillId))

    const postPauseResult = updateTradingAccounting({
      portfolio: zroReplay.portfolio,
      recoveryLedger: zroReplay.recoveryLedger,
      fill: createFill(postPauseFill, zroReplay.market),
    })
    assert.equal(postPauseResult.ok, true, JSON.stringify(postPauseResult.error))

    const postPausePosition = postPauseResult.data.portfolio.getPosition({
      marketId: zroReplay.market.id,
      strategyId: StrategyId.COIN_GRABBER,
    })
    assert.equal(postPausePosition.baseQuantity.amount, "5.025")
    assert.equal(postPausePosition.spent.amount, "29.2")
    assert.equal(postPausePosition.quoteNetCashFlow.amount, "-5.8021213")
    assert.equal(postPauseResult.data.recoveryLedger.realizedNetProfit, "-5.8021213")

    assert.ok(Date.parse(linkOrder.submittedAtUtc) < Date.parse(linkOrder.pauseAtUtc))
    assert.ok(Date.parse(linkOrder.pauseAtUtc) < Date.parse(linkOrder.cancellationIntentAtUtc))
    assert.equal(linkOrder.cancellationReason, "ACCOUNT_INTEGRITY_FAILURE")
    assert.equal(linkOrder.cancellationOutcome, "CANCELED")

    assert.ok(Date.parse(archive.adaSellTiming.executedAtUtc) < Date.parse(archive.adaSellTiming.pauseAtUtc))
    assert.ok(Date.parse(archive.adaSellTiming.pauseAtUtc) < Date.parse(archive.adaSellTiming.recordedAtUtc))
    assert.ok(
      archive.externalSellEvents.every(event => event.disposition === "REJECTED_UNOWNED_OR_INVALID"),
    )
  },
)

test(
  "records missing submission and shutdown evidence without manufacturing success",
  () => {
    assert.equal(archive.submissionFacts.intentCount, 0)
    assert.equal(archive.submissionFacts.outcomeCount, 0)
    assert.equal(archive.factCounts.ORDER_SUBMISSION_INTENT ?? 0, 0)
    assert.equal(archive.factCounts.ORDER_SUBMISSION_OUTCOME ?? 0, 0)
    assert.match(archive.startupRetry.failure, /no preceding submission intent/)
    assert.equal(archive.startupRetry.processLockRetained, true)

    assert.equal(archive.shutdownEvidence.shutdownSafetyStarted, true)
    assert.equal(archive.shutdownEvidence.processStoppedFactPresent, false)
    assert.equal(archive.shutdownEvidence.closingAccountSnapshotPresent, false)
    assert.equal(archive.shutdownEvidence.closingOpenOrdersSnapshotPresent, false)
    assert.equal(archive.source.runtimeCommitCaptured, false)
  },
)
