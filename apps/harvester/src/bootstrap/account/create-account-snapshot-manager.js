import { addDecimal, compareDecimal } from "@coinzilla/utils"
import { AccountSnapshot } from "../../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../../domain/account/assert-account-snapshot-covers-markets.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
} from "../../application/events/lifecycle-event-dtos.js"

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
    const result = await broker.getAccountSnapshot()
    if (!result?.ok || !result.data || !Array.isArray(result.data.balances)) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      const cause = result?.errors?.find?.((error) => error instanceof Error)
      throw new Error(
        "Unable to load canonical exchange account balances" + (details ? ": " + details : ""),
        { cause },
      )
    }
    const quoteCashFlowBaselineByAssetId = new Map()
    for (const position of getPortfolio().positions) {
      const assetId = position.market.quoteAsset.id
      quoteCashFlowBaselineByAssetId.set(
        assetId,
        addDecimal({
          left: quoteCashFlowBaselineByAssetId.get(assetId) ?? "0",
          right: position.quoteNetCashFlow.amount,
        }),
      )
    }
    const accountAuditMarkets = [...marketMetadata.values()].map(({ market }) => market)
    const configuredAssetCodes = new Set(accountAuditMarkets.flatMap((market) => [
      market.baseAsset.code,
      market.quoteAsset.code,
    ]))
    const configuredBalances = result.data.balances.filter((balance) =>
      configuredAssetCodes.has(balance?.asset?.code))
    const nextSnapshot = new AccountSnapshot({
      balances: configuredBalances,
      sourceTime: result.data.sourceTime,
      quoteCashFlowBaseline: [...quoteCashFlowBaselineByAssetId].map(([assetId, amount]) => ({
        assetId,
        amount,
      })),
    })
    assertAccountSnapshotCoversMarkets({
      accountSnapshot: nextSnapshot,
      markets: accountAuditMarkets,
    })
    if (accountSnapshot && nextSnapshot.sourceTime < accountSnapshot.sourceTime) {
      throw new Error("Exchange account snapshot is older than the previously accepted snapshot")
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
      const result = await broker.getOpenOrders({})
      if (!result?.ok || !Array.isArray(result.data)) {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        const cause = result?.errors?.find?.((error) => error instanceof Error)
        throw new Error(
          "Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""),
          { cause },
        )
      }
      orders = result.data
    }
    if (!Array.isArray(orders)) throw new TypeError("publishOpenOrdersSnapshot orders must be an array")
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
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
      dataResult: mapAccountOpenOrdersCapturedData({
        phase,
        observedAt: now(),
        orders,
        readiness,
        blockReasons,
      }),
    })
    if (!published?.ok) {
      const details = published?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error("Unable to publish account open-orders audit event" + (details ? ": " + details : ""))
    }
    if (typeof eventPublisher?.flush === "function") {
      const flushed = await eventPublisher.flush()
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Unable to durably persist account open-orders audit" + (details ? ": " + details : ""))
      }
    } else {
      throw new Error("Harvester startup requires a durable open-orders audit before market subscriptions")
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
    const configuredAssetCodes = [...new Set([...marketMetadata.values()]
      .flatMap(({ market }) => [market.baseAsset.code, market.quoteAsset.code]))]
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
      dataResult: mapAccountSnapshotCapturedData({
        phase,
        snapshot,
        allowedAssetCodes: configuredAssetCodes,
        auditStatus,
        auditReasons,
      }),
    })
    if (!published?.ok) throw new Error("Unable to publish " + phase + " account snapshot audit event")
    if (typeof eventPublisher?.flush === "function") {
      const flushed = await eventPublisher.flush()
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Unable to durably persist " + phase + " account snapshot" + (details ? ": " + details : ""))
      }
    } else {
      throw new Error("Harvester startup requires a durable Journal flush before market subscriptions")
    }
    logSystem(logger, {
      message: "Account snapshot captured and durably journaled",
      phase, auditStatus, assetCount: configuredAssetCodes.length, sourceAssetCount: snapshot.balances.length, sourceTime: snapshot.sourceTime, auditReasons,
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
