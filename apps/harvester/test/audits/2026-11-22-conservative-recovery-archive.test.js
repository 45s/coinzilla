import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

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

function createMarket({ cycle }) {
  const baseAsset = new Asset({
    id: cycle.baseAssetId,
    code: cycle.baseAssetId.toUpperCase(),
  })
  const quoteAsset = new Asset({
    id: cycle.quoteAssetId,
    code: cycle.quoteAssetId.toUpperCase(),
  })

  return new Market({
    venue: "binance",
    symbol: cycle.symbol,
    baseAsset,
    quoteAsset,
  })
}

function createFill({ record, market }) {
  const assetsById = new Map([
    [market.baseAsset.id, market.baseAsset],
    [market.quoteAsset.id, market.quoteAsset],
  ])

  const commissions = record.commissions.map((commission) => {
    const asset =
      assetsById.get(commission.assetId) ??
      new Asset({
        id: commission.assetId,
        code: commission.assetCode,
      })
    const quoteValue =
      commission.quoteValue === null || commission.quoteValue === undefined
        ? undefined
        : new Money({
            amount: commission.quoteValue,
            asset: market.quoteAsset,
          })

    return new Commission({
      amount: new Money({
        amount: commission.amount,
        asset,
      }),
      ...(quoteValue ? { quoteValue } : {}),
    })
  })

  return new Fill({
    tradeId: record.tradeId,
    brokerOrderId: record.brokerOrderId,
    clientOrderId: record.clientOrderId,
    market,
    side: record.side,
    price: new Money({
      amount: record.price,
      asset: market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: record.quantity,
      asset: market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: record.quoteQuantity,
      asset: market.quoteAsset,
    }),
    commissions,
    commissionStatus: record.commissionStatus,
  })
}

function replayCycle({ cycle }) {
  const market = createMarket({ cycle })
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })
  const fillById = new Map(archive.fills.map((fill) => [fill.fillId, fill]))

  for (const fillId of cycle.appliedFillIds) {
    const record = fillById.get(fillId)
    assert.ok(
      record,
      `Archived cycle ${cycle.symbol} references missing fill ${fillId}.`,
    )
    const fill = createFill({
      record,
      market,
    })
    assert.equal(
      fill.id,
      record.fillId,
      `Canonical fill identity for ${fillId} must match the archived execution identity.`,
    )

    const result = updateTradingAccounting({
      portfolio,
      recoveryLedger,
      fill,
    })
    assert.equal(
      result.ok,
      true,
      `Production accounting must apply archived fill ${fillId}: ${JSON.stringify(result.error)}.`,
    )
    const {
      portfolio: nextPortfolio,
      recoveryLedger: nextRecoveryLedger,
    } = result.data
    portfolio = nextPortfolio
    recoveryLedger = nextRecoveryLedger
  }

  const position = portfolio.getPosition({
    marketId: market.id,
    strategyId: StrategyId.COIN_GRABBER,
  })

  return {
    market,
    portfolio,
    recoveryLedger,
    position,
  }
}

function assertArchiveSourceHashes() {
  assert.equal(
    archive.source.factsSha256,
    "1b923c1a090904df601463d14681090165b7f8d50a3806e96655699d90a97295",
    "The fixture must retain the independently verified facts-file SHA-256.",
  )
  assert.equal(
    archive.source.factsManifestSha256,
    "3063f9ce829cce8a66a471672abee6b77ff52b6647b0b786381adc1db5f264bc",
    "The fixture must retain the independently verified manifest SHA-256.",
  )
  assert.equal(
    archive.source.terminalLogSha256,
    "6ec912690afbfeb1d9c87c674647a34e11d855b2d59337c34ac58d54d2a93d33",
    "The fixture must retain the independently verified terminal-log SHA-256.",
  )
}

