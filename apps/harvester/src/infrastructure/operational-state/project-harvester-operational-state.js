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
    throw new TypeError(`Operational State Store record record ${  index  } has an invalid committed envelope`)
  }
  return record
}

function requireSafeSequence({ sequence, factId }) {
  const numericSequence = Number(sequence)
  if (!Number.isSafeInteger(numericSequence) || numericSequence < 0 || String(numericSequence) !== sequence) {
    throw new RangeError(`Operational State record ${  factId  } exceeds the safe recovery sequence range`)
  }
  return numericSequence
}

function makeEventRecord({ sessionId, lineNumber, name, data }) {
  return {
    position: { fileName: sessionId,
lineNumber },
    payload: { source: "harvester",
name,
data },
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
      throw new Error(`${context  } conflicts with its original durable order intent: ${  field}`)
    }
  }
}

function mapAccountSnapshotFact({ data }) {
  return [{ name: EVENT.ACCOUNT_SNAPSHOT,
data }]
}

function mapAccountOpenOrdersFact({ data }) {
  return [{ name: EVENT.ACCOUNT_OPEN_ORDERS,
data }]
}

function mapOrderSubmissionIntentFact({ data, orderIntents }) {
  orderIntents.set(data.clientOrderId, data)
  return [{
    name: EVENT.SUBMISSION_REQUESTED,
    data: {
      clientOrderId: data.clientOrderId,
      ...(data.providerInstanceId === undefined ? {} : {
        providerInstanceId: data.providerInstanceId,
        providerType: data.providerType,
        accountId: data.accountId,
      }),
      symbol: data.symbol,
      side: data.side,
      type: data.type,
      price: data.price,
      quantity: data.quantity,
      status: "PENDING",
    },
  }]
}

