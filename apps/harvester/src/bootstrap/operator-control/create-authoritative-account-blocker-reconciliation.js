import { toResult } from "@coinzilla/utils"
import { createHarvesterReadinessReport } from "../../application/operator/create-harvester-readiness-report.js"
import { projectHarvesterOperationalState } from "../../infrastructure/operational-state/project-harvester.js"
import { synchronizeAccountHistory } from "../../use-cases/synchronize-account-history/index.js"

function sameStringSet(left, right) {
  return Array.isArray(left) &&
    [...left].sort().join("|") === [...right].sort().join("|")
}

function validateDependencies(options) {
  const { broker, accountSnapshotManager, operationalStateStore, orderHistoryPersistence } = options
  if (typeof broker?.getAccountSnapshot !== "function" ||
      typeof broker?.getOpenOrders !== "function" ||
      typeof accountSnapshotManager?.refreshAccountSnapshot !== "function" ||
      typeof accountSnapshotManager?.publishAccountSnapshot !== "function" ||
      typeof accountSnapshotManager?.publishOpenOrdersSnapshot !== "function" ||
      typeof accountSnapshotManager?.getReadinessSnapshot !== "function" ||
      typeof operationalStateStore?.readAll !== "function" ||
      typeof options.getRuntimeSnapshot !== "function" ||
      typeof options.getMarketSnapshots !== "function" ||
      typeof options.hasCanonicalOwnershipReconciliation !== "function" ||
      typeof options.getPortfolio !== "function" ||
      !orderHistoryPersistence?.orderRepository ||
      !orderHistoryPersistence?.fillRepository ||
      !orderHistoryPersistence?.historySyncCursorRepository) {
    throw new TypeError("Account blocker reconciliation requires authoritative broker, store, history and readiness ports")
  }
}