function assertArchiveMetadata() {
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
  assert.match(
    archive.source.dataCommitHash,
    /^[0-9a-f]{64}$/,
    "Archive data provenance must retain its original SHA-256-shaped value.",
  )
  assert.notEqual(
    archive.source.dataCommitHash,
    archive.source.lastDigest,
    "The archive data commit hash must not be confused with the final fact digest.",
  )
  assert.equal(
    archive.source.runtimeSessionId,
    archive.processStarted.runtimeSessionId,
    "The fixture must use the runtime session ID recorded by PROCESS_STARTED.",
  )
  assert.equal(
    archive.source.runtimeCommitCaptured,
    false,
    "The fixture must not invent an uncaptured runtime source commit.",
  )
  assert.notEqual(
    archive.source.startupRetrySessionId,
    archive.source.runtimeSessionId,
    "The later startup-retry session must not be confused with the original recovery runtime.",
  )
  assert.equal(
    archive.fills.length,
    13,
    "All 13 archived execution-fill facts must be represented.",
  )
  assert.equal(
    archive.cycleOutcomes.length,
    3,
    "All three archived recovery-cycle outcomes must be preserved.",
  )
  const fixtureText = JSON.stringify(archive)
  assert.equal(
    fixtureText.includes('"accountId"'),
    false,
    "The sanitized fixture must not contain account identifiers.",
  )
  assert.equal(
    fixtureText.includes('"balances"'),
    false,
    "The sanitized fixture must not contain account balance snapshots.",
  )
}

function assertPortfolioCycleAccounting({
    cycle,
    replay,
    expected,
  }) {
  assert.equal(
    replay.market.id,
    cycle.marketId,
    `Replay market identity for ${cycle.symbol} must match the archive.`,
  )
  assert.equal(
    replay.position.baseQuantity.amount,
    expected.activeQuantity,
    `Portfolio inventory for ${cycle.symbol} must include base fees and SELL quantities exactly.`,
  )
  assert.equal(
    replay.position.spent.amount,
    expected.spent,
    `Position.spent for ${cycle.symbol} must equal accumulated BUY quote cost.`,
  )
  assert.equal(
    replay.position.quoteNetCashFlow.amount,
    expected.realizedNetProfit,
    `Portfolio cash flow for ${cycle.symbol} must include actual quote-asset SELL commissions.`,
  )
}

function assertLedgerCycleAccounting({
    cycle,
    replay,
    expected,
  }) {
  assert.equal(
    replay.recoveryLedger.buyCost,
    expected.spent,
    `RecoveryLedger BUY cost for ${cycle.symbol} must match Position.spent.`,
  )
  assert.equal(
    replay.recoveryLedger.netSellProceeds,
    expected.netSellProceeds,
    `RecoveryLedger proceeds for ${cycle.symbol} must deduct actual SELL quote fees.`,
  )
  assert.equal(
    replay.recoveryLedger.realizedNetProfit,
    expected.realizedNetProfit,
    `RecoveryLedger profit for ${cycle.symbol} must remain exact, not display-rounded.`,
  )
  assert.deepEqual(
    replay.recoveryLedger.appliedFillIds,
    cycle.appliedFillIds,
    `Every archived fill for ${cycle.symbol} must be applied exactly once.`,
  )
}

function assertCycleAccounting({ cycle }) {
  const expected = expectedCycles[cycle.symbol]
  assert.ok(
    expected,
    `The fixture must not introduce an unreviewed recovery market ${cycle.symbol}.`,
  )
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
    `Archived ${cycle.symbol} outcome must match the exact-decimal oracle.`,
  )

  const replay = replayCycle({ cycle })
  assertPortfolioCycleAccounting({
    cycle,
    replay,
    expected,
  })
  assertLedgerCycleAccounting({
    cycle,
    replay,
    expected,
  })
}

function assertCycleCompletion({ cycle }) {
  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: cycle.spent,
    netSellProceeds: cycle.netSellProceeds,
    activeQuantity: cycle.activeQuantity,
    keepQuantity: cycle.keepQuantity,
    minProfit: cycle.minProfit,
  })

  assert.equal(
    compareDecimal({
      left: cycle.activeQuantity,
      right: cycle.keepQuantity,
    }),
    1,
    `Archived ${cycle.symbol} residual must exceed its keep quantity.`,
  )
  assert.equal(
    cycle.outcome,
    "CONTINUE_SELL_THROUGH",
    `Archived ${cycle.symbol} must retain its recorded sell-through outcome.`,
  )
  assert.equal(
    cycle.reason,
    "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    `Archived ${cycle.symbol} must retain its recorded residual reason.`,
  )
  assert.equal(
    completion.eligible,
    false,
    `Residual inventory above keepQuantity must prevent false ${cycle.symbol} completion.`,
  )
  assert.equal(
    completion.pause,
    false,
    `A valid ${cycle.symbol} sell-through residual alone must not pause the market.`,
  )
  assert.equal(
    completion.reason,
    cycle.reason,
    `Production completion evaluation must preserve the archived ${cycle.symbol} reason.`,
  )
  assert.equal(
    completion.realizedNetProfit,
    cycle.realizedNetProfit,
    `Production completion evaluation must preserve exact ${cycle.symbol} profit.`,
  )
  assert.equal(
    completion.dust,
    undefined,
    `Missing filters must not become an invented ${cycle.symbol} dust classification.`,
  )
}