function mapOrderSubmissionOutcomeFact({ data, orderIntents }) {
  const intent = orderIntents.get(data.clientOrderId)
  if (!intent) {
    throw new Error(`Durable submission outcome has no preceding intent: ${data.clientOrderId}`)
  }
  assertIntentMatches({
    intent,
    data,
    fields: ["providerInstanceId", "providerType", "accountId", "marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "type", "price", "quantity", "purpose"],
    context: "Durable submission outcome",
  })
  const immutableIntent = {
    clientOrderId: data.clientOrderId,
    ...(data.providerInstanceId === undefined ? {} : {
      providerInstanceId: data.providerInstanceId,
      providerType: data.providerType,
      accountId: data.accountId,
    }),
    symbol: data.symbol,
    side: data.side,
    type: data.type,
    price: data.price,
    quantity: data.quantity,
  }
  if (data.outcome === "ACKNOWLEDGED") {
    return [{
      name: EVENT.SUBMITTED,
      data: {
        ...immutableIntent,
        brokerOrderId: data.brokerOrderId,
        status: data.status,
      },
    }]
  }
  return [{
    name: EVENT.SUBMISSION_FAILED,
    data: {
      ...immutableIntent,
      outcome: data.outcome,
    },
  }]
}

function mapOrderCancellationIntentFact({ data, orderIntents, cancellationIntents }) {
  const intent = orderIntents.get(data.clientOrderId)
  if (!intent) {
    throw new Error(`Durable cancellation intent has no preceding submission intent: ${data.clientOrderId}`)
  }
  assertIntentMatches({
    intent,
    data,
    fields: ["providerInstanceId", "providerType", "accountId", "marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "type", "price", "quantity"],
    context: "Durable cancellation intent",
  })
  if (cancellationIntents.has(data.clientOrderId)) {
    throw new Error(`Durable cancellation intent was repeated before its prior outcome: ${data.clientOrderId}`)
  }
  cancellationIntents.set(data.clientOrderId, data)
  return [{
    name: EVENT.CANCEL_REQUESTED,
    data: {
      clientOrderId: data.clientOrderId,
      ...(data.providerInstanceId === undefined ? {} : {
        providerInstanceId: data.providerInstanceId,
        providerType: data.providerType,
        accountId: data.accountId,
      }),
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

function mapOrderCancellationOutcomeFact({ data, orderIntents, cancellationIntents }) {
  const intent = orderIntents.get(data.clientOrderId)
  const cancellationIntent = cancellationIntents.get(data.clientOrderId)
  if (!intent || !cancellationIntent) {
    throw new Error(`Durable cancellation outcome has no preceding submission and cancellation intent: ${data.clientOrderId}`)
  }
  assertIntentMatches({
    intent,
    data,
    fields: ["providerInstanceId", "providerType", "accountId", "marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side"],
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
  if (!outcome) {
    throw new Error(`Unsupported durable cancellation outcome: ${data.outcome}`)
  }
  return [{
    name: EVENT.CANCEL_FAILED,
    data: {
      clientOrderId: data.clientOrderId,
      ...(data.providerInstanceId === undefined ? {} : {
        providerInstanceId: data.providerInstanceId,
        providerType: data.providerType,
        accountId: data.accountId,
      }),
      brokerOrderId: data.brokerOrderId,
      symbol: data.symbol,
      side: data.side,
      outcome,
    },
  }]
}

function mapExecutionFillFact({ data }) {
  return [{ name: EVENT.FILL_APPLIED,
data: mapFill({ data }) }]
}

function mapRecoveryCycleCompletedFact({ data }) {
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

function mapRecoveryCycleNotCompletedFact({ data }) {
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

const FACT_EVENT_MAPPERS = Object.freeze({
  ACCOUNT_SNAPSHOT_CAPTURED: mapAccountSnapshotFact,
  ACCOUNT_OPEN_ORDERS_CAPTURED: mapAccountOpenOrdersFact,
  ORDER_SUBMISSION_INTENT: mapOrderSubmissionIntentFact,
  ORDER_SUBMISSION_OUTCOME: mapOrderSubmissionOutcomeFact,
  ORDER_CANCELLATION_INTENT: mapOrderCancellationIntentFact,
  ORDER_CANCELLATION_OUTCOME: mapOrderCancellationOutcomeFact,
  EXECUTION_FILL_APPLIED: mapExecutionFillFact,
  RECOVERY_CYCLE_COMPLETED: mapRecoveryCycleCompletedFact,
  RECOVERY_CYCLE_NOT_COMPLETED: mapRecoveryCycleNotCompletedFact,
})

function mapFact({ record, orderIntents, cancellationIntents }) {
  const mapper = FACT_EVENT_MAPPERS[record.factType]
  if (!mapper) {
    return []
  }
  return mapper({
    data: record.data,
    orderIntents,
    cancellationIntents,
  })
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
const TRADING_FACT_TYPES = new Set([
  "ACCOUNT_SNAPSHOT_CAPTURED",
  "ACCOUNT_OPEN_ORDERS_CAPTURED",
  "ORDER_SUBMISSION_INTENT",
  "ORDER_SUBMISSION_OUTCOME",
  "ORDER_CANCELLATION_INTENT",
  "ORDER_CANCELLATION_OUTCOME",
  "EXECUTION_FILL_APPLIED",
  "RECOVERY_CYCLE_COMPLETED",
  "RECOVERY_CYCLE_NOT_COMPLETED",
])

function createOperationalProjectionState() {
  return {
    configurationBaselines: new Map(),
    sessions: new Map(),
    seenFactIds: new Set(),
    strategyPauses: new Map(),
    activeBlockers: new Map(),
    marketHistoryCoverage: [],
    marketHistoryCoverageBySymbol: new Map(),
    orderIntents: new Map(),
    cancellationIntents: new Map(),
    cycleFillIdsByMarket: new Map(),
    orderSubmissionOutcomes: [],
    orderCancellationOutcomes: [],
    recoveryCycleCompletedFacts: [],
    recoveryCycleNotCompletedFacts: [],
    previousSequence: -1n,
  }
}

function handleConfigurationBaselineFact({ record, state }) {
  const { fingerprint, strategyName, markets, schemaVersion } = record.data
  if (
    schemaVersion !== 1 ||
    typeof fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint) ||
    typeof strategyName !== "string" ||
    !strategyName.trim() ||
    !Array.isArray(markets) ||
    markets.length === 0 ||
    markets.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol))
  ) {
    throw new TypeError("Durable configuration baseline is malformed")
  }
  const baseline = { strategyName,
markets }
  const existing = state.configurationBaselines.get(fingerprint)
  if (existing && JSON.stringify(existing) !== JSON.stringify(baseline)) {
    throw new Error("Configuration fingerprint was reused with conflicting strategy metadata")
  }
  state.configurationBaselines.set(fingerprint, baseline)
}

function handleProcessStartedFact({ record, sequence, state }) {
  if (state.sessions.has(record.runtimeSessionId)) {
    throw new Error("Runtime session has multiple PROCESS_STARTED facts")
  }
  const baseline = state.configurationBaselines.get(record.data.configurationFingerprint)
  if (
    !baseline ||
    baseline.strategyName !== record.data.strategyName ||
    JSON.stringify(baseline.markets) !== JSON.stringify(record.data.markets) ||
    typeof record.data.tradingEnabled !== "boolean"
  ) {
    throw new Error("Process-start fact does not match a preceding durable configuration baseline")
  }
  state.sessions.set(record.runtimeSessionId, {
    sessionId: record.runtimeSessionId,
    startedSequence: sequence,
    tradingEnabled: record.data.tradingEnabled,
    facts: [],
    stopped: false,
  })
}

function requireActiveOperationalSession({ record, state, context }) {
  const session = state.sessions.get(record.runtimeSessionId)
  if (!session || session.stopped) {
    throw new Error(`${context} is outside an active process session`)
  }
  return session
}

function handleProcessStoppedFact({ record, sequence, state }) {
  const session = state.sessions.get(record.runtimeSessionId)
  if (!session || session.stopped) {
    throw new Error("Process-stop fact has no unique preceding process-start fact")
  }
  session.stopped = true
  session.stop = record.data
  session.stopSequence = sequence
}

function handleMarketHistoryCoverageFact({ record, state }) {
  requireActiveOperationalSession({
    record,
    state,
    context: "Market-history coverage fact",
  })
  const previousCoverage = state.marketHistoryCoverageBySymbol.get(record.data.symbol)
  if (
    previousCoverage &&
    (
      record.data.coveredFromTime > previousCoverage.coveredFromTime ||
      record.data.verifiedAt < previousCoverage.verifiedAt
    )
  ) {
    throw new Error("Market-history coverage facts must be monotonic and may never narrow a previously verified history window")
  }
  const coverage = Object.freeze({
    ...record.data,
    factId: record.factId,
    sequence: record.sequence,
  })
  state.marketHistoryCoverageBySymbol.set(record.data.symbol, coverage)
  state.marketHistoryCoverage.push(coverage)
}

function handleSafetyBlockerRaisedFact({ record, state }) {
  requireActiveOperationalSession({
    record,
    state,
    context: "Safety-blocker fact",
  })
  if (state.activeBlockers.has(record.data.blockerId)) {
    throw new Error("Safety blocker was raised more than once without an intervening resolution")
  }
  state.activeBlockers.set(record.data.blockerId, {
    ...record.data,
    sequence: record.sequence,
  })
}

function handleSafetyBlockerResolvedFact({ record, state }) {
  requireActiveOperationalSession({
    record,
    state,
    context: "Safety-blocker resolution",
  })
  const raisedBlocker = state.activeBlockers.get(record.data.blockerId)
  if (!raisedBlocker) {
    throw new Error("Safety blocker resolution has no preceding active raised fact")
  }
  if (
    raisedBlocker.evidenceDigest === record.data.evidenceDigest ||
    (
      record.data.resolution === "AUTHORITATIVE_RECONCILIATION" &&
      !record.data.resolvedBy.startsWith("reconciliation:")
    ) ||
    (
      record.data.resolution === "OPERATOR_ACTION" &&
      !record.data.resolvedBy.startsWith("operator:")
    )
  ) {
    throw new Error("Safety blocker resolution does not carry independent evidence and an explicit resolver identity")
  }
  state.activeBlockers.delete(record.data.blockerId)
}

function handleOperatorControlFact({ record, state, controlName }) {
  requireActiveOperationalSession({
    record,
    state,
    context: `Operator ${controlName} fact`,
  })
}

function handleStrategyMarketPausedFact({ record, state }) {
  requireActiveOperationalSession({
    record,
    state,
    context: "Strategy pause fact",
  })
  state.strategyPauses.set(record.data.symbol, {
    reason: record.data.reason,
    sequence: record.sequence,
  })
}

function handleStrategyMarketResumedFact({ record, state }) {
  requireActiveOperationalSession({
    record,
    state,
    context: "Strategy resume fact",
  })
  state.strategyPauses.delete(record.data.symbol)
}

function handleTradingOperationalFact({ record, state }) {
  const session = requireActiveOperationalSession({
    record,
    state,
    context: `Durable trading fact ${record.factType}`,
  })
  if (!TRADING_FACT_TYPES.has(record.factType)) {
    throw new Error(`Unsupported Operational State Store projection type: ${record.factType}`)
  }
  if (record.factType === "ORDER_SUBMISSION_OUTCOME") {
    state.orderSubmissionOutcomes.push(Object.freeze({
      ...record.data,
      factId: record.factId,
      sequence: record.sequence,
    }))
  }
  if (record.factType === "ORDER_CANCELLATION_OUTCOME") {
    state.orderCancellationOutcomes.push(Object.freeze({
      ...record.data,
      factId: record.factId,
      sequence: record.sequence,
    }))
  }
  if (record.factType === "EXECUTION_FILL_APPLIED") {
    const appliedFillIds = state.cycleFillIdsByMarket.get(record.data.marketId) ?? []
    if (appliedFillIds.includes(record.data.fillId)) {
      throw new Error(`Durable recovery cycle contains a duplicate applied fill identity: ${record.data.fillId}`)
    }
    appliedFillIds.push(record.data.fillId)
    state.cycleFillIdsByMarket.set(record.data.marketId, appliedFillIds)
  }
  if (
    record.factType === "RECOVERY_CYCLE_COMPLETED" ||
    record.factType === "RECOVERY_CYCLE_NOT_COMPLETED"
  ) {
    const expectedFillIds = state.cycleFillIdsByMarket.get(record.data.marketId) ?? []
    if (JSON.stringify(expectedFillIds) !== JSON.stringify(record.data.appliedFillIds)) {
      throw new Error(`Durable recovery-cycle outcome does not match the exact applied-fill boundary for ${record.data.marketId}`)
    }
    const fact = Object.freeze({
      factId: record.factId,
      sequence: record.sequence,
      data: record.data,
    })
    if (record.factType === "RECOVERY_CYCLE_COMPLETED") {
      state.recoveryCycleCompletedFacts.push(fact)
      state.cycleFillIdsByMarket.set(record.data.marketId, [])
    } else {
      state.recoveryCycleNotCompletedFacts.push(fact)
    }
  }
  session.facts.push(record)
}

const FACT_RECORD_HANDLERS = Object.freeze({
  CONFIGURATION_BASELINE: handleConfigurationBaselineFact,
  PROCESS_STARTED: handleProcessStartedFact,
  PROCESS_STOPPED: handleProcessStoppedFact,
  MARKET_HISTORY_COVERAGE_CONFIRMED: handleMarketHistoryCoverageFact,
  SAFETY_BLOCKER_RAISED: handleSafetyBlockerRaisedFact,
  SAFETY_BLOCKER_RESOLVED: handleSafetyBlockerResolvedFact,
  OPERATOR_MARKET_PAUSED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "pause",
  }),
  OPERATOR_MARKET_RESUMED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "resume",
  }),
  OPERATOR_ALL_BUYS_PAUSED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "global BUY pause",
  }),
  OPERATOR_ALL_BUYS_RESUMED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "global BUY resume",
  }),
  OPERATOR_MARKET_BUYS_PAUSED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "market BUY pause",
  }),
  OPERATOR_MARKET_BUYS_RESUMED: (context) => handleOperatorControlFact({
    ...context,
    controlName: "market BUY resume",
  }),
  STRATEGY_MARKET_PAUSED: handleStrategyMarketPausedFact,
  STRATEGY_MARKET_RESUMED: handleStrategyMarketResumedFact,
})