function resolveConfiguredAssetCodes({ configuredMarkets, marketMetadata }) {
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

async function synchronizeConfiguredMarketHistory(options) {
  const result = await synchronizeAccountHistory({
    broker: options.broker,
    symbols: options.configuredMarkets,
    providerIdentity: options.providerIdentity,
    environment: options.environment,
    ...options.orderHistoryPersistence,
    now: options.now,
  })
  if (result?.ok !== true) {
    return result
  }
  validateHistoryCoverage({
    diagnostics: result.data,
    configuredMarkets: options.configuredMarkets,
  })
  return undefined
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

async function captureDurableAccountSnapshot(options) {
  const snapshot = await options.accountSnapshotManager.refreshAccountSnapshot()
  const capturedAt = options.now()
  validateFreshAccountSnapshot({
    snapshot,
    now: capturedAt,
    maxAgeMs: options.maxSnapshotAgeMs,
  })
  await options.accountSnapshotManager.publishAccountSnapshot({
    phase: "RUNTIME",
    auditStatus: "COMPLETE",
    auditReasons: [],
    snapshot,
    allowedAssetCodes: options.allowedAssetCodes,
  })
  return { snapshot, capturedAt }
}

async function captureDurableOpenOrdersAudit(options) {
  await options.accountSnapshotManager.publishOpenOrdersSnapshot({
    phase: "RUNTIME",
    ownershipReconciled: options.hasCanonicalOwnershipReconciliation() === true,
  })
  const readiness = options.accountSnapshotManager.getReadinessSnapshot()?.openOrders
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

async function readActiveUserDataAccountBlockers({ operationalStateStore, blockerIds }) {
  const result = await operationalStateStore.readAll()
  if (result?.ok !== true ||
      result.data?.durableWriteSupported !== true ||
      !Array.isArray(result.data.records)) {
    throw result?.errors?.[0] ?? new Error("Durable blocker provenance could not be verified")
  }
  const projection = projectHarvesterOperationalState({ records: result.data.records })
  if (projection?.ok !== true) {
    throw projection?.errors?.[0] ?? new Error("Durable blocker projection failed")
  }
  const blockers = (projection.data.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
  if (!sameStringSet(blockers.map(({ blockerId }) => blockerId), blockerIds) ||
      blockers.some(({ producer }) => producer !== "USER_DATA_EVENT_HANDLER")) {
    throw new Error("Durable ACCOUNT blocker set is not exclusively user-data sourced")
  }
  return blockers
}

function validateReadinessReport({ report, blockers, blockerIds, configuredMarkets }) {
  const blockedChecks = report.checks.filter(({ status }) => status === "BLOCKED")
  for (const check of blockedChecks) {
    if (check.id === "account.safety-blocker") {
      const matchedBlocker = blockers.some(({ blockerId, reason }) =>
        blockerIds.includes(blockerId) &&
        (check.details?.blockerId === blockerId || check.code === reason))
      if (check.details?.scope !== "ACCOUNT" || !matchedBlocker) {
        throw new Error("Readiness account blocker does not match the exact active user-data blocker set")
      }
      continue
    }
    if (check.id === "user-data.reconciliation" &&
        (check.details?.accountingFailed === true || check.details?.safetyHaltRequired === true)) {
      continue
    }
    throw new Error(`Independent readiness audit found an additional blocker: ${check.id} (${check.code})`)
  }
  const allowedMarketBlockers = new Set(["USER_DATA_NOT_READY", "ACCOUNT_SAFETY_HALT_REQUIRED"])
  for (const blocker of blockers) {
    allowedMarketBlockers.add(blocker.reason)
  }
  for (const market of report.markets) {
    if (!configuredMarkets.includes(market.symbol) ||
        market.blockers.some((code) => !allowedMarketBlockers.has(code))) {
      throw new Error(`Independent readiness audit found an additional market blocker for ${market.symbol}`)
    }
  }
}

async function validateIndependentReadiness(options, blockers, blockerIds, capturedAt) {
  const runtime = options.getRuntimeSnapshot()
  const marketResult = await options.getMarketSnapshots()
  if (marketResult?.ok !== true || !Array.isArray(marketResult.data?.markets)) {
    throw marketResult?.errors?.[0] ?? new Error("Trading engine market readiness snapshot is unavailable")
  }
  if (!sameStringSet(
    marketResult.data.markets.map(({ symbol }) => symbol),
    options.configuredMarkets,
  )) {
    throw new Error("Trading engine readiness snapshot does not cover every configured market")
  }
  const report = createHarvesterReadinessReport({
    runtime,
    markets: marketResult.data.markets,
    readinessInputs: runtime.readinessInputs,
    observedAt: capturedAt,
  })
  validateReadinessReport({
    report,
    blockers,
    blockerIds,
    configuredMarkets: options.configuredMarkets,
  })
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
 * Compose the production read-only exchange reconciliation before an operator
 * resolution. It performs broker reads and durable local audits only.
 */
export function createAuthoritativeAccountBlockerReconciliation(options = {}) {
  validateDependencies(options)
  const configuredMarkets = [...options.configuredMarkets]
  const allowedAssetCodes = resolveConfiguredAssetCodes({
    configuredMarkets,
    marketMetadata: options.marketMetadata,
  })
  const normalizedOptions = {
    ...options,
    configuredMarkets,
    allowedAssetCodes,
    maxSnapshotAgeMs: options.maxSnapshotAgeMs ?? 120_000,
    now: options.now ?? Date.now,
  }

  return async ({ blockerIds, operatorId, actionId } = {}) => {
    try {
      if (!Array.isArray(blockerIds) ||
          blockerIds.length === 0 ||
          typeof operatorId !== "string" ||
          typeof actionId !== "string") {
        throw new TypeError("Account blocker reconciliation requires blocker IDs and operator action identity")
      }
      const historyFailure = await synchronizeConfiguredMarketHistory(normalizedOptions)
      if (historyFailure) {
        return historyFailure
      }
      const { capturedAt } = await captureDurableAccountSnapshot(normalizedOptions)
      await captureDurableOpenOrdersAudit(normalizedOptions)
      const blockers = await readActiveUserDataAccountBlockers({
        operationalStateStore: options.operationalStateStore,
        blockerIds,
      })
      await validateIndependentReadiness(
        normalizedOptions,
        blockers,
        blockerIds,
        capturedAt,
      )
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