function assertNoHistoricalFilterInference() {
  assert.equal(
    archive.filterEvidence.filterSnapshotFactCount,
    0,
    "No historical decision-time exchange-filter snapshot is present in the recovered facts.",
  )
  assert.equal(
    archive.filterEvidence.lotSizeValuesCaptured,
    false,
    "The fixture must not claim uncaptured historical LOT_SIZE values.",
  )
  assert.equal(
    archive.filterEvidence.minNotionalValuesCaptured,
    false,
    "The fixture must not claim uncaptured historical MIN_NOTIONAL values.",
  )
  assert.equal(
    archive.filterEvidence.databaseDumpStatus,
    "PRESENT_NOT_INSPECTED",
    "The database dump must remain explicitly present but uninspected.",
  )
}

function assertPostPauseZroFill() {
  const zroCycle = archive.cycleOutcomes.find(cycle => cycle.symbol === "ZROUSDT")
  const zroReplay = replayCycle({ cycle: zroCycle })
  const postPauseFill = archive.fills.find(fill => fill.brokerOrderId === "1001164")

  assert.ok(postPauseFill, "The delayed ZRO BUY fill must remain in the archive fixture.")
  assert.ok(
    !zroCycle.appliedFillIds.includes(postPauseFill.fillId),
    "The delayed ZRO BUY must not be included in the earlier cycle outcome.",
  )
  const result = updateTradingAccounting({
    portfolio: zroReplay.portfolio,
    recoveryLedger: zroReplay.recoveryLedger,
    fill: createFill({
      record: postPauseFill,
      market: zroReplay.market,
    }),
  })
  assert.equal(
    result.ok,
    true,
    `The delayed ZRO BUY must remain valid accounting evidence: ${JSON.stringify(result.error)}.`,
  )

  const position = result.data.portfolio.getPosition({
    marketId: zroReplay.market.id,
    strategyId: StrategyId.COIN_GRABBER,
  })
  assert.equal(
    position.baseQuantity.amount,
    "5.025",
    "The delayed ZRO BUY must add five units less its 0.005 base commission.",
  )
  assert.equal(
    position.spent.amount,
    "29.2",
    "The delayed ZRO BUY must add its actual 5.83 USDT quote cost.",
  )
  assert.equal(
    position.quoteNetCashFlow.amount,
    "-5.8021213",
    "The delayed ZRO BUY must preserve exact cumulative quote cash flow.",
  )
  assert.equal(
    result.data.recoveryLedger.realizedNetProfit,
    "-5.8021213",
    "RecoveryLedger must reflect the same delayed-fill accounting result.",
  )
}