function processOperationalStateRecord({ rawRecord, index, state }) {
  const record = requireRecord({ record: rawRecord,
index })
  const sequence = BigInt(record.sequence)
  if (sequence <= state.previousSequence) {
    throw new Error("Operational State Store record sequence must be strictly increasing")
  }
  state.previousSequence = sequence
  if (state.seenFactIds.has(record.factId)) {
    throw new Error(`Operational State Store record stream contains duplicate factId ${record.factId}`)
  }
  state.seenFactIds.add(record.factId)
  if (record.factType === "LEDGER_INITIALIZED") {
    return
  }
  const handler = FACT_RECORD_HANDLERS[record.factType]
  if (handler) {
    handler({ record,
sequence,
state })
    return
  }
  handleTradingOperationalFact({ record,
state })
}

function sortSessionsByStartedSequence({ sessions }) {
  const orderedSessions = []
  for (const session of sessions) {
    let insertionIndex = orderedSessions.length
    while (
      insertionIndex > 0 &&
      orderedSessions[insertionIndex - 1].startedSequence > session.startedSequence
    ) {
      insertionIndex -= 1
    }
    orderedSessions.splice(insertionIndex, 0, session)
  }
  return orderedSessions
}

function createSessionSyntheticRecords({ session, latestSession, state }) {
  const syntheticRecords = []
  let lineNumber = 0
  const emit = ({ name, data }) => {
    syntheticRecords.push(makeEventRecord({
      sessionId: session.sessionId,
      lineNumber,
      name,
      data,
    }))
    lineNumber += 1
  }
  const preflight = session.facts.filter((record) =>
    (
      record.factType === "ACCOUNT_SNAPSHOT_CAPTURED" ||
      record.factType === "ACCOUNT_OPEN_ORDERS_CAPTURED"
    ) && record.data.phase === "PREFLIGHT"
  )
  const remaining = session.facts.filter((record) => !preflight.includes(record))
  for (const record of preflight) {
    const name = record.factType === "ACCOUNT_SNAPSHOT_CAPTURED"
      ? EVENT.ACCOUNT_SNAPSHOT
      : EVENT.ACCOUNT_OPEN_ORDERS
    emit({ name,
data: record.data })
  }
  emit({ name: EVENT.STARTED,
data: { tradingEnabled: session.tradingEnabled } })

  if (session === latestSession) {
    for (const [symbol, pause] of state.strategyPauses) {
      emit({ name: EVENT.STRATEGY_PAUSED,
data: { symbol,
reason: pause.reason } })
    }
    for (const blocker of state.activeBlockers.values()) {
      emit({
        name: EVENT.EXECUTION_ACCOUNTING_FAILED,
        data: {
          symbol: blocker.scope === "ACCOUNT" ? "ACCOUNT" : blocker.symbol,
          reason: blocker.reason,
        },
      })
    }
  }

  for (const record of remaining) {
    const events = mapFact({
      record,
      orderIntents: state.orderIntents,
      cancellationIntents: state.cancellationIntents,
    })
    for (const event of events) {
      emit({ name: event.name,
data: event.data })
    }
  }
  if (session.stop) {
    emit({
      name: EVENT.STOPPED,
      data: {
        outcome: session.stop.clean ? "success" : "failed",
        reason: session.stop.reason,
      },
    })
  }
  return syntheticRecords
}

