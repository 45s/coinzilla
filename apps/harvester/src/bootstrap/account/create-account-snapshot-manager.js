import { performance } from "node:perf_hooks"
import { compareDecimal, toResult } from "@coinzilla/utils"
import { AccountSnapshot } from "../../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../../domain/account/assert-account-snapshot-covers-markets.js"
import { calculateAccountSnapshotBaselines } from "../../domain/account/calculate-account-snapshot-baselines.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
} from "../../application/events/lifecycle-event-dtos.js"
import { recordAccountSnapshotCaptured, recordAccountOpenOrdersCaptured } from "../../use-cases/record-account-reconciliation-facts.js"

function withRecoveryFailure({ error, category, stage, retryable }) {
  const normalized = error instanceof Error ? error : new Error(String(error), {
    cause: error,
  })
  normalized.recoveryFailure = normalized.recoveryFailure ?? {
    category,
    stage,
    retryable,
  }
  return normalized
}

function resolveAuditFlushFailure({ flushed, stage }) {
  const failure = flushed?.recoveryFailure
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_WRITE_FAILURE" && failure?.retryable === false) { return failure }
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_FLUSH_FAILURE" && failure?.retryable === true) { return failure }
  return {
    category: "DURABILITY",
    stage: `${stage  }_UNCLASSIFIED`,
    retryable: false,
  }
}

function createAuditFlushError({
  flushed,
  message,
  stage,
}) {
  const failure = resolveAuditFlushFailure({ flushed,
stage })
  const cause = flushed?.errors?.find?.((error) => error instanceof Error)
  const error = cause ? new Error(message, {
    cause,
  }) : new Error(message)
  return withRecoveryFailure({
  error,
  category: failure.category,
  stage: failure.stage,
  retryable: failure.retryable,
})
}

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function createAccountSnapshotAuditPayload({
  phase,
  snapshot,
  allowedAssetCodes,
  auditStatus,
  auditReasons,
}) {
  let dataResult
  try {
    dataResult = mapAccountSnapshotCapturedData({
      phase,
      snapshot,
      allowedAssetCodes,
      auditStatus,
      auditReasons,
    })
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_AUDIT_PAYLOAD",
  retryable: false,
})
  }
  if (!dataResult?.ok) {
    throw withRecoveryFailure({
  error: dataResult?.errors?.[0] ?? new Error("Account snapshot audit payload is invalid"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_AUDIT_PAYLOAD",
  retryable: false,
})
  }
  return dataResult
}

async function persistAccountSnapshotAudit({
  operationalStateStore,
  data,
}) {
  if (!operationalStateStore) {
    return
  }
  const durable = await recordAccountSnapshotCaptured({
    operationalStateStore,
    data,
  })
  if (durable?.ok !== true || durable.data?.durable !== true) {
    const cause = durable?.errors?.[0] ?? new Error("Account snapshot durable fact was not committed")
    throw withRecoveryFailure({
  error: new Error(`Unable to durably persist account snapshot: ${  cause.message ?? String(cause)}`, {
        cause,
      }),
  category: "DURABILITY",
  stage: "ACCOUNT_SNAPSHOT_DURABLE_FACT",
  retryable: false,
})
  }
}

function logClosingJournalBarrier({
  logger,
  runtimeSessionId,
  monotonicNow,
  startedAt,
  phaseStatus,
  failureReason,
}) {
  logSystem({ logger,
    message: `Harvester shutdown phase ${  phaseStatus.toLowerCase()}`,
    shutdownPhase: "JOURNAL_DURABILITY_BARRIER",
    phaseStatus,
    phase: "CLOSING",
    shutdownCorrelationId: runtimeSessionId ?? null,
    ...(startedAt === undefined ? {} : { durationMs: Math.max(0, monotonicNow() - startedAt) }),
    ...(failureReason ? { failureReason } : {}),
  })
}

