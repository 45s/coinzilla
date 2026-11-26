import { toResult } from "@coinzilla/utils"
import { createHarvesterReadinessReport } from "../../application/operator/create-harvester-readiness-report.js"
import { synchronizeAccountHistory } from "../../use-cases/synchronize-account-history/index.js"

const HISTORY_MARKET_FIELDS = Object.freeze([
  "marketsAttempted",
  "orderMarketsQueried",
  "fillMarketsQueried",
  "marketsQueried",
])

function sameStringSet(left, right) {
  return Array.isArray(left) &&
    [...left].sort().join("|") === [...right].sort().join("|")
}

function validateReconciliationDependencies(options) {
  const { broker, accountSnapshotManager, orderHistoryPersistence } = options
  if (typeof broker?.getAccountSnapshot !== "function" ||
      typeof broker?.getOpenOrders !== "function" ||
      typeof accountSnapshotManager?.refreshAccountSnapshot !== "function" ||
      typeof accountSnapshotManager?.publishAccountSnapshot !== "function" ||
      typeof accountSnapshotManager?.publishOpenOrdersSnapshot !== "function" ||
      typeof accountSnapshotManager?.getReadinessSnapshot !== "function" ||
      typeof options.getRuntimeSnapshot !== "function" ||
      typeof options.getMarketSnapshots !== "function" ||
      typeof options.getPortfolio !== "function" ||
      !orderHistoryPersistence?.orderRepository ||
      !orderHistoryPersistence?.fillRepository ||
      !orderHistoryPersistence?.historySyncCursorRepository) {
    throw new TypeError("Account blocker reconciliation requires broker, durable history, account audit and readiness ports")
  }
}

function validateConfiguredMarkets({ configuredMarkets, marketMetadata }) {
  if (!Array.isArray(configuredMarkets) ||
      configuredMarkets.length === 0 ||
      configuredMarkets.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
      new Set(configuredMarkets).size !== configuredMarkets.length ||
      !(marketMetadata instanceof Map)) {
    throw new TypeError("Account blocker reconciliation requires the unique configured market universe")
  }
  const assetCodes = new Set()
  for (const symbol of configuredMarkets) {
    const market = marketMetadata.get(symbol)?.market
    if (!market || market.symbol !== symbol) {
      throw new Error(`Authoritative market metadata is missing for ${symbol}`)
    }
    assetCodes.add(market.baseAsset.code)
    assetCodes.add(market.quoteAsset.code)
  }
  return [...assetCodes].sort()
}

function validateHistoryCoverage({ diagnostics, configuredMarkets }) {
  if (diagnostics?.historyScope !== "CONFIGURED_MARKETS" ||
      diagnostics.historyPagesComplete !== true ||
      diagnostics.marketHistoryPagesComplete !== true ||
      diagnostics.failureCount !== 0 ||
      !sameStringSet(diagnostics.marketsQueried, configuredMarkets) ||
      !sameStringSet(diagnostics.orderMarketsQueried, configuredMarkets) ||
      !sameStringSet(diagnostics.fillMarketsQueried, configuredMarkets) ||
      !sameStringSet(diagnostics.marketsAttempted, configuredMarkets) ||
      !Array.isArray(diagnostics.marketsFailed) ||
      diagnostics.marketsFailed.length !== 0) {
    throw new Error("Exchange order/fill history did not complete for every configured market")
  }
}

function validateFreshAccountSnapshot({ snapshot, now, maxAgeMs }) {
  if (!snapshot ||
      !Array.isArray(snapshot.balances) ||
      !Number.isSafeInteger(snapshot.sourceTime) ||
      snapshot.sourceTime > now ||
      now - snapshot.sourceTime > maxAgeMs) {
    throw new Error("Authoritative account balance snapshot is missing or stale")
  }
}

function validateOpenOrdersAudit({ accountSnapshotManager }) {
  const readiness = accountSnapshotManager.getReadinessSnapshot()?.openOrders
  if (readiness?.completed !== true ||
      readiness?.durable !== true ||
      readiness?.readiness !== "READY" ||
      !Array.isArray(readiness.unownedSymbols) ||
      readiness.unownedSymbols.length !== 0 ||
      !Array.isArray(readiness.blockReasons) ||
      readiness.blockReasons.length !== 0) {
    throw new Error("Account-wide open-order audit is incomplete, non-durable, or contains unresolved orders")
  }
}

function getReadinessMarkets({ marketResult, configuredMarkets }) {
  if (marketResult?.ok !== true || !Array.isArray(marketResult.data?.markets)) {
    throw marketResult?.errors?.[0] ?? new Error("Trading engine market readiness snapshot is unavailable")
  }
  const markets = marketResult.data.markets
  if (!sameStringSet(markets.map(({ symbol }) => symbol), configuredMarkets)) {
    throw new Error("Trading engine readiness snapshot does not cover the exact configured market universe")
  }
  return markets
}