function createSyntheticJournalRecords({ state }) {
  const sessions = sortSessionsByStartedSequence({ sessions: [...state.sessions.values()] })
  const latestSession = sessions[sessions.length - 1]
  const syntheticRecords = []
  for (const session of sessions) {
    syntheticRecords.push(...createSessionSyntheticRecords({
      session,
      latestSession,
      state,
    }))
  }
  return syntheticRecords
}

function mapCompletedRecoveryCycles({ cycles, facts }) {
  const mappedCycles = []
  for (const cycle of cycles) {
    const fact = facts.find(({ data }) =>
      data.sellOrderClientId === cycle.completedOrderClientId &&
      data.sellOrderBrokerOrderId === cycle.completedOrderBrokerOrderId &&
      data.marketId === cycle.marketId &&
      data.symbol === cycle.symbol
    )
    if (!fact) {
      throw new Error(`Canonical recovery-cycle projection has no matching durable completion fact for ${cycle.symbol}`)
    }
    mappedCycles.push(Object.freeze({
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
      durableSequence: requireSafeSequence({ sequence: fact.sequence,
factId: fact.factId }),
    }))
  }
  if (mappedCycles.length !== facts.length) {
    throw new Error("Durable recovery-cycle completion facts do not map one-to-one to canonical completed cycles")
  }
  return Object.freeze(mappedCycles)
}