function throwMissingAccountSnapshotFlushCapability({ phase, logger, runtimeSessionId }) {
  if (phase === "CLOSING") {
    logSystem({ logger,
      message: "Harvester shutdown phase failed",
      shutdownPhase: "JOURNAL_DURABILITY_BARRIER",
      phaseStatus: "FAILED",
      phase: "CLOSING",
      shutdownCorrelationId: runtimeSessionId ?? null,
      failureReason: "JOURNAL_FLUSH_CAPABILITY_MISSING",
    })
  }
  throw withRecoveryFailure({
  error: new Error("Harvester startup requires a durable Journal flush before market subscriptions"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_CAPABILITY",
  retryable: false,
})
}

function throwAccountSnapshotFlushException({ error, isClosing, logger, runtimeSessionId, monotonicNow, startedAt }) {
  if (isClosing) {
    logClosingJournalBarrier({
      logger,
      runtimeSessionId,
      monotonicNow,
      startedAt,
      phaseStatus: "FAILED",
      failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "JOURNAL_FLUSH_FAILED",
    })
  }
  throw withRecoveryFailure({
  error,
  category: "DURABILITY",
  stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_UNCLASSIFIED",
  retryable: false,
})
}

function throwNonDurableAccountSnapshotFlush({ flushed, phase, isClosing, logger, runtimeSessionId, monotonicNow, startedAt }) {
  if (isClosing) {
    logClosingJournalBarrier({
      logger,
      runtimeSessionId,
      monotonicNow,
      startedAt,
      phaseStatus: "FAILED",
      failureReason: flushed?.recoveryFailure?.stage ?? "JOURNAL_FLUSH_NOT_DURABLE",
    })
  }
  const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
  throw createAuditFlushError({
    flushed,
    message: `Unable to durably persist ${  phase  } account snapshot${  details ? `: ${  details}` : ""}`,
    stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH",
  })
}

async function flushAccountSnapshotAudit({
  eventPublisher,
  phase,
  logger,
  runtimeSessionId,
  monotonicNow,
}) {
  if (typeof eventPublisher?.flush !== "function") {
    throwMissingAccountSnapshotFlushCapability({ phase,
logger,
runtimeSessionId })
  }

  const startedAt = monotonicNow()
  const isClosing = phase === "CLOSING"
  if (isClosing) {
    logSystem({ logger,
      message: "Harvester shutdown phase started",
      shutdownPhase: "JOURNAL_DURABILITY_BARRIER",
      phaseStatus: "STARTED",
      phase: "CLOSING",
      shutdownCorrelationId: runtimeSessionId ?? null,
    })
  }

  let flushed
  try {
    flushed = await eventPublisher.flush()
  } catch (error) {
    throwAccountSnapshotFlushException({
      error,
      isClosing,
      logger,
      runtimeSessionId,
      monotonicNow,
      startedAt,
    })
  }

  if (flushed?.ok !== true || flushed?.durable !== true) {
    throwNonDurableAccountSnapshotFlush({
      flushed,
      phase,
      isClosing,
      logger,
      runtimeSessionId,
      monotonicNow,
      startedAt,
    })
  }

  if (isClosing) {
    logClosingJournalBarrier({
      logger,
      runtimeSessionId,
      monotonicNow,
      startedAt,
      phaseStatus: "COMPLETED",
    })
  }
}


function getAccountAuditMarkets({ marketMetadata }) {
  return [...marketMetadata.values()].map(({ market }) => market)
}

function getAccountSnapshotResultError({ result }) {
  if (result?.ok !== false && result?.ok !== true) {
    return withRecoveryFailure({
  error: new Error("Canonical exchange account snapshot response is missing an explicit success flag"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_RESPONSE",
  retryable: false,
})
  }
  if (result.ok === false) {
    const details = result.errors?.map((error) => error?.message ?? String(error)).join("; ")
    const cause = result.errors?.find?.((error) => error instanceof Error)
    return withRecoveryFailure({
  error: new Error(`Unable to load canonical exchange account balances${  details ? `: ${  details}` : ""}`, {
        cause,
      }),
  category: "REST_RECONCILIATION",
  stage: "ACCOUNT_SNAPSHOT_READ",
  retryable: true,
})
  }
  if (!result.data || !Array.isArray(result.data.balances)) {
    return withRecoveryFailure({
  error: new Error("Canonical exchange account snapshot is malformed: balances must be an array"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_SHAPE",
  retryable: false,
})
  }
  return undefined
}

async function readAccountSnapshotFromBroker({ broker }) {
  try {
    return await broker.getAccountSnapshot()
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_READ_EXCEPTION",
  retryable: false,
})
  }
}

function capturePreflightBalances({ result, state }) {
  if (state.preflightSourceTime !== undefined) {
    return
  }
  const sourceSnapshot = new AccountSnapshot({
    balances: result.data.balances,
    sourceTime: result.data.sourceTime,
  })
  state.preflightSourceTime = sourceSnapshot.sourceTime
  state.preflightBalancesByCode = new Map(sourceSnapshot.balances.map((balance) => [
    balance.asset.code,
    balance,
  ]))
}

function createInitialAccountSnapshotManagerState() {
  return {
    accountSnapshot: undefined,
    preflightSourceTime: undefined,
    preflightBalancesByCode: new Map(),
    commissionBaselineAssetIds: new Map(),
    commissionBaselineAssetCodesById: new Map(),
    unownedOpenOrderSymbols: new Set(),
    pendingExternalOrderVersions: new Map(),
    externalOrderObservationSequence: 0,
  }
}

function resolveAdditionalTrackedBaseQuantityGetter({ getter } = {}) {
  if (typeof getter !== "function") {
    throw new TypeError("createAccountSnapshotManager requires getAdditionalTrackedBaseQuantity to be a function")
  }
  return getter
}

function resolveAdditionalTrackedQuoteCashFlowGetter({ getter } = {}) {
  if (typeof getter !== "function") {
    throw new TypeError("createAccountSnapshotManager requires getAdditionalTrackedQuoteCashFlow to be a function")
  }
  return getter
}

function getAccountSnapshotBaselines({ context, balances }) {
  const portfolio = context.getPortfolio()
  const activeOrders = context.getTradingEngine()?.getActiveOrders?.() ??
    context.getRecoveredState()?.orderRegistry?.getActiveOrders?.() ?? []
  let additionalTrackedBaseQuantity
  let additionalTrackedQuoteCashFlow
  try {
    const input = {
      balances: Object.freeze([...balances]),
      portfolio,
    }
    additionalTrackedBaseQuantity = context.getAdditionalTrackedBaseQuantity(input)
    additionalTrackedQuoteCashFlow = context.getAdditionalTrackedQuoteCashFlow(input)
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_BASELINE",
  retryable: false,
})
  }
  const baselineResult = calculateAccountSnapshotBaselines({
    portfolio,
    activeOrders,
    additionalTrackedBaseQuantity,
    additionalTrackedQuoteCashFlow,
  })
  if (!baselineResult.ok) {
    throw withRecoveryFailure({
  error: baselineResult.errors?.[0] ?? new Error("Unable to capture account snapshot accounting baselines"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_BASELINE",
  retryable: false,
})
  }
  return baselineResult.data
}

