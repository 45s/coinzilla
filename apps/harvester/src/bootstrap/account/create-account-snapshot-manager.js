import { performance } from "node:perf_hooks"
import { compareDecimal } from "@coinzilla/utils"
import { AccountSnapshot } from "../../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../../domain/account/assert-account-snapshot-covers-markets.js"
import { calculateAccountSnapshotBaselines } from "../../domain/account/calculate-account-snapshot-baselines.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { isHarvesterClientOrderId } from "../../application/orders/is-harvester-client-order-id.js"
import {
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
} from "../../application/events/lifecycle-event-dtos.js"
import { recordAccountSnapshotCaptured, recordAccountOpenOrdersCaptured } from "../../use-cases/record-account-reconciliation-facts.js"

function withRecoveryFailure(error, category, stage, retryable) {
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

function resolveAuditFlushFailure(flushed, stage) {
  const failure = flushed?.recoveryFailure
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_WRITE_FAILURE" && failure?.retryable === false) { return failure }
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_FLUSH_FAILURE" && failure?.retryable === true) { return failure }
  return {
    category: "DURABILITY",
    stage: stage + "_UNCLASSIFIED",
    retryable: false,
  }
}

function createAuditFlushError({
  flushed,
  message,
  stage,
}) {
  const failure = resolveAuditFlushFailure(flushed, stage)
  const cause = flushed?.errors?.find?.((error) => error instanceof Error)
  const error = cause ? new Error(message, {
    cause,
  }) : new Error(message)
  return withRecoveryFailure(error, failure.category, failure.stage, failure.retryable)
}

function logSystem(logger, data) {
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
    throw withRecoveryFailure(error, "ACCOUNTING_INTEGRITY", "ACCOUNT_SNAPSHOT_AUDIT_PAYLOAD", false)
  }
  if (!dataResult?.ok) {
    throw withRecoveryFailure(
      dataResult?.errors?.[0] ?? new Error("Account snapshot audit payload is invalid"),
      "ACCOUNTING_INTEGRITY",
      "ACCOUNT_SNAPSHOT_AUDIT_PAYLOAD",
      false,
    )
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
    throw withRecoveryFailure(
      new Error("Unable to durably persist account snapshot: " + (cause.message ?? String(cause)), {
        cause,
      }),
      "DURABILITY",
      "ACCOUNT_SNAPSHOT_DURABLE_FACT",
      false,
    )
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
  logSystem(logger, {
    message: "Harvester shutdown phase " + phaseStatus.toLowerCase(),
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
    logSystem(logger, {
      message: "Harvester shutdown phase failed",
      shutdownPhase: "JOURNAL_DURABILITY_BARRIER",
      phaseStatus: "FAILED",
      phase: "CLOSING",
      shutdownCorrelationId: runtimeSessionId ?? null,
      failureReason: "JOURNAL_FLUSH_CAPABILITY_MISSING",
    })
  }
  throw withRecoveryFailure(
    new Error("Harvester startup requires a durable Journal flush before market subscriptions"),
    "ACCOUNTING_INTEGRITY",
    "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_CAPABILITY",
    false,
  )
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
  throw withRecoveryFailure(error, "DURABILITY", "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_UNCLASSIFIED", false)
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
    message: "Unable to durably persist " + phase + " account snapshot" + (details ? ": " + details : ""),
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
    throwMissingAccountSnapshotFlushCapability({ phase, logger, runtimeSessionId })
  }

  const startedAt = monotonicNow()
  const isClosing = phase === "CLOSING"
  if (isClosing) {
    logSystem(logger, {
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
  getTradingEngine,
  getRecoveredState,
  getHasCanonicalOwnershipReconciliation,
  logger,
  now = Date.now,
  monotonicNow = () => performance.now(),
  runtimeSessionId,
  operationalStateStore,
} = {}) {
  let accountSnapshot
  let preflightSourceTime
  let preflightBalancesByCode = new Map()
  const commissionBaselineAssetIds = new Map()
  // Updated only after the corresponding account-wide open-orders audit is durable.
  let unownedOpenOrderSymbols = new Set()
  let unresolvedHarvesterOpenOrderSymbols = new Set()
  const commissionBaselineAssetCodesById = new Map()

  const refreshAccountSnapshot = async ({ capturePreflightBaseline = false } = {}) => {
    let result
    try {
      result = await broker.getAccountSnapshot()
    } catch (error) {
      throw withRecoveryFailure(error, "ACCOUNTING_INTEGRITY", "ACCOUNT_SNAPSHOT_READ_EXCEPTION", false)
    }
    if (result?.ok !== false && result?.ok !== true) {
      throw withRecoveryFailure(
        new Error("Canonical exchange account snapshot response is missing an explicit success flag"),
        "ACCOUNTING_INTEGRITY", "ACCOUNT_SNAPSHOT_RESPONSE", false,
      )
    }
    if (result.ok === false) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      const cause = result?.errors?.find?.((error) => error instanceof Error)
      throw withRecoveryFailure(
        new Error("Unable to load canonical exchange account balances" + (details ? ": " + details : ""), {
          cause,
        }),
        "REST_RECONCILIATION",
        "ACCOUNT_SNAPSHOT_READ",
        true,
      )
    }
    if (!result.data || !Array.isArray(result.data.balances)) {
      throw withRecoveryFailure(
        new Error("Canonical exchange account snapshot is malformed: balances must be an array"),
        "ACCOUNTING_INTEGRITY",
        "ACCOUNT_SNAPSHOT_SHAPE",
        false,
      )
    }
    const activeOrders = getTradingEngine()?.getActiveOrders?.() ??
      getRecoveredState()?.orderRegistry?.getActiveOrders?.() ?? []
    const baselineResult = calculateAccountSnapshotBaselines({
      portfolio: getPortfolio(),
      activeOrders,
    })
    if (!baselineResult.ok) {
      throw withRecoveryFailure(
        baselineResult.errors?.[0] ?? new Error("Unable to capture account snapshot accounting baselines"),
        "ACCOUNTING_INTEGRITY",
        "ACCOUNT_SNAPSHOT_BASELINE",
        false,
      )
    }
    const accountAuditMarkets = [...marketMetadata.values()].map(({ market }) => market)
    const configuredAssetCodes = new Set(accountAuditMarkets.flatMap((market) => [
      market.baseAsset.code,
      market.quoteAsset.code,
    ]))
    let nextSnapshot
    try {
      if (capturePreflightBaseline && preflightSourceTime === undefined) {
        const sourceSnapshot = new AccountSnapshot({
          balances: result.data.balances,
          sourceTime: result.data.sourceTime,
        })
        preflightSourceTime = sourceSnapshot.sourceTime
        preflightBalancesByCode = new Map(sourceSnapshot.balances.map((balance) => [
          balance.asset.code,
          balance,
        ]))
      }
      const trackedAssetCodes = new Set([
        ...configuredAssetCodes,
        ...commissionBaselineAssetIds.keys(),
      ])
      const trackedBalances = result.data.balances.filter((balance) =>
        trackedAssetCodes.has(balance?.asset?.code))
      nextSnapshot = new AccountSnapshot({
        balances: trackedBalances,
        sourceTime: result.data.sourceTime,
        ...baselineResult.data,
      })
      assertAccountSnapshotCoversMarkets({
        accountSnapshot: nextSnapshot,
        markets: accountAuditMarkets,
      })
      if (accountSnapshot && nextSnapshot.sourceTime < accountSnapshot.sourceTime) {
        throw new Error("Exchange account snapshot is older than the previously accepted snapshot")
      }
    } catch (error) {
      throw withRecoveryFailure(error, "ACCOUNTING_INTEGRITY", "ACCOUNT_SNAPSHOT_VALIDATION", false)
    }
    accountSnapshot = nextSnapshot
    logSystem(logger, {
      message: "Exchange account snapshot loaded",
      balanceCount: nextSnapshot.balances.length,
      sourceTime: nextSnapshot.sourceTime,
    })

    return nextSnapshot
  }

  const publishOpenOrdersSnapshot = async ({
    phase = "PREFLIGHT",
    ownershipReconciled = getHasCanonicalOwnershipReconciliation(),
    orders: suppliedOrders,
  } = {}) => {
    let orders = suppliedOrders
    if (orders === undefined) {
      let result
      try { result = await broker.getOpenOrders({}) } catch (error) {
        throw withRecoveryFailure(error, "ACCOUNTING_INTEGRITY", "ACCOUNT_WIDE_OPEN_ORDERS_READ_EXCEPTION", false)
      }
      if (result?.ok !== false && result?.ok !== true) {
        throw withRecoveryFailure(
          new Error("Account-wide open-orders response is missing an explicit success flag"),
          "ACCOUNTING_INTEGRITY", "ACCOUNT_WIDE_OPEN_ORDERS_RESPONSE", false,
        )
      }
      if (result.ok === false) {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        const cause = result?.errors?.find?.((error) => error instanceof Error)
        throw withRecoveryFailure(
          new Error("Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""), {
            cause,
          }),
          "REST_RECONCILIATION", "ACCOUNT_WIDE_OPEN_ORDERS_READ", true,
        )
      }
      if (!Array.isArray(result.data)) {
        throw withRecoveryFailure(new TypeError("Account-wide open-orders response must be an array"),
          "ACCOUNTING_INTEGRITY", "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT", false)
      }
      orders = result.data
    }
    if (!Array.isArray(orders)) {
      throw withRecoveryFailure(new TypeError("publishOpenOrdersSnapshot orders must be an array"),
        "ACCOUNTING_INTEGRITY", "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT", false)
    }
    const restoredOrders = getTradingEngine()?.getOrders?.() ?? getRecoveredState()?.orderRegistry?.orders ?? []
    const matchedOwnedClientIds = new Set()
    const unownedOrders = orders.filter((order) => {
      const clientOrderId = order?.clientOrderId
      const brokerOrderId = order?.brokerOrderId ?? order?.id
      const symbol = order?.market?.symbol ?? order?.symbol
      if (typeof clientOrderId !== "string" || !clientOrderId.trim() ||
          typeof brokerOrderId !== "string" || !brokerOrderId.trim() ||
          typeof symbol !== "string" || !symbol.trim()) { return true }
      const owned = restoredOrders.find((candidate) =>
        candidate.clientOrderId === clientOrderId ||
        (candidate.brokerOrderId !== undefined && candidate.brokerOrderId === brokerOrderId)
      )
      if (!owned || matchedOwnedClientIds.has(owned.clientOrderId)) { return true }
      if (owned.status === "CANCELED" || owned.status === "REJECTED") { return true }
      if (owned.brokerOrderId !== undefined && owned.brokerOrderId !== brokerOrderId) { return true }
      const actualPrice = order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
      const expectedPrice = owned.limitPrice?.amount
      const actualQuantity = order.originalQuantity?.amount ?? order.originalQuantity
      if (
        owned.clientOrderId !== clientOrderId ||
        owned.market.symbol !== symbol ||
        owned.side !== order.side ||
        owned.type !== order.type ||
        compareDecimal({
          left: owned.originalQuantity.amount,
          right: actualQuantity,
        }) !== 0 ||
        (expectedPrice === undefined
          ? actualPrice !== undefined
          : actualPrice === undefined || compareDecimal({
              left: expectedPrice,
              right: String(actualPrice),
            }) !== 0)
      ) { return true }
      matchedOwnedClientIds.add(owned.clientOrderId)
      return false
    })
    const blockReasons = []
    if (unownedOrders.length > 0) {
      blockReasons.push("UNOWNED_OPEN_ORDERS:" + unownedOrders.length)
    } else if (orders.length > 0 && !ownershipReconciled) {
      blockReasons.push("CANONICAL_ORDER_RECONCILIATION_REQUIRED")
    }
    let readiness = "READY"
    if (blockReasons.length > 0) {
      readiness = "BLOCKED"
    } else if (orders.length > 0) {
      readiness = "RECONCILED"
    }
    let dataResult
    try {
      dataResult = mapAccountOpenOrdersCapturedData({
        phase,
        observedAt: now(),
        orders,
        readiness,
        blockReasons,
      })
    } catch (error) {
      throw withRecoveryFailure(error, "ACCOUNTING_INTEGRITY", "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD", false)
    }
    if (!dataResult?.ok) {
      throw withRecoveryFailure(
        dataResult?.errors?.[0] ?? new Error("Account open-orders audit payload is invalid"),
        "ACCOUNTING_INTEGRITY",
        "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD",
        false,
      )
    }
    if (operationalStateStore) {
      const durable = await recordAccountOpenOrdersCaptured({
        operationalStateStore,
        data: dataResult.data,
      })
      if (durable?.ok !== true || durable.data?.durable !== true) {
        const cause = durable?.errors?.[0] ?? new Error("Account open-orders durable fact was not committed")
        throw withRecoveryFailure(new Error("Unable to durably persist account open-orders snapshot: " + (cause.message ?? String(cause)), {
          cause,
        }), "DURABILITY", "ACCOUNT_OPEN_ORDERS_DURABLE_FACT", false)
      }
    }
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
      dataResult,
    })
    if (!published?.ok) {
      const details = published?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw withRecoveryFailure(
        new Error("Unable to publish account open-orders audit event" + (details ? ": " + details : "")),
        "DURABILITY", "ACCOUNT_OPEN_ORDERS_AUDIT_PUBLICATION", true,
      )
    }
    if (typeof eventPublisher?.flush === "function") {
      let flushed
      try { flushed = await eventPublisher.flush() } catch (error) {
        throw withRecoveryFailure(error, "DURABILITY", "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH_UNCLASSIFIED", false)
      }
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw createAuditFlushError({
          flushed,
          message: "Unable to durably persist account open-orders audit" + (details ? ": " + details : ""),
          stage: "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH",
        })
      }
    } else {
      throw withRecoveryFailure(
        new Error("Harvester startup requires a durable open-orders audit before market subscriptions"),
        "ACCOUNTING_INTEGRITY", "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH_CAPABILITY", false,
      )
    }
    // Strategy guards change only after the audit has passed its durable Journal barrier.
    // Manual/external IDs obey the per-pair policy; prior-process Harvester orders remain blocked.
    const externalOrders = unownedOrders.filter((order) =>
      typeof order?.clientOrderId === "string" &&
      order.clientOrderId.trim().length > 0 &&
      !isHarvesterClientOrderId(order.clientOrderId))
    const unresolvedHarvesterOrders = unownedOrders.filter((order) =>
      typeof order?.clientOrderId !== "string" ||
      !order.clientOrderId.trim() ||
      isHarvesterClientOrderId(order.clientOrderId))
    unownedOpenOrderSymbols = new Set(externalOrders
      .map((order) => order?.market?.symbol ?? order?.symbol)
      .filter((symbol) => typeof symbol === "string" && symbol.trim().length > 0))
    unresolvedHarvesterOpenOrderSymbols = new Set(unresolvedHarvesterOrders
      .map((order) => order?.market?.symbol ?? order?.symbol)
      .filter((symbol) => typeof symbol === "string" && symbol.trim().length > 0))
    let auditMessage = "Account-wide open-orders audit is waiting for canonical order reconciliation"
    if (readiness === "READY") {
      auditMessage = "Account-wide open-orders audit complete; no open orders found"
    } else if (readiness === "RECONCILED") {
      auditMessage = "Account-wide open-orders audit complete; all open orders match restored Harvester ownership"
    } else if (unownedOrders.length > 0) {
      auditMessage = "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched"
    }
    logger.info?.({
      message: auditMessage,
      orderCount: orders.length,
      readiness,
      symbols: [...new Set(orders.map((order) => order.market?.symbol ?? order.symbol).filter(Boolean))],
    })
    return orders
  }

  const publishAccountSnapshot = async ({
    phase,
    auditStatus = "COMPLETE",
    auditReasons = [],
    snapshot: suppliedSnapshot,
    allowedAssetCodes: suppliedAllowedAssetCodes,
  } = {}) => {
    const snapshot = suppliedSnapshot ?? await refreshAccountSnapshot({
      capturePreflightBaseline: phase === "PREFLIGHT",
    })
    const configuredAssetCodes = [...new Set([...marketMetadata.values()]
      .flatMap(({ market }) => [
        market.baseAsset.code,
        market.quoteAsset.code,
      ]))]
    const allowedAssetCodes = suppliedAllowedAssetCodes ?? [...new Set([
      ...configuredAssetCodes,
      ...commissionBaselineAssetIds.keys(),
    ])]
    const dataResult = createAccountSnapshotAuditPayload({
      phase,
      snapshot,
      allowedAssetCodes,
      auditStatus,
      auditReasons,
    })
    await persistAccountSnapshotAudit({
      operationalStateStore,
      data: dataResult.data,
    })
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
      dataResult,
    })
    if (!published?.ok) {
      throw withRecoveryFailure(
        new Error("Unable to publish " + phase + " account snapshot audit event"),
        "DURABILITY",
        "ACCOUNT_SNAPSHOT_AUDIT_PUBLICATION",
        true,
      )
    }
    await flushAccountSnapshotAudit({
      eventPublisher,
      phase,
      logger,
      runtimeSessionId,
      monotonicNow,
    })
    logSystem(logger, {
      message: "Account snapshot captured and durably journaled",
      phase,
      auditStatus,
      assetCount: snapshot.balances.length,
      sourceTime: snapshot.sourceTime,
      auditReasons,
    })
    return snapshot
  }

  const publishCommissionAssetBaseline = async ({
    assetId,
    assetCode,
  } = {}) => {
    if (typeof assetId !== "string" || !assetId.trim() ||
        typeof assetCode !== "string" || !assetCode.trim()) {
      throw withRecoveryFailure(
        new TypeError("Commission asset baseline requires assetId and assetCode"),
        "ACCOUNTING_INTEGRITY",
        "COMMISSION_ASSET_BASELINE_IDENTITY",
        false,
      )
    }

    const configuredAssets = [...marketMetadata.values()].flatMap(({ market }) => [
      market.baseAsset,
      market.quoteAsset,
    ])
    const configuredAsset = configuredAssets.find((asset) =>
      asset.id === assetId || asset.code === assetCode)
    if (configuredAsset) {
      if (configuredAsset.id !== assetId || configuredAsset.code !== assetCode) {
        throw withRecoveryFailure(
          new Error("Commission asset identity contradicts configured market metadata for " + assetCode),
          "ACCOUNTING_INTEGRITY",
          "COMMISSION_ASSET_BASELINE_IDENTITY",
          false,
        )
      }
      return {
        ok: true,
        data: Object.freeze({
          skipped: true,
          reason: "CONFIGURED_MARKET_ASSET",
        }),
      }
    }

    const knownAssetId = commissionBaselineAssetIds.get(assetCode)
    const knownAssetCode = commissionBaselineAssetCodesById.get(assetId)
    if (knownAssetId !== undefined || knownAssetCode !== undefined) {
      if (knownAssetId !== assetId || knownAssetCode !== assetCode) {
        throw withRecoveryFailure(
          new Error("Commission asset ID/code mapping is contradictory for " + assetCode),
          "ACCOUNTING_INTEGRITY",
          "COMMISSION_ASSET_BASELINE_IDENTITY",
          false,
        )
      }
      return {
        ok: true,
        data: Object.freeze({
          skipped: true,
          reason: "BASELINE_ALREADY_CAPTURED",
        }),
      }
    }

    if (preflightSourceTime === undefined) {
      throw withRecoveryFailure(
        new Error("Commission asset baseline cannot be captured before the durable PREFLIGHT snapshot"),
        "ACCOUNTING_INTEGRITY",
        "COMMISSION_ASSET_PREFLIGHT_MISSING",
        false,
      )
    }
    const balance = preflightBalancesByCode.get(assetCode)
    if (!balance) {
      throw withRecoveryFailure(
        new Error("PREFLIGHT account snapshot is missing commission asset " + assetCode),
        "ACCOUNTING_INTEGRITY",
        "COMMISSION_ASSET_PREFLIGHT_BALANCE_MISSING",
        false,
      )
    }
    if (balance.asset.id !== assetId || balance.asset.code !== assetCode) {
      throw withRecoveryFailure(
        new Error(`PREFLIGHT commission asset balance identity contradicts the applied fill for ${assetCode}`),
        "ACCOUNTING_INTEGRITY",
        "COMMISSION_ASSET_PREFLIGHT_BALANCE_IDENTITY",
        false,
      )
    }

    const baselineSnapshot = new AccountSnapshot({
      sourceTime: preflightSourceTime,
      balances: [balance],
    })
    await publishAccountSnapshot({
      phase: "COMMISSION_BASELINE",
      snapshot: baselineSnapshot,
      allowedAssetCodes: [assetCode],
    })
    commissionBaselineAssetIds.set(assetCode, assetId)
    commissionBaselineAssetCodesById.set(assetId, assetCode)
    return {
      ok: true,
      data: Object.freeze({
        assetId,
        assetCode,
        sourceTime: preflightSourceTime,
      }),
    }
  }

  return Object.freeze({
    getAccountSnapshot: () => accountSnapshot,
    hasUnownedOpenOrdersForSymbol: ({ symbol } = {}) =>
      typeof symbol === "string" && unownedOpenOrderSymbols.has(symbol),
    hasUnresolvedHarvesterOpenOrdersForSymbol: ({ symbol } = {}) =>
      typeof symbol === "string" && unresolvedHarvesterOpenOrderSymbols.has(symbol),
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishAccountSnapshot,
    publishCommissionAssetBaseline,
  })
}
