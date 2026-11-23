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
import { compareDecimal } from "@coinzilla/utils"

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

const expectedCycles = {
  ZROUSDT: {
    activeQuantity: "0.03",
    spent: "23.37",
    netSellProceeds: "23.3978787",
    realizedNetProfit: "0.0278787",
    minProfit: "0.01",
    keepQuantity: "0.01",
  },
  DOGEUSDT: {
    activeQuantity: "3.4",
    spent: "87.64",
    netSellProceeds: "87.65320905",
    realizedNetProfit: "0.01320905",
    minProfit: "0.01",
    keepQuantity: "1",
  },
  ADAUSDT: {
    activeQuantity: "0.05",
    spent: "7.2",
    netSellProceeds: "7.25318955",
    realizedNetProfit: "0.05318955",
    minProfit: "0.05",
    keepQuantity: "0",
  },
}

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
    assert.ok(record, `Archived cycle ${cycle.symbol} references missing fill ${fillId}.`)
    const fill = createFill(record, market)
    assert.equal(
      fill.id,
      record.fillId,
      `Canonical fill identity for ${fillId} must match the archived execution identity.`,
    )

    const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
    assert.equal(
      result.ok,
      true,
      `Production accounting must apply archived fill ${fillId} without error: ${JSON.stringify(result.error)}.`,
    )
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
    assert.equal(
      archive.source.archiveCommit,
      "f283c90db9143c74683ae5bf9c7bb52e09590d56",
      "The fixture must remain pinned to the immutable source archive commit.",
    )
    assert.equal(
      archive.source.factsRecordCount,
      49,
      "The source fact stream must contain all 49 archived records.",
    )
    assert.equal(
      archive.source.lastSequence,
      48,
      "The source fact stream must retain its final sequence number.",
    )
    assert.equal(
      archive.source.dataCommitHash,
      archive.source.lastDigest,
      "The archive data commit hash must match the final committed fact digest, not be represented as a runtime source commit.",
    )
    assert.equal(
      archive.source.runtimeSessionId,
      archive.processStarted.runtimeSessionId,
      "The fixture must use the runtime session ID recorded by PROCESS_STARTED.",
    )
    assert.equal(
      archive.source.runtimeCommitCaptured,
      false,
      "The fixture must not invent a runtime source commit that the archive did not record.",
    )
    assert.equal(
      archive.fills.length,
      13,
      "All 13 archived execution-fill facts must be represented in the sanitized fixture.",
    )
    assert.equal(
      archive.cycleOutcomes.length,
      3,
      "The fixture must preserve all three archived recovery-cycle outcomes.",
    )

    for (const cycle of archive.cycleOutcomes) {
      const expected = expectedCycles[cycle.symbol]
      assert.ok(expected, `The fixture must not introduce an unreviewed recovery market ${cycle.symbol}.`)
      assert.deepEqual(
        {
          activeQuantity: cycle.activeQuantity,
          spent: cycle.spent,
          netSellProceeds: cycle.netSellProceeds,
          realizedNetProfit: cycle.realizedNetProfit,
          minProfit: cycle.minProfit,
          keepQuantity: cycle.keepQuantity,
        },
        expected,
        `Archived ${cycle.symbol} outcome values must match the independently reviewed exact-decimal oracle.`,
      )

      const replay = replayCycle(cycle)
      assert.equal(
        replay.market.id,
        cycle.marketId,
        `The replay market identity for ${cycle.symbol} must match its archived market.`,
      )
      assert.equal(
        replay.position.baseQuantity.amount,
        expected.activeQuantity,
        `Portfolio inventory for ${cycle.symbol} must include base-asset BUY fees and actual SELL quantities exactly.`,
      )
      assert.equal(
        replay.position.spent.amount,
        expected.spent,
        `Position.spent for ${cycle.symbol} must equal the full accumulated BUY quote cost.`,
      )
      assert.equal(
        replay.position.quoteNetCashFlow.amount,
        expected.realizedNetProfit,
        `Portfolio quote cash flow for ${cycle.symbol} must include actual quote-asset SELL commissions.`,
      )
      assert.equal(
        replay.recoveryLedger.buyCost,
        expected.spent,
        `RecoveryLedger BUY cost mirror for ${cycle.symbol} must match authoritative Position.spent.`,
      )
      assert.equal(
        replay.recoveryLedger.netSellProceeds,
        expected.netSellProceeds,
        `RecoveryLedger net proceeds for ${cycle.symbol} must deduct the actual quote-asset SELL commission.`,
      )
      assert.equal(
        replay.recoveryLedger.realizedNetProfit,
        expected.realizedNetProfit,
        `RecoveryLedger realized net profit for ${cycle.symbol} must be exact, not rounded display output.`,
      )
      assert.deepEqual(
        replay.recoveryLedger.appliedFillIds,
        cycle.appliedFillIds,
        `Every archived fill identity for ${cycle.symbol} must be applied exactly once in the reconstructed cycle.`,
      )
    }
  },
)