function createTrackedAccountSnapshot({ context, result, baselines }) {
  const accountAuditMarkets = getAccountAuditMarkets(context)
  const configuredAssetCodes = new Set(accountAuditMarkets.flatMap((market) => [
    market.baseAsset.code,
    market.quoteAsset.code,
  ]))
  const trackedAssetCodes = new Set([
    ...configuredAssetCodes,
    ...context.state.commissionBaselineAssetIds.keys(),
  ])
  const trackedBalances = result.data.balances.filter((balance) =>
    trackedAssetCodes.has(balance?.asset?.code))
  const nextSnapshot = new AccountSnapshot({
    balances: trackedBalances,
    sourceTime: result.data.sourceTime,
    ...baselines,
  })
  assertAccountSnapshotCoversMarkets({
    accountSnapshot: nextSnapshot,
    markets: accountAuditMarkets,
  })
  if (context.state.accountSnapshot && nextSnapshot.sourceTime < context.state.accountSnapshot.sourceTime) {
    throw new Error("Exchange account snapshot is older than the previously accepted snapshot")
  }
  return nextSnapshot
}

async function refreshAccountSnapshot({ context, capturePreflightBaseline = false }) {
  const result = await readAccountSnapshotFromBroker({
    broker: context.broker,
  })
  const responseError = getAccountSnapshotResultError({
    result,
  })
  if (responseError) {
    throw responseError
  }
  const baselines = getAccountSnapshotBaselines({
    context,
    balances: result.data.balances,
  })
  if (capturePreflightBaseline && context.state.preflightSourceTime === undefined) {
    try {
      capturePreflightBalances({
        result,
        state: context.state,
      })
    } catch (error) {
      throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_VALIDATION",
  retryable: false,
})
    }
  }
  let nextSnapshot
  try {
    nextSnapshot = createTrackedAccountSnapshot({
      context,
      result,
      baselines,
    })
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_SNAPSHOT_VALIDATION",
  retryable: false,
})
  }
  context.state.accountSnapshot = nextSnapshot
  logSystem({ logger: context.logger,
    message: "Exchange account snapshot loaded",
    balanceCount: nextSnapshot.balances.length,
    sourceTime: nextSnapshot.sourceTime,
  })
  return nextSnapshot
}