function validateReadinessReport({ report, blockerIds, configuredMarkets }) {
  const allowedRuntimeBlockers = new Set(["account.safety-blocker", "user-data.reconciliation"])
  const blockedChecks = report.checks.filter(({ status }) => status === "BLOCKED")
  for (const check of blockedChecks) {
    if (!allowedRuntimeBlockers.has(check.id)) {
      throw new Error(`Independent readiness audit found an additional blocker: ${check.id} (${check.code})`)
    }
    if (check.id === "account.safety-blocker" &&
        (check.details?.scope !== "ACCOUNT" || !blockerIds.includes(check.details?.blockerId))) {
      throw new Error("Readiness account blocker does not match the exact active user-data blocker set")
    }
    if (check.id === "user-data.reconciliation" &&
        check.details?.accountingFailed !== true &&
        check.details?.safetyHaltRequired !== true) {
      throw new Error("User-data readiness is blocked for a reason outside the targeted account blocker")
    }
  }
  const allowedMarketBlockers = new Set(["USER_DATA_NOT_READY"])
  for (const check of blockedChecks) {
    if (check.id === "account.safety-blocker") {
      allowedMarketBlockers.add(check.code)
    }
  }
  for (const market of report.markets) {
    if (!configuredMarkets.includes(market.symbol) ||
        market.blockers.some((code) => !allowedMarketBlockers.has(code))) {
      throw new Error(`Independent readiness audit found an additional market blocker for ${market.symbol}`)
    }
  }
}

function createAccountAudit({ blockerIds, configuredMarkets, operatorId, actionId, capturedAt }) {
  return {
    status: "READY",
    scope: "ACCOUNT",
    source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
    allConfiguredMarketsAudited: true,
    auditedMarkets: [...configuredMarkets],
    openOrdersReconciled: true,
    fillsReconciled: true,
    balancesReconciled: true,
    accountingConsistent: true,
    unresolvedOwnedOrders: 0,
    unresolvedOwnedFills: 0,
    unresolvedExternalOrders: 0,
    balanceDiscrepancies: 0,
    blockerIds: [...blockerIds],
    blockerOrigins: blockerIds.map((blockerId) => ({
      blockerId,
      producer: "USER_DATA_EVENT_HANDLER",
    })),
    reconciliationId: `account-resolution:${operatorId}:${actionId}`,
    capturedAt: new Date(capturedAt).toISOString(),
  }
}

/**
 * Compose the production, read-only exchange reconciliation used before
 * recording an operator resolution. This performs broker reads and durable
 * local audit/history writes only; it never submits, cancels or replaces orders.
 */
export function createAuthoritativeAccountBlockerReconciliation(options = {}) {
  validateReconciliationDependencies(options)
  const configuredMarkets = [...options.configuredMarkets]
  const allowedAssetCodes = validateConfiguredMarkets({
    configuredMarkets,
    marketMetadata: options.marketMetadata,
  })
  const maxSnapshotAgeMs = options.maxSnapshotAgeMs ?? 120_000
  const now = options.now ?? Date.now

  return async ({ blockerIds, operatorId, actionId } = {}) => {
    try {
      if (!sameStringSet(blockerIds, blockerIds) ||
          blockerIds.length === 0 ||
          typeof operatorId !== "string" ||
          typeof actionId !== "string") {
        throw new TypeError("Account blocker reconciliation requires exact blocker IDs and operator action identity")
      }
      const historyResult = await synchronizeAccountHistory({
        broker: options.broker,
        symbols: configuredMarkets,
        providerIdentity: options.providerIdentity,
        environment: options.environment,
        ...options.orderHistoryPersistence,
        now,
      })
      if (historyResult?.ok !== true) {
        return historyResult
      }
      validateHistoryCoverage({
        diagnostics: historyResult.data,
        configuredMarkets,
      })

      const snapshot = await options.accountSnapshotManager.refreshAccountSnapshot()
      const capturedAt = now()
      validateFreshAccountSnapshot({
        snapshot,
        now: capturedAt,
        maxAgeMs: maxSnapshotAgeMs,
      })
      await options.accountSnapshotManager.publishAccountSnapshot({
        phase: "RUNTIME",
        auditStatus: "COMPLETE",
        auditReasons: [],
        snapshot,
        allowedAssetCodes,
      })
      await options.accountSnapshotManager.publishOpenOrdersSnapshot({
        phase: "RUNTIME",
        ownershipReconciled: options.hasCanonicalOwnershipReconciliation() === true,
      })
      validateOpenOrdersAudit({
        accountSnapshotManager: options.accountSnapshotManager,
      })

      const runtime = options.getRuntimeSnapshot()
      const marketResult = await options.getMarketSnapshots()
      const markets = getReadinessMarkets({
        marketResult,
        configuredMarkets,
      })
      const report = createHarvesterReadinessReport({
        runtime,
        markets,
        readinessInputs: runtime.readinessInputs,
        observedAt: capturedAt,
      })
      validateReadinessReport({
        report,
        blockerIds,
        configuredMarkets,
      })
      return toResult({
        data: createAccountAudit({
          blockerIds,
          configuredMarkets,
          operatorId,
          actionId,
          capturedAt,
        }),
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}