test(
  "keeps archived residuals in CONTINUE_SELL_THROUGH without inferring dust",
  () => {
    assert.equal(
      archive.filterEvidence.filterSnapshotFactCount,
      0,
      "No historical recovery decision-time exchange-filter snapshot is present in the recovered facts.",
    )
    assert.equal(
      archive.filterEvidence.lotSizeValuesCaptured,
      false,
      "The fixture must not claim historical LOT_SIZE values that were not captured.",
    )
    assert.equal(
      archive.filterEvidence.minNotionalValuesCaptured,
      false,
      "The fixture must not claim historical MIN_NOTIONAL values that were not captured.",
    )
    assert.equal(
      archive.filterEvidence.databaseDumpStatus,
      "PRESENT_NOT_INSPECTED",
      "The database dump must remain explicitly uninspected rather than described as absent.",
    )

    for (const cycle of archive.cycleOutcomes) {
      const completion = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: cycle.spent,
        netSellProceeds: cycle.netSellProceeds,
        activeQuantity: cycle.activeQuantity,
        keepQuantity: cycle.keepQuantity,
        minProfit: cycle.minProfit,
      })

      assert.equal(
        compareDecimal({ left: cycle.activeQuantity, right: cycle.keepQuantity }),
        1,
        `Archived ${cycle.symbol} residual inventory must be greater than its configured keep quantity.`,
      )
      assert.equal(
        cycle.outcome,
        "CONTINUE_SELL_THROUGH",
        `Archived ${cycle.symbol} must retain its recorded non-completed sell-through outcome.`,
      )
      assert.equal(
        cycle.reason,
        "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
        `Archived ${cycle.symbol} must retain the recorded residual-inventory reason.`,
      )
      assert.equal(
        completion.eligible,
        false,
        `Residual inventory above keepQuantity must prevent false completion for ${cycle.symbol}.`,
      )
      assert.equal(
        completion.pause,
        false,
        `A valid sell-through residual alone must not be converted into a market pause for ${cycle.symbol}.`,
      )
      assert.equal(
        completion.reason,
        cycle.reason,
        `The production completion predicate must preserve the archived reason for ${cycle.symbol}.`,
      )
      assert.equal(
        completion.realizedNetProfit,
        cycle.realizedNetProfit,
        `The production completion predicate must preserve exact realized profit for ${cycle.symbol}.`,
      )
      assert.equal(
        completion.dust,
        undefined,
        `Missing historical exchange filters must not be replaced with an invented dust classification for ${cycle.symbol}.`,
      )
    }
  },
)