async function readAccountOpenOrders({ broker, suppliedOrders }) {
  if (suppliedOrders !== undefined) {
    if (!Array.isArray(suppliedOrders)) {
      throw withRecoveryFailure({
  error: new TypeError("publishOpenOrdersSnapshot orders must be an array"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT",
  retryable: false,
})
    }
    return suppliedOrders
  }
  let result
  try {
    result = await broker.getOpenOrders({})
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ_EXCEPTION",
  retryable: false,
})
  }
  if (result?.ok !== false && result?.ok !== true) {
    throw withRecoveryFailure({
  error: new Error("Account-wide open-orders response is missing an explicit success flag"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_WIDE_OPEN_ORDERS_RESPONSE",
  retryable: false,
})
  }
  if (result.ok === false) {
    const details = result.errors?.map((error) => error?.message ?? String(error)).join("; ")
    const cause = result.errors?.find?.((error) => error instanceof Error)
    throw withRecoveryFailure({
  error: new Error(`Unable to load authoritative account-wide open orders${  details ? `: ${  details}` : ""}`, {
        cause,
      }),
  category: "REST_RECONCILIATION",
  stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ",
  retryable: true,
})
  }
  if (!Array.isArray(result.data)) {
    throw withRecoveryFailure({
  error: new TypeError("Account-wide open-orders response must be an array"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT",
  retryable: false,
})
  }
  return result.data
}


function isNonEmptyOrderIdentity(value) {
  return typeof value === "string" && value.trim().length > 0
}

function readOpenOrderSnapshotPrice(order) {
  return order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
}

function readOpenOrderSnapshotQuantity(order) {
  return order.originalQuantity?.amount ?? order.originalQuantity
}

function readOpenOrderSnapshotIdentity(order) {
  const clientOrderId = order?.clientOrderId
  const brokerOrderId = order?.brokerOrderId ?? order?.id
  const symbol = order?.market?.symbol ?? order?.symbol
  if (
    !isNonEmptyOrderIdentity(clientOrderId) ||
    !isNonEmptyOrderIdentity(brokerOrderId) ||
    !isNonEmptyOrderIdentity(symbol)
  ) {
    return undefined
  }
  return {
    clientOrderId,
    brokerOrderId,
    symbol,
    actualPrice: readOpenOrderSnapshotPrice(order),
    actualQuantity: readOpenOrderSnapshotQuantity(order),
  }
}

function findRestoredOpenOrder({ restoredOrders, clientOrderId, brokerOrderId }) {
  return restoredOrders.find((candidate) =>
    candidate.clientOrderId === clientOrderId ||
    (candidate.brokerOrderId !== undefined && candidate.brokerOrderId === brokerOrderId))
}

function isRestoredOpenOrderEligible({ owned, brokerOrderId, matchedOwnedClientIds }) {
  if (!owned || matchedOwnedClientIds.has(owned.clientOrderId)) {
    return false
  }
  if (owned.status === "CANCELED" || owned.status === "REJECTED") {
    return false
  }
  return owned.brokerOrderId === undefined || owned.brokerOrderId === brokerOrderId
}

function matchesRestoredOpenOrderIdentity({ owned, identity }) {
  return owned.clientOrderId === identity.clientOrderId &&
    owned.market.symbol === identity.symbol &&
    owned.side === identity.order.side &&
    owned.type === identity.order.type &&
    compareDecimal({
      left: owned.originalQuantity.amount,
      right: identity.actualQuantity,
    }) === 0
}

function matchesRestoredOpenOrderPrice({ owned, actualPrice }) {
  const expectedPrice = owned.limitPrice?.amount
  if (expectedPrice === undefined) {
    return actualPrice === undefined
  }
  return actualPrice !== undefined && compareDecimal({
    left: expectedPrice,
    right: String(actualPrice),
  }) === 0
}

function isOwnedOpenOrderSnapshot({ order, restoredOrders, matchedOwnedClientIds }) {
  const identity = readOpenOrderSnapshotIdentity(order)
  if (!identity) {
    return false
  }
  const owned = findRestoredOpenOrder({
    restoredOrders,
    ...identity,
  })
  if (!isRestoredOpenOrderEligible({
    owned,
    brokerOrderId: identity.brokerOrderId,
    matchedOwnedClientIds,
  })) {
    return false
  }
  const identityMatches = matchesRestoredOpenOrderIdentity({
    owned,
    identity: {
      ...identity,
      order,
    },
  })
  const priceMatches = matchesRestoredOpenOrderPrice({
    owned,
    actualPrice: identity.actualPrice,
  })
  if (!identityMatches || !priceMatches) {
    return false
  }
  matchedOwnedClientIds.add(owned.clientOrderId)
  return true
}

function classifyAccountOpenOrders({ orders, restoredOrders, ownershipReconciled }) {
  const matchedOwnedClientIds = new Set()
  const unownedOrders = orders.filter((order) => !isOwnedOpenOrderSnapshot({
    order,
    restoredOrders,
    matchedOwnedClientIds,
  }))
  const blockReasons = []
  if (unownedOrders.length > 0) {
    blockReasons.push(`UNOWNED_OPEN_ORDERS:${  unownedOrders.length}`)
  } else if (orders.length > 0 && !ownershipReconciled) {
    blockReasons.push("CANONICAL_ORDER_RECONCILIATION_REQUIRED")
  }
  let readiness = "READY"
  if (blockReasons.length > 0) {
    readiness = "BLOCKED"
  } else if (orders.length > 0) {
    readiness = "RECONCILED"
  }
  return {
    unownedOrders,
    blockReasons,
    readiness,
  }
}

function createOpenOrdersAuditPayload({ phase, orders, classification, now }) {
  let dataResult
  try {
    dataResult = mapAccountOpenOrdersCapturedData({
      phase,
      observedAt: now(),
      orders,
      readiness: classification.readiness,
      blockReasons: classification.blockReasons,
    })
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD",
  retryable: false,
})
  }
  if (!dataResult?.ok) {
    throw withRecoveryFailure({
  error: dataResult?.errors?.[0] ?? new Error("Account open-orders audit payload is invalid"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD",
  retryable: false,
})
  }
  return dataResult
}

