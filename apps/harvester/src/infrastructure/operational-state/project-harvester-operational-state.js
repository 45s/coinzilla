import { toResult } from "@coinzilla/utils"
import { projectHarvesterJournalRecovery } from "../journal/project-harvester-journal-recovery.js"

const EVENT = Object.freeze({
  STARTED: "harvester.started",
  STOPPED: "harvester.stopped",
  ACCOUNT_SNAPSHOT: "account.snapshot_captured",
  ACCOUNT_OPEN_ORDERS: "account.open_orders_captured",
  SUBMISSION_REQUESTED: "order.submission_requested",
  SUBMITTED: "order.submitted",
  SUBMISSION_FAILED: "order.submission_failed",
  CANCEL_REQUESTED: "order.cancel_requested",
  CANCELLED: "order.cancelled",
  CANCEL_FAILED: "order.cancel_failed",
  FILL_APPLIED: "execution.fill_applied",
  RECOVERY_COMPLETED: "recovery.cycle_completed",
  RECOVERY_NOT_COMPLETED: "recovery.cycle_not_completed",
  STRATEGY_PAUSED: "strategy.paused",
  EXECUTION_ACCOUNTING_FAILED: "execution.accounting_failed",
})

const CANCELLATION_FAILURE_OUTCOMES = new Map([
  ["NOT_CANCELED", "NOT_CANCELED"],
  ["NOT_REGISTERED", "NOT_REGISTERED"],
  ["NOT_SENT", "NOT_CANCELED"],
  ["UNCONFIRMED", "UNCONFIRMED"],
  ["OUTCOME_UNKNOWN", "UNCONFIRMED"],
  ["UNKNOWN", "UNCONFIRMED"],
  ["FILLED", "UNCONFIRMED"],
  ["REJECTED", "UNCONFIRMED"],
  ["EXPIRED", "UNCONFIRMED"],
])

function requireRecord({ record, index }) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.factId !== "string" || !record.factId.trim() ||
      typeof record.factType !== "string" || !record.factType.trim() ||
      typeof record.runtimeSessionId !== "string" || !record.runtimeSessionId.trim() ||
      typeof record.sequence !== "string" || !/^(0|[1-9][0-9]*)$/.test(record.sequence) ||
      !record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new TypeError("Operational State Store record record " + index + " has an invalid committed envelope")
  }
  return record
}

function requireSafeSequence({ sequence, factId }) {
  const numericSequence = Number(sequence)
  if (!Number.isSafeInteger(numericSequence) || numericSequence < 0 || String(numericSequence) !== sequence) {
    throw new RangeError("Durable fact " + factId + " exceeds the safe recovery sequence range")
  }
  return numericSequence
}

function makeEventRecord({ sessionId, lineNumber, name, data }) {
  return {
    position: { fileName: sessionId, lineNumber },
    payload: { source: "harvester", name, data },
  }
}

function mapFill({ data }) {
  return {
    fillId: data.fillId,
    tradeId: data.tradeId,
    brokerOrderId: data.brokerOrderId,
    ...(data.clientOrderId == null ? {} : { clientOrderId: data.clientOrderId }),
    symbol: data.symbol,
    side: data.side,
    price: data.price,
    quantity: data.quantity,
    quoteQuantity: data.quoteQuantity,
    liquidityRole: data.liquidityRole,
    ...(data.executedAt == null ? {} : { executedAt: data.executedAt }),
    commissionStatus: data.commissionStatus,
    commissions: data.commissions.map((commission) => ({
      amount: commission.amount,
      assetId: commission.assetId,
      asset: commission.assetCode,
      ...(commission.quoteValue == null ? {} : {
        quoteValue: {
          amount: commission.quoteValue.amount,
          assetId: commission.quoteValue.assetId,
          asset: commission.quoteValue.assetCode,
        },
      }),
    })),
  }
}

function assertIntentMatches({ intent, data, fields, context }) {
  for (const field of fields) {
    if (intent[field] !== data[field]) {
      throw new Error(context + " conflicts with its original durable order intent: " + field)
    }
  }
}