function assertZroAndLinkOrderChronology() {
  const zroOrder = archive.orderTimelines.find(order => order.orderId === "1001164")
  const linkOrder = archive.orderTimelines.find(order => order.orderId === "3029796")
  assert.ok(zroOrder, "Archived ZRO BUY order 1001164 must be present.")
  assert.ok(linkOrder, "Archived LINK BUY order 3029796 must be present.")
  assert.ok(
    Date.parse(zroOrder.submittedAtUtc) < Date.parse(zroOrder.pauseAtUtc),
    "ZRO BUY 1001164 must have been submitted before its strategy pause.",
  )
  assert.ok(
    Date.parse(zroOrder.pauseAtUtc) < Date.parse(zroOrder.fillExecutedAtUtc),
    "ZRO BUY 1001164 must have executed after its strategy pause.",
  )
  assert.equal(
    zroOrder.cancellationIntentPresent,
    false,
    "No cancellation intent may be fabricated for ZRO BUY 1001164.",
  )
  const recoverySnapshot = archive.openOrderSnapshots.find(
    snapshot => snapshot.phase === "RECOVERY",
  )
  assert.ok(
    recoverySnapshot.trackedOrders.some(order => order.orderId === zroOrder.orderId),
    "The RECOVERY snapshot must retain ZRO BUY 1001164 as an open tracked order.",
  )
  assert.ok(
    Date.parse(linkOrder.submittedAtUtc) < Date.parse(linkOrder.pauseAtUtc),
    "LINK BUY 3029796 must have been submitted before its strategy pause.",
  )
  assert.ok(
    Date.parse(linkOrder.pauseAtUtc) < Date.parse(linkOrder.cancellationIntentAtUtc),
    "LINK BUY 3029796 cancellation must have been requested after its pause.",
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
}

function assertAdaAndUnownedSellChronology() {
  assert.ok(
    Date.parse(archive.adaSellTiming.executedAtUtc) <
      Date.parse(archive.adaSellTiming.pauseAtUtc),
    "The ADA SELL execution must precede the reconciliation pause.",
  )
  assert.ok(
    Date.parse(archive.adaSellTiming.pauseAtUtc) <
      Date.parse(archive.adaSellTiming.recordedAtUtc),
    "The ADA SELL fact recording must follow the reconciliation pause.",
  )
  assert.ok(
    archive.externalSellEvents.every(
      event => event.disposition === "REJECTED_UNOWNED_OR_INVALID",
    ),
    "Unowned LINK and DOGE SELL events must remain rejected, not adopted.",
  )
}

function assertCancellationPairs() {
  assert.equal(
    archive.cancellations.length,
    10,
    "All ten archived cancellation intent/outcome pairs must be represented.",
  )
  for (const cancellation of archive.cancellations) {
    assert.ok(
      cancellation.intentSequence < cancellation.outcomeSequence,
      `Cancellation ${cancellation.orderId} must retain intent-before-outcome sequence.`,
    )
    assert.ok(
      Date.parse(cancellation.intentAt) < Date.parse(cancellation.outcomeAt),
      `Cancellation ${cancellation.orderId} must retain intent-before-outcome timestamps.`,
    )
    assert.equal(
      cancellation.outcome,
      "CANCELED",
      `Cancellation ${cancellation.orderId} must preserve its recorded outcome.`,
    )
    assert.equal(
      cancellation.outcomeReason,
      cancellation.intentReason,
      `Cancellation ${cancellation.orderId} must preserve its original reason.`,
    )
  }
}

function assertPauseReasons() {
  assert.equal(
    archive.strategyPauses.length,
    4,
    "All four durable strategy-pause facts must be preserved.",
  )
  assert.deepEqual(
    archive.strategyPauses.map(({ symbol, reason }) => ({
      symbol,
      reason,
    })),
    [
      {
        symbol: "ZROUSDT",
        reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
      },
      {
        symbol: "DOGEUSDT",
        reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
      },
      {
        symbol: "LINKUSDT",
        reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
      },
      {
        symbol: "ADAUSDT",
        reason: "REST_STREAM_RECONCILIATION_FAILED",
      },
    ],
    "Each market must retain its original pause reason without reclassification.",
  )
  assert.equal(
    archive.safetyBlockers.length,
    2,
    "Both archived safety-blocker facts must remain represented.",
  )
}

function assertTerminalLogReferences() {
  assert.equal(
    archive.terminalEvidence.length,
    31,
    "All 31 selected terminal-log line references must be preserved.",
  )
  let previousLine = 0
  for (const entry of archive.terminalEvidence) {
    assert.ok(
      entry.line > previousLine &&
        entry.line <= archive.source.terminalLogLineCount,
      `Terminal-log line ${entry.line} must be ordered and within the source log.`,
    )
    previousLine = entry.line
  }
  assert.deepEqual(
    archive.terminalEvidence.slice(-3).map(({ line }) => line),
    [419, 420, 421],
    "The final selected references must preserve the last observed shutdown-safety lines.",
  )
}

function assertDuplicateSellNoOp() {
  const cycle = archive.cycleOutcomes.find(item => item.symbol === "ZROUSDT")
  const replay = replayCycle({ cycle })
  const sellFillRecord = archive.fills.find(
    fill => fill.symbol === "ZROUSDT" && fill.side === "SELL",
  )
  assert.ok(
    sellFillRecord,
    "The ZRO recovery SELL must exist for the duplicate-delivery regression.",
  )
  const duplicateResult = updateTradingAccounting({
    portfolio: replay.portfolio,
    recoveryLedger: replay.recoveryLedger,
    fill: createFill({
      record: sellFillRecord,
      market: replay.market,
    }),
  })
  assert.equal(
    duplicateResult.ok,
    true,
    `An identical archived SELL must be an idempotent no-op: ${JSON.stringify(duplicateResult.error)}.`,
  )
  assert.equal(
    duplicateResult.data.applied,
    false,
    "A duplicate archived SELL must not be applied a second time.",
  )
  assert.equal(
    duplicateResult.data.duplicate,
    true,
    "The duplicate archived SELL must be explicitly identified as duplicate.",
  )
  const duplicatePosition = duplicateResult.data.portfolio.getPosition({
    marketId: replay.market.id,
    strategyId: StrategyId.COIN_GRABBER,
  })
  assert.equal(
    duplicatePosition.quoteNetCashFlow.amount,
    replay.position.quoteNetCashFlow.amount,
    "Duplicate SELL evidence must not change Portfolio quote cash flow.",
  )
  assert.equal(
    duplicateResult.data.recoveryLedger.netSellProceeds,
    replay.recoveryLedger.netSellProceeds,
    "Duplicate SELL evidence must not double-count net proceeds.",
  )
  assert.equal(
    duplicateResult.data.recoveryLedger.realizedNetProfit,
    replay.recoveryLedger.realizedNetProfit,
    "Duplicate SELL evidence must not double-count realized profit.",
  )
  assert.deepEqual(
    duplicateResult.data.recoveryLedger.appliedFillIds,
    replay.recoveryLedger.appliedFillIds,
    "Duplicate SELL evidence must not append a second canonical fill identity.",
  )
}

function assertSubmissionAndShutdownEvidence() {
  assert.equal(
    archive.submissionFacts.intentCount,
    0,
    "The source archive must retain zero ORDER_SUBMISSION_INTENT facts.",
  )
  assert.equal(
    archive.submissionFacts.outcomeCount,
    0,
    "The source archive must retain zero ORDER_SUBMISSION_OUTCOME facts.",
  )
  assert.equal(
    archive.factCounts.ORDER_SUBMISSION_INTENT ?? 0,
    0,
    "The fact summary must not manufacture submission-intent facts.",
  )
  assert.equal(
    archive.factCounts.ORDER_SUBMISSION_OUTCOME ?? 0,
    0,
    "The fact summary must not manufacture submission-outcome facts.",
  )
  assert.match(
    archive.startupRetry.failure,
    /no preceding submission intent/,
    "The startup retry must preserve its observed fail-closed diagnostic.",
  )
  assert.equal(
    archive.startupRetry.processLockRetained,
    true,
    "The failed startup retry must preserve its observed process-lock retention.",
  )
  assert.equal(
    archive.shutdownEvidence.shutdownSafetyStarted,
    true,
    "The archive proves shutdown safety started, not that it completed.",
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
}

test("reconstructs all three archived recovery cycles with exact Portfolio and RecoveryLedger accounting", () => {
  assertArchiveMetadata()
  assertArchiveSourceHashes()
  for (const cycle of archive.cycleOutcomes) {
    assertCycleAccounting({ cycle })
  }
})

test("keeps archived residuals in CONTINUE_SELL_THROUGH without inferring dust", () => {
  assertNoHistoricalFilterInference()
  for (const cycle of archive.cycleOutcomes) {
    assertCycleCompletion({ cycle })
  }
})

test("preserves the archived owned-order and delayed-fill chronology", () => {
  assertPostPauseZroFill()
  assertZroAndLinkOrderChronology()
  assertAdaAndUnownedSellChronology()
})

test("preserves every archived cancellation pair, pause reason, and terminal-log line reference", () => {
  assertCancellationPairs()
  assertPauseReasons()
  assertTerminalLogReferences()
})

test("replays a duplicate archived SELL fill without double-counting proceeds or profit", assertDuplicateSellNoOp)

test("preserves missing submission and shutdown evidence", assertSubmissionAndShutdownEvidence)