test(
  "preserves the archived owned-order and delayed-fill chronology",
  () => {
    const zroOrder = archive.orderTimelines.find(order => order.orderId === "1001164")
    const linkOrder = archive.orderTimelines.find(order => order.orderId === "3029796")

    assert.ok(zroOrder, "The archived ZRO BUY order 1001164 must be present in the sanitized timeline.")
    assert.ok(linkOrder, "The archived LINK BUY order 3029796 must be present in the sanitized timeline.")
    assert.ok(
      Date.parse(zroOrder.submittedAtUtc) < Date.parse(zroOrder.pauseAtUtc),
      "ZRO BUY 1001164 must have been submitted before its strategy pause.",
    )
    assert.ok(
      Date.parse(zroOrder.pauseAtUtc) < Date.parse(zroOrder.fillExecutedAtUtc),
      "ZRO BUY 1001164 must have executed after the strategy pause.",
    )
    assert.equal(
      zroOrder.cancellationIntentPresent,
      false,
      "No cancellation intent for ZRO BUY 1001164 may be fabricated in the reconstructed evidence.",
    )
    assert.ok(
      archive.openOrderSnapshots
        .find(snapshot => snapshot.phase === "RECOVERY")
        .trackedOrders.some(order => order.orderId === zroOrder.orderId),
      "The RECOVERY open-order snapshot must retain ZRO BUY 1001164 as an open tracked order.",
    )

    const zroCycle = archive.cycleOutcomes.find(cycle => cycle.symbol === "ZROUSDT")
    const zroReplay = replayCycle(zroCycle)
    const postPauseFill = archive.fills.find(fill => fill.brokerOrderId === zroOrder.orderId)
    assert.ok(postPauseFill, "The delayed ZRO BUY fill must remain present as a separate archived execution.")
    assert.ok(
      !zroCycle.appliedFillIds.includes(postPauseFill.fillId),
      "The delayed post-pause ZRO BUY must not be included in the earlier recovery-cycle outcome.",
    )

    const postPauseResult = updateTradingAccounting({
      portfolio: zroReplay.portfolio,
      recoveryLedger: zroReplay.recoveryLedger,
      fill: createFill(postPauseFill, zroReplay.market),
    })
    assert.equal(
      postPauseResult.ok,
      true,
      `The separately recorded delayed ZRO fill must remain valid accounting evidence: ${JSON.stringify(postPauseResult.error)}.`,
    )

    const postPausePosition = postPauseResult.data.portfolio.getPosition({
      marketId: zroReplay.market.id,
      strategyId: StrategyId.COIN_GRABBER,
    })
    assert.equal(
      postPausePosition.baseQuantity.amount,
      "5.025",
      "Applying the delayed ZRO BUY must add five gross units less its 0.005 ZRO base commission to the residual.",
    )
    assert.equal(
      postPausePosition.spent.amount,
      "29.2",
      "Applying the delayed ZRO BUY must add its actual 5.83 USDT quote cost to the prior 23.37 USDT basis.",
    )
    assert.equal(
      postPausePosition.quoteNetCashFlow.amount,
      "-5.8021213",
      "Applying the delayed ZRO BUY must preserve the exact cumulative quote cash-flow result.",
    )
    assert.equal(
      postPauseResult.data.recoveryLedger.realizedNetProfit,
      "-5.8021213",
      "The RecoveryLedger must reflect the same exact delayed-fill accounting result.",
    )

    assert.ok(
      Date.parse(linkOrder.submittedAtUtc) < Date.parse(linkOrder.pauseAtUtc),
      "LINK BUY 3029796 must have been submitted before the strategy pause.",
    )
    assert.ok(
      Date.parse(linkOrder.pauseAtUtc) < Date.parse(linkOrder.cancellationIntentAtUtc),
      "LINK BUY 3029796 cancellation must have been requested after the strategy pause.",
    )
    assert.equal(
      linkOrder.cancellationReason,
      "ACCOUNT_INTEGRITY_FAILURE",
      "LINK BUY 3029796 must retain its separate account-integrity cancellation reason.",
    )
    assert.equal(
      linkOrder.cancellationOutcome,
      "CANCELED",
      "LINK BUY 3029796 must retain its observed CANCELED outcome.",
    )

    assert.ok(
      Date.parse(archive.adaSellTiming.executedAtUtc) < Date.parse(archive.adaSellTiming.pauseAtUtc),
      "The ADA SELL execution timestamp must precede the reconciliation pause.",
    )
    assert.ok(
      Date.parse(archive.adaSellTiming.pauseAtUtc) < Date.parse(archive.adaSellTiming.recordedAtUtc),
      "The ADA SELL fact-recording timestamp must follow the reconciliation pause.",
    )
    assert.ok(
      archive.externalSellEvents.every(event => event.disposition === "REJECTED_UNOWNED_OR_INVALID"),
      "Unowned LINK and DOGE SELL events must remain rejected and never be adopted by the fixture.",
    )
  },
)

