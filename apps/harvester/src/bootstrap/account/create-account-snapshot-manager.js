import { compareDecimal } from "@coinzilla/utils"
import { AccountSnapshot } from "../../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../../domain/account/assert-account-snapshot-covers-markets.js"
import { calculateAccountSnapshotBaselines } from "../../domain/account/calculate-account-snapshot-baselines.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
} from "../../application/events/lifecycle-event-dtos.js"

function withRecoveryFailure(error, category, stage, retryable) {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error })
  normalized.recoveryFailure = normalized.recoveryFailure ?? { category, stage, retryable }
  return normalized
}

function resolveAuditFlushFailure(flushed, stage) {
  const failure = flushed?.recoveryFailure
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_WRITE_FAILURE" && failure?.retryable === false) return failure
  if (failure?.category === "DURABILITY" && failure?.stage === "JOURNAL_FLUSH_FAILURE" && failure?.retryable === true) return failure
  return { category: "DURABILITY", stage: stage + "_UNCLASSIFIED", retryable: false }
}

function createAuditFlushError({ flushed, message, stage }) {
  const failure = resolveAuditFlushFailure(flushed, stage)
  const cause = flushed?.errors?.find?.((error) => error instanceof Error)
  const error = cause ? new Error(message, { cause }) : new Error(message)
  return withRecoveryFailure(error, failure.category, failure.stage, failure.retryable)
}

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

/**
 * Coordinate account-wide balance/open-order snapshots and their required durable audit events.
 *
 * This is a bootstrap lifecycle manager: it performs broker reads and enforces the
 * existing PREFLIGHT/OPENING/CLOSING publication and flush barriers.
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
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @returns {object} Account snapshot read and durable audit operations.
 */
export function createAccountSnapshotManager({
  broker, eventPublisher, marketMetadata, getPortfolio, getTradingEngine,
  getRecoveredState, getHasCanonicalOwnershipReconciliation, logger, now = Date.now,
} = {}) {
  let accountSnapshot

  const refreshAccountSnapshot = async () => {
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
        new Error("Unable to load canonical exchange account balances" + (details ? ": " + details : ""), { cause }),
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
    let nextSnapshot
    try {
      nextSnapshot = new AccountSnapshot({
        balances: result.data.balances,
        sourceTime: result.data.sourceTime,
        ...baselineResult.data,
      })
      assertAccountSnapshotCoversMarkets({ accountSnapshot: nextSnapshot, markets: accountAuditMarkets })
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
          new Error("Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""), { cause }),
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
          typeof symbol !== "string" || !symbol.trim()) return true
      const owned = restoredOrders.find((candidate) =>
        candidate.clientOrderId === clientOrderId ||
        (candidate.brokerOrderId !== undefined && candidate.brokerOrderId === brokerOrderId)
      )
      if (!owned || matchedOwnedClientIds.has(owned.clientOrderId)) return true
      if (owned.status === "CANCELED" || owned.status === "REJECTED") return true
      if (owned.brokerOrderId !== undefined && owned.brokerOrderId !== brokerOrderId) return true
      const actualPrice = order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
      const expectedPrice = owned.limitPrice?.amount
      const actualQuantity = order.originalQuantity?.amount ?? order.originalQuantity
      if (
        owned.clientOrderId !== clientOrderId ||
        owned.market.symbol !== symbol ||
        owned.side !== order.side ||
        owned.type !== order.type ||
        compareDecimal({ left: owned.originalQuantity.amount, right: actualQuantity }) !== 0 ||
        (expectedPrice === undefined
          ? actualPrice !== undefined
          : actualPrice === undefined || compareDecimal({ left: expectedPrice, right: String(actualPrice) }) !== 0)
      ) return true
      matchedOwnedClientIds.add(owned.clientOrderId)
      return false
    })
    const blockReasons = unownedOrders.length > 0
      ? ["UNOWNED_OPEN_ORDERS:" + unownedOrders.length]
      : orders.length > 0 && !ownershipReconciled
        ? ["CANONICAL_ORDER_RECONCILIATION_REQUIRED"]
        : []
    const readiness = blockReasons.length > 0
      ? "BLOCKED"
      : orders.length > 0
        ? "RECONCILED"
        : "READY"
    let dataResult
    try {
      dataResult = mapAccountOpenOrdersCapturedData({ phase, observedAt: now(), orders, readiness, blockReasons })
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
    const published = publishLifecycleEvent({ eventPublisher, eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED, dataResult })
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
    logger.info?.({
      message: readiness === "READY"
        ? "Account-wide open-orders audit complete; no open orders found"
        : readiness === "RECONCILED"
          ? "Account-wide open-orders audit complete; all open orders match restored Harvester ownership"
          : unownedOrders.length > 0
          ? "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched"
          : "Account-wide open-orders audit is waiting for canonical order reconciliation",
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
  } = {}) => {
    const snapshot = suppliedSnapshot ?? await refreshAccountSnapshot()
    let dataResult
    try {
      dataResult = mapAccountSnapshotCapturedData({ phase, snapshot, auditStatus, auditReasons })
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
    const published = publishLifecycleEvent({ eventPublisher, eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED, dataResult })
    if (!published?.ok) {
      throw withRecoveryFailure(
        new Error("Unable to publish " + phase + " account snapshot audit event"),
        "DURABILITY", "ACCOUNT_SNAPSHOT_AUDIT_PUBLICATION", true,
      )
    }
    if (typeof eventPublisher?.flush === "function") {
      let flushed
      try { flushed = await eventPublisher.flush() } catch (error) {
        throw withRecoveryFailure(error, "DURABILITY", "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_UNCLASSIFIED", false)
      }
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw createAuditFlushError({
          flushed,
          message: "Unable to durably persist " + phase + " account snapshot" + (details ? ": " + details : ""),
          stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH",
        })
      }
    } else {
      throw withRecoveryFailure(
        new Error("Harvester startup requires a durable Journal flush before market subscriptions"),
        "ACCOUNTING_INTEGRITY", "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_CAPABILITY", false,
      )
    }
    logSystem(logger, {
      message: "Account snapshot captured and durably journaled",
      phase, auditStatus, assetCount: snapshot.balances.length, sourceTime: snapshot.sourceTime, auditReasons,
    })
    return snapshot
  }

  return Object.freeze({
    getAccountSnapshot: () => accountSnapshot,
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishAccountSnapshot,
  })
}