async function persistOpenOrdersAuditFact({ operationalStateStore, dataResult }) {
  if (!operationalStateStore) {
    return
  }
  const durable = await recordAccountOpenOrdersCaptured({
    operationalStateStore,
    data: dataResult.data,
  })
  if (durable?.ok !== true || durable.data?.durable !== true) {
    const cause = durable?.errors?.[0] ?? new Error("Account open-orders durable fact was not committed")
    throw withRecoveryFailure({
  error: new Error(`Unable to durably persist account open-orders snapshot: ${  cause.message ?? String(cause)}`, {
        cause,
      }),
  category: "DURABILITY",
  stage: "ACCOUNT_OPEN_ORDERS_DURABLE_FACT",
  retryable: false,
})
  }
}

async function publishOpenOrdersAuditEvent({ eventPublisher, dataResult }) {
  const published = publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
    dataResult,
  })
  if (!published?.ok) {
    const details = published?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw withRecoveryFailure({
  error: new Error(`Unable to publish account open-orders audit event${  details ? `: ${  details}` : ""}`),
  category: "DURABILITY",
  stage: "ACCOUNT_OPEN_ORDERS_AUDIT_PUBLICATION",
  retryable: true,
})
  }
  if (typeof eventPublisher?.flush !== "function") {
    throw withRecoveryFailure({
  error: new Error("Harvester startup requires a durable open-orders audit before market subscriptions"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH_CAPABILITY",
  retryable: false,
})
  }
  let flushed
  try {
    flushed = await eventPublisher.flush()
  } catch (error) {
    throw withRecoveryFailure({
  error,
  category: "DURABILITY",
  stage: "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH_UNCLASSIFIED",
  retryable: false,
})
  }
  if (flushed?.ok !== true || flushed?.durable !== true) {
    const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw createAuditFlushError({
      flushed,
      message: `Unable to durably persist account open-orders audit${  details ? `: ${  details}` : ""}`,
      stage: "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH",
    })
  }
}

function createOpenOrdersGuardState({ unownedOrders }) {
  return {
    unownedOpenOrderSymbols: new Set(unownedOrders
      .map((order) => order?.market?.symbol ?? order?.symbol)
      .filter((symbol) => typeof symbol === "string" && symbol.trim().length > 0)),
  }
}

function logOpenOrdersAudit({ logger, orders, unownedOrders, readiness }) {
  let message = "Account-wide open-orders audit is waiting for canonical order reconciliation"
  if (readiness === "READY") {
    message = "Account-wide open-orders audit complete; no open orders found"
  } else if (readiness === "RECONCILED") {
    message = "Account-wide open-orders audit complete; all open orders match restored Harvester ownership"
  } else if (unownedOrders.length > 0) {
    message = "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched"
  }
  logger.info?.({
    message,
    orderCount: orders.length,
    readiness,
    symbols: [...new Set(orders.map((order) => order.market?.symbol ?? order.symbol).filter(Boolean))],
  })
}