function mapFact({ record, orderIntents, cancellationIntents }) {
  const { factType, data } = record
  if (factType === "ACCOUNT_SNAPSHOT_CAPTURED") {
    return [{ name: EVENT.ACCOUNT_SNAPSHOT, data }]
  }
  if (factType === "ACCOUNT_OPEN_ORDERS_CAPTURED") {
    return [{ name: EVENT.ACCOUNT_OPEN_ORDERS, data }]
  }
  if (factType === "ORDER_SUBMISSION_INTENT") {
    orderIntents.set(data.clientOrderId, data)
    return [{
      name: EVENT.SUBMISSION_REQUESTED,
      data: {
        clientOrderId: data.clientOrderId,
        symbol: data.symbol,
        side: data.side,
        type: data.type,
        price: data.price,
        quantity: data.quantity,
        status: "PENDING",
      },
    }]
  }
  if (factType === "ORDER_SUBMISSION_OUTCOME") {
    const intent = orderIntents.get(data.clientOrderId)
    if (!intent) { throw new Error("Durable submission outcome has no preceding intent: " + data.clientOrderId) }
    assertIntentMatches({
      intent,
      data,
      fields: ["marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "type", "price", "quantity", "purpose"],
      context: "Durable submission outcome",
    })
    const immutableIntent = {
      clientOrderId: data.clientOrderId,
      symbol: data.symbol,
      side: data.side,
      type: data.type,
      price: data.price,
      quantity: data.quantity,
    }
    if (data.outcome === "ACKNOWLEDGED") {
      return [{
        name: EVENT.SUBMITTED,
        data: { ...immutableIntent, brokerOrderId: data.brokerOrderId, status: data.status },
      }]
    }
    return [{
      name: EVENT.SUBMISSION_FAILED,
      data: { ...immutableIntent, outcome: data.outcome },
    }]
  }
  if (factType === "ORDER_CANCELLATION_INTENT") {
    const intent = orderIntents.get(data.clientOrderId)
    if (!intent) { throw new Error("Durable cancellation intent has no preceding submission intent: " + data.clientOrderId) }
    assertIntentMatches({
      intent,
      data,
      fields: ["marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "type", "price", "quantity"],
      context: "Durable cancellation intent",
    })
    if (cancellationIntents.has(data.clientOrderId)) {
      throw new Error("Durable cancellation intent was repeated before its prior outcome: " + data.clientOrderId)
    }
    cancellationIntents.set(data.clientOrderId, data)
    return [{
      name: EVENT.CANCEL_REQUESTED,
      data: {
        clientOrderId: data.clientOrderId,
        brokerOrderId: data.brokerOrderId,
        symbol: data.symbol,
        side: data.side,
        type: data.type,
        price: data.price,
        quantity: data.quantity,
        executedQuantity: data.executedQuantity,
        reason: data.reason,
        status: data.status,
      },
    }]
  }
  if (factType === "ORDER_CANCELLATION_OUTCOME") {
    const intent = orderIntents.get(data.clientOrderId)
    const cancellationIntent = cancellationIntents.get(data.clientOrderId)
    if (!intent || !cancellationIntent) { throw new Error("Durable cancellation outcome has no preceding submission and cancellation intent: " + data.clientOrderId) }
    assertIntentMatches({
      intent,
      data,
      fields: ["marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side"],
      context: "Durable cancellation outcome",
    })
    if (cancellationIntent.reason !== data.reason || cancellationIntent.brokerOrderId !== data.brokerOrderId) {
      throw new Error("Durable cancellation outcome conflicts with its exact cancellation intent")
    }
    cancellationIntents.delete(data.clientOrderId)
    if (data.outcome === "CANCELED") {
      return [{
        name: EVENT.CANCELLED,
        data: {
          clientOrderId: data.clientOrderId,
          brokerOrderId: data.brokerOrderId,
          symbol: data.symbol,
          side: data.side,
          type: intent.type,
          price: intent.price,
          quantity: intent.quantity,
          status: "CANCELED",
          executedQuantity: data.executedQuantity,
        },
      }]
    }
    const outcome = CANCELLATION_FAILURE_OUTCOMES.get(data.outcome)
    if (!outcome) { throw new Error("Unsupported durable cancellation outcome: " + data.outcome) }
    return [{
      name: EVENT.CANCEL_FAILED,
      data: {
        clientOrderId: data.clientOrderId,
        brokerOrderId: data.brokerOrderId,
        symbol: data.symbol,
        side: data.side,
        outcome,
      },
    }]
  }
  if (factType === "EXECUTION_FILL_APPLIED") {
    return [{ name: EVENT.FILL_APPLIED, data: mapFill({ data }) }]
  }
  if (factType === "RECOVERY_CYCLE_COMPLETED") {
    return [{
      name: EVENT.RECOVERY_COMPLETED,
      data: {
        symbol: data.symbol,
        marketId: data.marketId,
        freeQuantity: data.freeQuantity,
        keepQuantity: data.keepQuantity,
        minProfit: data.minProfit,
        realizedNetProfit: data.realizedNetProfit,
        sellOrderClientId: data.sellOrderClientId,
        sellOrderBrokerOrderId: data.sellOrderBrokerOrderId,
        ...(data.inventoryDisposition == null ? {} : { dust: data.inventoryDisposition }),
      },
    }]
  }
  if (factType === "RECOVERY_CYCLE_NOT_COMPLETED") {
    return [{
      name: EVENT.RECOVERY_NOT_COMPLETED,
      data: {
        symbol: data.symbol,
        marketId: data.marketId,
        sellOrderClientId: data.sellOrderClientId,
        sellOrderBrokerOrderId: data.sellOrderBrokerOrderId,
        outcome: data.outcome,
        reason: data.reason,
        realizedNetProfit: data.realizedNetProfit,
        activeQuantity: data.activeQuantity,
        keepQuantity: data.keepQuantity,
        minProfit: data.minProfit,
      },
    }]
  }
  return []
}

/**
 * Project the application-owned durable stream into the existing canonical
 * recovery reducer. The Journal is not read or trusted here: this adapter
 * translates verified Operational State Store records into the reducer's domain-event vocabulary.
 *
 * This is a candidate projection only. It never performs broker reads, mutates
 * orders, or opens the trading-readiness gate. Exchange and history completeness
 * remain mandatory independent reconciliation steps.
 *
 * @param {object} options
 * @param {object[]} options.records Verified, globally ordered Operational State Store record records.
 * @returns {object} Candidate recovery projection.
 */
export function projectHarvesterOperationalState({ records } = {}) {
  try {
    if (!Array.isArray(records)) { throw new TypeError("Operational State Store projection requires a verified records array") }
    const configurationBaselines = new Map()
    const sessions = new Map()
    const seenFactIds = new Set()
    const strategyPauses = new Map()
    const activeBlockers = new Map()
    const marketHistoryCoverage = []
    const marketHistoryCoverageBySymbol = new Map()
    const orderIntents = new Map()
    const cancellationIntents = new Map()
    const cycleFillIdsByMarket = new Map()
    const orderSubmissionOutcomes = []
    const orderCancellationOutcomes = []
    const recoveryCycleCompletedFacts = []
    const recoveryCycleNotCompletedFacts = []
    let previousSequence = -1n

    for (const [index, rawRecord] of records.entries()) {
      const record = requireRecord({ record: rawRecord, index })
      const sequence = BigInt(record.sequence)
      if (sequence <= previousSequence) { throw new Error("Operational State Store record sequence must be strictly increasing") }
      previousSequence = sequence
      if (seenFactIds.has(record.factId)) { throw new Error("Operational State Store record stream contains duplicate factId " + record.factId) }
      seenFactIds.add(record.factId)

      if (record.factType === "LEDGER_INITIALIZED") { continue }
      if (record.factType === "CONFIGURATION_BASELINE") {
        const { fingerprint, strategyName, markets, schemaVersion } = record.data
        if (schemaVersion !== 1 || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
            typeof strategyName !== "string" || !strategyName.trim() || !Array.isArray(markets) ||
            markets.length === 0 || markets.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol))) {
          throw new TypeError("Durable configuration baseline is malformed")
        }
        const existing = configurationBaselines.get(fingerprint)
        if (existing && JSON.stringify(existing) !== JSON.stringify({ strategyName, markets })) {
          throw new Error("Configuration fingerprint was reused with conflicting strategy metadata")
        }
        configurationBaselines.set(fingerprint, { strategyName, markets })
        continue
      }
      if (record.factType === "PROCESS_STARTED") {
        if (sessions.has(record.runtimeSessionId)) { throw new Error("Runtime session has multiple PROCESS_STARTED facts") }
        const baseline = configurationBaselines.get(record.data.configurationFingerprint)
        if (!baseline || baseline.strategyName !== record.data.strategyName ||
            JSON.stringify(baseline.markets) !== JSON.stringify(record.data.markets) ||
            typeof record.data.tradingEnabled !== "boolean") {
          throw new Error("Process-start fact does not match a preceding durable configuration baseline")
        }
        sessions.set(record.runtimeSessionId, {
          sessionId: record.runtimeSessionId,
          startedSequence: sequence,
          tradingEnabled: record.data.tradingEnabled,
          facts: [],
          stopped: false,
        })
        continue
      }

      if (record.factType === "PROCESS_STOPPED") {
        const session = sessions.get(record.runtimeSessionId)
        if (!session || session.stopped) { throw new Error("Process-stop fact has no unique preceding process-start fact") }
        session.stopped = true
        session.stop = record.data
        session.stopSequence = sequence
        continue
      }

      if (record.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED") {
        const coverageSession = sessions.get(record.runtimeSessionId)
        if (!coverageSession || coverageSession.stopped) { throw new Error("Market-history coverage fact is outside an active process session") }
        const previousCoverage = marketHistoryCoverageBySymbol.get(record.data.symbol)
        if (previousCoverage && (
          record.data.coveredFromTime > previousCoverage.coveredFromTime ||
          record.data.verifiedAt < previousCoverage.verifiedAt
        )) {
          throw new Error("Market-history coverage facts must be monotonic and may never narrow a previously verified history window")
        }
        const coverage = Object.freeze({ ...record.data, factId: record.factId, sequence: record.sequence })
        marketHistoryCoverageBySymbol.set(record.data.symbol, coverage)
        marketHistoryCoverage.push(coverage)
        continue
      }

      if (record.factType === "SAFETY_BLOCKER_RAISED") {
        const blockerSession = sessions.get(record.runtimeSessionId)
        if (!blockerSession || blockerSession.stopped) { throw new Error("Safety-blocker fact is outside an active process session") }
        if (activeBlockers.has(record.data.blockerId)) {
          throw new Error("Safety blocker was raised more than once without an intervening resolution")
        }
        activeBlockers.set(record.data.blockerId, { ...record.data, sequence: record.sequence })
        continue
      }
      if (record.factType === "SAFETY_BLOCKER_RESOLVED") {
        const resolutionSession = sessions.get(record.runtimeSessionId)
        if (!resolutionSession || resolutionSession.stopped) { throw new Error("Safety-blocker resolution is outside an active process session") }
        const raisedBlocker = activeBlockers.get(record.data.blockerId)
        if (!raisedBlocker) {
          throw new Error("Safety blocker resolution has no preceding active raised fact")
        }
        if (raisedBlocker.evidenceDigest === record.data.evidenceDigest ||
            (record.data.resolution === "AUTHORITATIVE_RECONCILIATION" && !record.data.resolvedBy.startsWith("reconciliation:")) ||
            (record.data.resolution === "OPERATOR_ACTION" && !record.data.resolvedBy.startsWith("operator:"))) {
          throw new Error("Safety blocker resolution does not carry independent evidence and an explicit resolver identity")
        }
        activeBlockers.delete(record.data.blockerId)
        continue
      }

      // ADR-0003 keeps operator pause process-lifetime only. Validate its session
      // placement, but retain the fact only as durable audit evidence.
      if (record.factType === "OPERATOR_MARKET_PAUSED") {
        const controlSession = sessions.get(record.runtimeSessionId)
        if (!controlSession || controlSession.stopped) { throw new Error("Operator pause fact is outside an active process session") }
        continue
      }
      if (record.factType === "OPERATOR_MARKET_RESUMED") {
        const controlSession = sessions.get(record.runtimeSessionId)
        if (!controlSession || controlSession.stopped) { throw new Error("Operator resume fact is outside an active process session") }
        continue
      }
      if (record.factType === "STRATEGY_MARKET_PAUSED") {
        const controlSession = sessions.get(record.runtimeSessionId)
        if (!controlSession || controlSession.stopped) { throw new Error("Strategy pause fact is outside an active process session") }
        strategyPauses.set(record.data.symbol, { reason: record.data.reason, sequence: record.sequence })
        continue
      }
      if (record.factType === "STRATEGY_MARKET_RESUMED") {
        const controlSession = sessions.get(record.runtimeSessionId)
        if (!controlSession || controlSession.stopped) { throw new Error("Strategy resume fact is outside an active process session") }
        strategyPauses.delete(record.data.symbol)
        continue
      }

      const session = sessions.get(record.runtimeSessionId)
      if (!session || session.stopped) {
        throw new Error("Durable trading fact is outside an active process session: " + record.factType)
      }
      if (!["ACCOUNT_SNAPSHOT_CAPTURED", "ACCOUNT_OPEN_ORDERS_CAPTURED", "ORDER_SUBMISSION_INTENT", "ORDER_SUBMISSION_OUTCOME", "ORDER_CANCELLATION_INTENT", "ORDER_CANCELLATION_OUTCOME", "EXECUTION_FILL_APPLIED", "RECOVERY_CYCLE_COMPLETED", "RECOVERY_CYCLE_NOT_COMPLETED"].includes(record.factType)) {
        throw new Error("Unsupported Operational State Store projection type: " + record.factType)
      }
      if (record.factType === "ORDER_SUBMISSION_OUTCOME") {
        orderSubmissionOutcomes.push(Object.freeze({ ...record.data, factId: record.factId, sequence: record.sequence }))
      }
      if (record.factType === "ORDER_CANCELLATION_OUTCOME") {
        orderCancellationOutcomes.push(Object.freeze({ ...record.data, factId: record.factId, sequence: record.sequence }))
      }
      if (record.factType === "EXECUTION_FILL_APPLIED") {
        const appliedFillIds = cycleFillIdsByMarket.get(record.data.marketId) ?? []
        if (appliedFillIds.includes(record.data.fillId)) {
          throw new Error("Durable recovery cycle contains a duplicate applied fill identity: " + record.data.fillId)
        }
        appliedFillIds.push(record.data.fillId)
        cycleFillIdsByMarket.set(record.data.marketId, appliedFillIds)
      }
      if (record.factType === "RECOVERY_CYCLE_COMPLETED" || record.factType === "RECOVERY_CYCLE_NOT_COMPLETED") {
        const expectedFillIds = cycleFillIdsByMarket.get(record.data.marketId) ?? []
        if (JSON.stringify(expectedFillIds) !== JSON.stringify(record.data.appliedFillIds)) {
          throw new Error("Durable recovery-cycle outcome does not match the exact applied-fill boundary for " + record.data.marketId)
        }
        const fact = Object.freeze({ factId: record.factId, sequence: record.sequence, data: record.data })
        if (record.factType === "RECOVERY_CYCLE_COMPLETED") {
          recoveryCycleCompletedFacts.push(fact)
          cycleFillIdsByMarket.set(record.data.marketId, [])
        } else {
          recoveryCycleNotCompletedFacts.push(fact)
        }
      }
      session.facts.push(record)
    }

    const sessionList = [...sessions.values()].sort((left, right) => {
      if (left.startedSequence < right.startedSequence) {return -1}
      if (left.startedSequence > right.startedSequence) {return 1}
      return 0
    })
    const latestSession = sessionList[sessionList.length - 1]
    // Strategy pauses are durable recovery state; operator pauses are not
    // replayed after restart and were intentionally excluded above.
    const activePauses = strategyPauses
    const syntheticRecords = []
    for (const session of sessionList) {
      let lineNumber = 0
      const preflight = session.facts.filter((record) =>
        (record.factType === "ACCOUNT_SNAPSHOT_CAPTURED" || record.factType === "ACCOUNT_OPEN_ORDERS_CAPTURED") &&
        record.data.phase === "PREFLIGHT")
      const remaining = session.facts.filter((record) => !preflight.includes(record))
      const emit = (name, data) => {
        syntheticRecords.push(makeEventRecord({ sessionId: session.sessionId, lineNumber: lineNumber++, name, data }))
      }
      for (const record of preflight) {
        const name = record.factType === "ACCOUNT_SNAPSHOT_CAPTURED" ? EVENT.ACCOUNT_SNAPSHOT : EVENT.ACCOUNT_OPEN_ORDERS
        emit(name, record.data)
      }
      emit(EVENT.STARTED, { tradingEnabled: session.tradingEnabled })

      if (session === latestSession) {
        for (const [symbol, pause] of activePauses) {
          emit(EVENT.STRATEGY_PAUSED, { symbol, reason: pause.reason })
        }
        for (const blocker of activeBlockers.values()) {
          emit(EVENT.EXECUTION_ACCOUNTING_FAILED, {
            symbol: blocker.scope === "ACCOUNT" ? "ACCOUNT" : blocker.symbol,
            reason: blocker.reason,
          })
        }
      }

      for (const record of remaining) {
        const events = mapFact({ record, orderIntents, cancellationIntents })
        for (const event of events) { emit(event.name, event.data) }
      }
      if (session.stop) {
        emit(EVENT.STOPPED, {
          outcome: session.stop.clean ? "success" : "failed",
          reason: session.stop.reason,
        })
      }
    }

    const projected = projectHarvesterJournalRecovery({ records: syntheticRecords })
    if (projected?.ok !== true) {
      return projected
    }
    const recoveryCycles = projected.data.recoveryCycles.map((cycle) => {
      const fact = recoveryCycleCompletedFacts.find(({ data }) =>
        data.sellOrderClientId === cycle.completedOrderClientId &&
        data.sellOrderBrokerOrderId === cycle.completedOrderBrokerOrderId &&
        data.marketId === cycle.marketId &&
        data.symbol === cycle.symbol
      )
      if (!fact) {
        throw new Error("Canonical recovery-cycle projection has no matching durable completion fact for " + cycle.symbol)
      }
      return Object.freeze({
        ...cycle,
        cycleId: fact.data.cycleId,
        appliedFillIds: Object.freeze([...fact.data.appliedFillIds]),
        buyCost: fact.data.buyCost,
        spent: fact.data.spent,
        netSellProceeds: fact.data.netSellProceeds,
        realizedNetProfit: fact.data.realizedNetProfit,
        minProfit: fact.data.minProfit,
        activeQuantity: fact.data.activeQuantity,
        keepQuantity: fact.data.keepQuantity,
        freeQuantity: fact.data.freeQuantity,
        inventoryDisposition: fact.data.inventoryDisposition,
        sellOrderClientId: fact.data.sellOrderClientId,
        sellOrderBrokerOrderId: fact.data.sellOrderBrokerOrderId,
        factId: fact.factId,
        // Keep the synthetic replay sequence in the same ordering domain as
        // projected fills. The durable stream sequence is separate metadata.
        durableSequence: requireSafeSequence({ sequence: fact.sequence, factId: fact.factId }),
      })
    })
    if (recoveryCycles.length !== recoveryCycleCompletedFacts.length) {
      throw new Error("Durable recovery-cycle completion facts do not map one-to-one to canonical completed cycles")
    }
    const recoveryCycleEvaluations = projected.data.recoveryCycleEvaluations.map((evaluation) => {
      const fact = recoveryCycleNotCompletedFacts.find(({ data }) =>
        data.sellOrderClientId === evaluation.sellOrderClientId &&
        data.sellOrderBrokerOrderId === evaluation.sellOrderBrokerOrderId &&
        data.marketId === evaluation.marketId &&
        data.symbol === evaluation.symbol &&
        data.outcome === evaluation.outcome &&
        data.reason === evaluation.reason
      )
      if (!fact) {
        throw new Error("Canonical recovery-cycle evaluation has no matching durable NOT_COMPLETED fact for " + evaluation.symbol)
      }
      return Object.freeze({
        ...evaluation,
        evaluationId: fact.data.evaluationId,
        appliedFillIds: Object.freeze([...fact.data.appliedFillIds]),
        buyCost: fact.data.buyCost,
        spent: fact.data.spent,
        netSellProceeds: fact.data.netSellProceeds,
        realizedNetProfit: fact.data.realizedNetProfit,
        minProfit: fact.data.minProfit,
        activeQuantity: fact.data.activeQuantity,
        keepQuantity: fact.data.keepQuantity,
        sellOrderClientId: fact.data.sellOrderClientId,
        sellOrderBrokerOrderId: fact.data.sellOrderBrokerOrderId,
        factId: fact.factId,
        // Keep the synthetic replay sequence in the same ordering domain as
        // projected fills. The durable stream sequence is separate metadata.
        durableSequence: requireSafeSequence({ sequence: fact.sequence, factId: fact.factId }),
      })
    })
    if (recoveryCycleEvaluations.length !== recoveryCycleNotCompletedFacts.length) {
      throw new Error("Durable recovery-cycle NOT_COMPLETED facts do not map one-to-one to canonical evaluations")
    }
    const stickySafetyBlockers = Object.freeze([...activeBlockers.values()].map((blocker) =>
      Object.freeze({ ...blocker, scope: blocker.scope })))
    const pausedMarkets = Object.freeze([...activePauses].map(([symbol, pause]) =>
      Object.freeze({ symbol, reason: pause.reason })))
    return toResult({
      data: Object.freeze({
        ...projected.data,
        recoveryCycles: Object.freeze(recoveryCycles),
        recoveryCycleEvaluations: Object.freeze(recoveryCycleEvaluations),
        orderSubmissionOutcomes: Object.freeze(orderSubmissionOutcomes),
        orderCancellationOutcomes: Object.freeze(orderCancellationOutcomes),
        source: "DURABLE_FACTS",
        candidateOnly: true,
        restorationEnabled: false,
        requiresExchangeReconciliation: true,
        historyCoverageComplete: false,
        marketHistoryCoverage: Object.freeze(marketHistoryCoverage),
        pausedMarkets,
        stickySafetyBlockers,
        sessions: projected.data.sessions,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