test(
  "preserves every archived cancellation pair, pause reason, and terminal-log line reference",
  () => {
    assert.equal(
      archive.cancellations.length,
      10,
      "All ten archived cancellation intents and outcomes must be represented in the fixture.",
    )
    for (const cancellation of archive.cancellations) {
      assert.ok(
        cancellation.intentSequence < cancellation.outcomeSequence,
        `Cancellation for ${cancellation.symbol} order ${cancellation.orderId} must retain intent-before-outcome sequence ordering.`,
      )
      assert.ok(
        Date.parse(cancellation.intentAt) < Date.parse(cancellation.outcomeAt),
        `Cancellation for ${cancellation.symbol} order ${cancellation.orderId} must retain intent-before-outcome timestamps.`,
      )
      assert.equal(
        cancellation.outcome,
        "CANCELED",
        `Cancellation for ${cancellation.symbol} order ${cancellation.orderId} must preserve its recorded outcome.`,
      )
      assert.equal(
        cancellation.outcomeReason,
        cancellation.intentReason,
        `Cancellation for ${cancellation.symbol} order ${cancellation.orderId} must preserve the same intent and outcome reason.`,
      )
    }

    assert.equal(
      archive.strategyPauses.length,
      4,
      "All four durable strategy-pause facts must be preserved.",
    )
    assert.deepEqual(
      archive.strategyPauses.map(({ symbol, reason }) => ({ symbol, reason })),
      [
        { symbol: "ZROUSDT", reason: "RECOVERY_CYCLE_COMPLETION_FAILED" },
        { symbol: "DOGEUSDT", reason: "RECOVERY_CYCLE_COMPLETION_FAILED" },
        { symbol: "LINKUSDT", reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT" },
        { symbol: "ADAUSDT", reason: "REST_STREAM_RECONCILIATION_FAILED" },
      ],
      "The fixture must preserve each market's original pause reason without reclassifying it.",
    )
    assert.equal(
      archive.safetyBlockers.length,
      2,
      "Both archived safety-blocker facts must remain represented.",
    )
    assert.equal(
      archive.terminalEvidence.length,
      33,
      "The selected terminal-log evidence must retain all 33 referenced line records.",
    )
    assert.ok(
      archive.terminalEvidence.every((entry, index, entries) =>
        entry.line <= archive.source.terminalLogLineCount &&
        (index === 0 || entries[index - 1].line < entry.line)
      ),
      "Terminal-log references must be strictly increasing and within the source log's recorded line count.",
    )
    assert.deepEqual(
      archive.terminalEvidence.slice(-3).map(({ line }) => line),
      [419, 420, 421],
      "The final selected terminal-log references must preserve the last observed shutdown-safety lines.",
    )
  },
)

test(
  "replays a duplicate archived SELL fill without double-counting proceeds or profit",
  () => {
    const cycle = archive.cycleOutcomes.find(item => item.symbol === "ZROUSDT")
    const replay = replayCycle(cycle)
    const sellFillRecord = archive.fills.find(fill =>
      fill.symbol === "ZROUSDT" && fill.side === "SELL"
    )
    assert.ok(sellFillRecord, "The ZRO recovery SELL fill must exist for the duplicate-delivery regression.")
    const duplicateResult = updateTradingAccounting({
      portfolio: replay.portfolio,
      recoveryLedger: replay.recoveryLedger,
      fill: createFill(sellFillRecord, replay.market),
    })

    assert.equal(
      duplicateResult.ok,
      true,
      `An identical archived SELL fill delivered again must be an idempotent no-op: ${JSON.stringify(duplicateResult.error)}.`,
    )
    assert.equal(
      duplicateResult.data.applied,
      false,
      "A duplicate archived SELL fill must not be applied a second time.",
    )
    assert.equal(
      duplicateResult.data.duplicate,
      true,
      "The duplicate archived SELL fill must be explicitly identified as a duplicate.",
    )
    assert.equal(
      duplicateResult.data.portfolio.getPosition({
        marketId: replay.market.id,
        strategyId: StrategyId.COIN_GRABBER,
      }).quoteNetCashFlow.amount,
      replay.position.quoteNetCashFlow.amount,
      "Duplicate SELL evidence must not change Portfolio quote cash flow.",
    )
    assert.equal(
      duplicateResult.data.recoveryLedger.netSellProceeds,
      replay.recoveryLedger.netSellProceeds,
      "Duplicate SELL evidence must not double-count RecoveryLedger net proceeds.",
    )
    assert.equal(
      duplicateResult.data.recoveryLedger.realizedNetProfit,
      replay.recoveryLedger.realizedNetProfit,
      "Duplicate SELL evidence must not double-count realized net profit.",
    )
    assert.deepEqual(
      duplicateResult.data.recoveryLedger.appliedFillIds,
      replay.recoveryLedger.appliedFillIds,
      "Duplicate SELL evidence must not append a second canonical execution identity.",
    )
  },
)

test(
  "records missing submission and shutdown evidence without manufacturing success",
  () => {
    assert.equal(
      archive.submissionFacts.intentCount,
      0,
      "The source archive must retain its zero ORDER_SUBMISSION_INTENT count.",
    )
    assert.equal(
      archive.submissionFacts.outcomeCount,
      0,
      "The source archive must retain its zero ORDER_SUBMISSION_OUTCOME count.",
    )
    assert.equal(
      archive.factCounts.ORDER_SUBMISSION_INTENT ?? 0,
      0,
      "The fact-type summary must not manufacture submission-intent facts.",
    )
    assert.equal(
      archive.factCounts.ORDER_SUBMISSION_OUTCOME ?? 0,
      0,
      "The fact-type summary must not manufacture submission-outcome facts.",
    )
    assert.match(
      archive.startupRetry.failure,
      /no preceding submission intent/,
      "The subsequent startup retry must preserve the observed fail-closed missing-intent diagnostic.",
    )
    assert.equal(
      archive.startupRetry.processLockRetained,
      true,
      "The failed startup retry must preserve its observed process-lock retention.",
    )

    assert.equal(
      archive.shutdownEvidence.shutdownSafetyStarted,
      true,
      "The archive proves shutdown safety started, not that shutdown completed.",
    )
    assert.equal(
      archive.shutdownEvidence.processStoppedFactPresent,
      false,
      "No PROCESS_STOPPED fact may be inferred from the incomplete shutdown log.",
    )
    assert.equal(
      archive.shutdownEvidence.closingAccountSnapshotPresent,
      false,
      "No CLOSING account snapshot may be inferred from the archive.",
    )
    assert.equal(
      archive.shutdownEvidence.closingOpenOrdersSnapshotPresent,
      false,
      "No CLOSING open-orders snapshot may be inferred from the archive.",
    )
    assert.equal(
      archive.source.runtimeCommitCaptured,
      false,
      "The original runtime source commit must remain explicitly unknown.",
    )
  },
)