async function publishOpenOrdersSnapshot({ context, options }) {
  const orders = await readAccountOpenOrders({
    broker: context.broker,
    suppliedOrders: options.orders,
  })
  const restoredOrders = context.getTradingEngine()?.getOrders?.() ??
    context.getRecoveredState()?.orderRegistry?.orders ?? []
  const classification = classifyAccountOpenOrders({
    orders,
    restoredOrders,
    ownershipReconciled: options.ownershipReconciled,
  })
  const dataResult = createOpenOrdersAuditPayload({
    phase: options.phase,
    orders,
    classification,
    now: context.now,
  })
  await persistOpenOrdersAuditFact({
    operationalStateStore: context.operationalStateStore,
    dataResult,
  })
  await publishOpenOrdersAuditEvent({
    eventPublisher: context.eventPublisher,
    dataResult,
  })
  const guardState = createOpenOrdersGuardState({
    unownedOrders: classification.unownedOrders,
  })
  context.state.unownedOpenOrderSymbols = guardState.unownedOpenOrderSymbols
  logOpenOrdersAudit({
    logger: context.logger,
    orders,
    unownedOrders: classification.unownedOrders,
    readiness: classification.readiness,
  })
  return orders
}

function getConfiguredAccountAssetCodes({ marketMetadata }) {
  return [...new Set([...marketMetadata.values()].flatMap(({ market }) => [
    market.baseAsset.code,
    market.quoteAsset.code,
  ]))]
}

async function publishAccountSnapshot({ context, options }) {
  const snapshot = options.snapshot ?? await refreshAccountSnapshot({
    context,
    capturePreflightBaseline: options.phase === "PREFLIGHT",
  })
  const configuredAssetCodes = getConfiguredAccountAssetCodes({
    marketMetadata: context.marketMetadata,
  })
  const allowedAssetCodes = options.allowedAssetCodes ?? [...new Set([
    ...configuredAssetCodes,
    ...context.state.commissionBaselineAssetIds.keys(),
  ])]
  const dataResult = createAccountSnapshotAuditPayload({
    phase: options.phase,
    snapshot,
    allowedAssetCodes,
    auditStatus: options.auditStatus,
    auditReasons: options.auditReasons,
  })
  await persistAccountSnapshotAudit({
    operationalStateStore: context.operationalStateStore,
    data: dataResult.data,
  })
  const published = publishLifecycleEvent({
    eventPublisher: context.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
    dataResult,
  })
  if (!published?.ok) {
    throw withRecoveryFailure({
  error: new Error(`Unable to publish ${  options.phase  } account snapshot audit event`),
  category: "DURABILITY",
  stage: "ACCOUNT_SNAPSHOT_AUDIT_PUBLICATION",
  retryable: true,
})
  }
  await flushAccountSnapshotAudit({
    eventPublisher: context.eventPublisher,
    phase: options.phase,
    logger: context.logger,
    runtimeSessionId: context.runtimeSessionId,
    monotonicNow: context.monotonicNow,
  })
  logSystem({ logger: context.logger,
    message: "Account snapshot captured and durably journaled",
    phase: options.phase,
    auditStatus: options.auditStatus,
    assetCount: snapshot.balances.length,
    sourceTime: snapshot.sourceTime,
    auditReasons: options.auditReasons,
  })
  return snapshot
}