function mapRecoveryCycleEvaluations({ evaluations, facts }) {
  const mappedEvaluations = []
  for (const evaluation of evaluations) {
    const fact = facts.find(({ data }) =>
      data.sellOrderClientId === evaluation.sellOrderClientId &&
      data.sellOrderBrokerOrderId === evaluation.sellOrderBrokerOrderId &&
      data.marketId === evaluation.marketId &&
      data.symbol === evaluation.symbol &&
      data.outcome === evaluation.outcome &&
      data.reason === evaluation.reason
    )
    if (!fact) {
      throw new Error(`Canonical recovery-cycle evaluation has no matching durable NOT_COMPLETED fact for ${evaluation.symbol}`)
    }
    mappedEvaluations.push(Object.freeze({
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
      durableSequence: requireSafeSequence({ sequence: fact.sequence,
factId: fact.factId }),
    }))
  }
  if (mappedEvaluations.length !== facts.length) {
    throw new Error("Durable recovery-cycle NOT_COMPLETED facts do not map one-to-one to canonical evaluations")
  }
  return Object.freeze(mappedEvaluations)
}

function createOperationalProjectionResult({ projected, state }) {
  const recoveryCycles = mapCompletedRecoveryCycles({
    cycles: projected.data.recoveryCycles,
    facts: state.recoveryCycleCompletedFacts,
  })
  const recoveryCycleEvaluations = mapRecoveryCycleEvaluations({
    evaluations: projected.data.recoveryCycleEvaluations,
    facts: state.recoveryCycleNotCompletedFacts,
  })
  const stickySafetyBlockers = Object.freeze([...state.activeBlockers.values()].map((blocker) =>
    Object.freeze({ ...blocker,
scope: blocker.scope })
  ))
  const pausedMarkets = Object.freeze([...state.strategyPauses].map(([symbol, pause]) =>
    Object.freeze({ symbol,
reason: pause.reason })
  ))
  return toResult({
    data: Object.freeze({
      ...projected.data,
      recoveryCycles,
      recoveryCycleEvaluations,
      orderSubmissionOutcomes: Object.freeze(state.orderSubmissionOutcomes),
      orderCancellationOutcomes: Object.freeze(state.orderCancellationOutcomes),
      source: "DURABLE_FACTS",
      candidateOnly: true,
      restorationEnabled: false,
      requiresExchangeReconciliation: true,
      historyCoverageComplete: false,
      marketHistoryCoverage: Object.freeze(state.marketHistoryCoverage),
      pausedMarkets,
      stickySafetyBlockers,
      sessions: projected.data.sessions,
    }),
  })
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
    if (!Array.isArray(records)) {
      throw new TypeError("Operational State Store projection requires a verified records array")
    }
    const state = createOperationalProjectionState()
    for (const [index, rawRecord] of records.entries()) {
      processOperationalStateRecord({ rawRecord,
index,
state })
    }
    const syntheticRecords = createSyntheticJournalRecords({ state })
    const projected = projectHarvesterJournalRecovery({ records: syntheticRecords })
    if (projected?.ok !== true) {
      return projected
    }
    return createOperationalProjectionResult({ projected,
state })
  } catch (error) {
    return toResult({ error })
  }
}