function validateCommissionAssetIdentity({ assetId, assetCode }) {
  if (typeof assetId !== "string" || !assetId.trim() ||
      typeof assetCode !== "string" || !assetCode.trim()) {
    throw withRecoveryFailure({
  error: new TypeError("Commission asset baseline requires assetId and assetCode"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_BASELINE_IDENTITY",
  retryable: false,
})
  }
}

function findConfiguredCommissionAsset({ context, assetId, assetCode }) {
  const configuredAssets = [...context.marketMetadata.values()].flatMap(({ market }) => [
    market.baseAsset,
    market.quoteAsset,
  ])
  return configuredAssets.find((asset) => asset.id === assetId || asset.code === assetCode)
}

function validateConfiguredCommissionAsset({ configuredAsset, assetId, assetCode }) {
  if (!configuredAsset) {
    return false
  }
  if (configuredAsset.id !== assetId || configuredAsset.code !== assetCode) {
    throw withRecoveryFailure({
  error: new Error(`Commission asset identity contradicts configured market metadata for ${  assetCode}`),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_BASELINE_IDENTITY",
  retryable: false,
})
  }
  return true
}

function getKnownCommissionBaseline({ context, assetId, assetCode }) {
  const knownAssetId = context.state.commissionBaselineAssetIds.get(assetCode)
  const knownAssetCode = context.state.commissionBaselineAssetCodesById.get(assetId)
  if (knownAssetId === undefined && knownAssetCode === undefined) {
    return false
  }
  if (knownAssetId !== assetId || knownAssetCode !== assetCode) {
    throw withRecoveryFailure({
  error: new Error(`Commission asset ID/code mapping is contradictory for ${  assetCode}`),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_BASELINE_IDENTITY",
  retryable: false,
})
  }
  return true
}

function getPreflightCommissionBalance({ context, assetId, assetCode }) {
  if (context.state.preflightSourceTime === undefined) {
    throw withRecoveryFailure({
  error: new Error("Commission asset baseline cannot be captured before the durable PREFLIGHT snapshot"),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_PREFLIGHT_MISSING",
  retryable: false,
})
  }
  const balance = context.state.preflightBalancesByCode.get(assetCode)
  if (!balance) {
    throw withRecoveryFailure({
  error: new Error(`PREFLIGHT account snapshot is missing commission asset ${assetCode}`),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_PREFLIGHT_BALANCE_MISSING",
  retryable: false,
})
  }
  if (balance.asset.id !== assetId || balance.asset.code !== assetCode) {
    throw withRecoveryFailure({
  error: new Error(`PREFLIGHT commission asset balance identity contradicts the applied fill for ${assetCode}`),
  category: "ACCOUNTING_INTEGRITY",
  stage: "COMMISSION_ASSET_PREFLIGHT_BALANCE_IDENTITY",
  retryable: false,
})
  }
  return balance
}

function createCommissionBaselineSnapshot({ context, balance }) {
  return new AccountSnapshot({
    sourceTime: context.state.preflightSourceTime,
    balances: [balance],
  })
}

async function publishCommissionAssetBaseline({ context, options }) {
  validateCommissionAssetIdentity(options)
  const configuredAsset = findConfiguredCommissionAsset({
    context,
    assetId: options.assetId,
    assetCode: options.assetCode,
  })
  if (validateConfiguredCommissionAsset({
    configuredAsset,
    assetId: options.assetId,
    assetCode: options.assetCode,
  })) {
    return {
      ok: true,
      data: Object.freeze({
        skipped: true,
        reason: "CONFIGURED_MARKET_ASSET",
      }),
    }
  }
  if (getKnownCommissionBaseline({
    context,
    assetId: options.assetId,
    assetCode: options.assetCode,
  })) {
    return {
      ok: true,
      data: Object.freeze({
        skipped: true,
        reason: "BASELINE_ALREADY_CAPTURED",
      }),
    }
  }
  const balance = getPreflightCommissionBalance({
    context,
    assetId: options.assetId,
    assetCode: options.assetCode,
  })
  const baselineSnapshot = createCommissionBaselineSnapshot({
    context,
    balance,
  })
  await publishAccountSnapshot({
    context,
    options: {
      phase: "COMMISSION_BASELINE",
      snapshot: baselineSnapshot,
      allowedAssetCodes: [options.assetCode],
      auditStatus: "COMPLETE",
      auditReasons: [],
    },
  })
  context.state.commissionBaselineAssetIds.set(options.assetCode, options.assetId)
  context.state.commissionBaselineAssetCodesById.set(options.assetId, options.assetCode)
  return {
    ok: true,
    data: Object.freeze({
      assetId: options.assetId,
      assetCode: options.assetCode,
      sourceTime: context.state.preflightSourceTime,
    }),
  }
}

function createExternalOrderReconciliation({
  state,
  context,
  getHasCanonicalOwnershipReconciliation,
  logger,
} = {}) {
  let openOrdersSnapshotTask = Promise.resolve()
  const publishOrders = (options = {}) => {
    const task = openOrdersSnapshotTask.then(async () => {
      const pendingVersions = new Map(state.pendingExternalOrderVersions)
      const orders = await publishOpenOrdersSnapshot({
        context,
        options: {
          phase: options.phase === undefined ? "PREFLIGHT" : options.phase,
          ownershipReconciled: options.ownershipReconciled === undefined
            ? getHasCanonicalOwnershipReconciliation()
            : options.ownershipReconciled,
          orders: options.orders,
        },
      })
      for (const [symbol, version] of pendingVersions) {
        if (state.pendingExternalOrderVersions.get(symbol) === version) {
          state.pendingExternalOrderVersions.delete(symbol)
        }
      }
      return orders
    })
    openOrdersSnapshotTask = task.catch(() => undefined)
    return task
  }
  const observeExternalOrder = ({ symbol } = {}) => {
    if (typeof symbol !== "string" || !symbol.trim()) {
      return Promise.resolve(toResult({
        error: new TypeError("External-order observation requires a non-empty market symbol"),
      }))
    }
    const version = ++state.externalOrderObservationSequence
    state.pendingExternalOrderVersions.set(symbol, version)
    return publishOrders({ phase: "RECOVERY" }).then(
      () => toResult({
        data: {
          symbol,
          reconciled: true,
        },
      }),
      (error) => {
        try {
          logger.error?.({
            message: "authoritative open-orders reconciliation failed after an external order was observed",
            symbol,
            error,
            recoveryFailure: error?.recoveryFailure,
          })
        } catch {
          // A diagnostic logger failure must not release the provisional market blocker.
        }
        return toResult({ error })
      },
    )
  }
  return {
    publishOrders,
    observeExternalOrder,
  }
}

/**
 * Coordinate account-wide balance/open-order snapshots and their required durable audit events.
 *
 * This is a bootstrap lifecycle manager: it performs broker reads and enforces the
 * PREFLIGHT/RECOVERY account and open-order audit barriers, CLOSING account audit, and targeted COMMISSION_BASELINE publication.
 *
 * @param {object} options
 * @param {object} options.broker Broker port.
 * @param {object} options.eventPublisher Lifecycle event publisher with durable flush capability.
 * @param {Map<string, object>} options.marketMetadata Metadata for configured markets.
 * @param {Function} options.getPortfolio Current Portfolio accessor.
 * @param {Function} [options.getAdditionalTrackedBaseQuantity] Verified non-Portfolio Spot allocations by asset.
 * @param {Function} [options.getAdditionalTrackedQuoteCashFlow] Signed quote cash flow from tracked inventory outside Portfolio.
 * @param {Function} options.getTradingEngine Current trading-engine accessor.
 * @param {Function} options.getRecoveredState Current in-memory recovered-state accessor.
 * @param {Function} options.getHasCanonicalOwnershipReconciliation Ownership reconciliation predicate.
 * @param {object} options.logger Structured logger.
 * @param {object} [options.operationalStateStore] Optional initialized ADR-0001 Operational State Store.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @returns {object} Account snapshot read and durable audit operations.
 */
export function createAccountSnapshotManager({
  broker,
  eventPublisher,
  marketMetadata,
  getPortfolio,
  getAdditionalTrackedBaseQuantity = () => [],
  getAdditionalTrackedQuoteCashFlow = () => [],
  getTradingEngine,
  getRecoveredState,
  getHasCanonicalOwnershipReconciliation,
  logger,
  now = Date.now,
  monotonicNow = () => performance.now(),
  runtimeSessionId,
  operationalStateStore,
} = {}) {
  const additionalTrackedBaseQuantityGetter = resolveAdditionalTrackedBaseQuantityGetter({
    getter: getAdditionalTrackedBaseQuantity,
  })
  const additionalTrackedQuoteCashFlowGetter = resolveAdditionalTrackedQuoteCashFlowGetter({
    getter: getAdditionalTrackedQuoteCashFlow,
  })
  const state = createInitialAccountSnapshotManagerState()
  const context = {
    broker,
    eventPublisher,
    marketMetadata,
    getPortfolio,
    getAdditionalTrackedBaseQuantity: additionalTrackedBaseQuantityGetter,
    getAdditionalTrackedQuoteCashFlow: additionalTrackedQuoteCashFlowGetter,
    getTradingEngine,
    getRecoveredState,
    getHasCanonicalOwnershipReconciliation,
    logger,
    now,
    monotonicNow,
    runtimeSessionId,
    operationalStateStore,
    state,
  }
  const refresh = (options = {}) => refreshAccountSnapshot({
    context,
    ...options,
  })
  const { publishOrders, observeExternalOrder } = createExternalOrderReconciliation({
    state,
    context,
    getHasCanonicalOwnershipReconciliation,
    logger,
  })
  const publishSnapshot = (options = {}) => publishAccountSnapshot({
    context,
    options: {
      phase: options.phase,
      auditStatus: options.auditStatus === undefined ? "COMPLETE" : options.auditStatus,
      auditReasons: options.auditReasons === undefined ? [] : options.auditReasons,
      snapshot: options.snapshot,
      allowedAssetCodes: options.allowedAssetCodes,
    },
  })
  const publishCommissionBaseline = (options = {}) => publishCommissionAssetBaseline({
    context,
    options,
  })

  return Object.freeze({
    getAccountSnapshot: () => state.accountSnapshot,
    hasUnownedOpenOrdersForSymbol: ({ symbol } = {}) =>
      typeof symbol === "string" && (
        state.unownedOpenOrderSymbols.has(symbol) ||
        state.pendingExternalOrderVersions.has(symbol)
      ),
    observeExternalOrder,
    refreshAccountSnapshot: refresh,
    publishOpenOrdersSnapshot: publishOrders,
    publishAccountSnapshot: publishSnapshot,
    publishCommissionAssetBaseline: publishCommissionBaseline,
  })
}
