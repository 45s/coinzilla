import { toResult } from "@coinzilla/utils"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"
import { getAccountResolutionTargetBlockers } from "./resolve-user-data-account-blockers.helpers.js"
import {
  isAuthenticatedLocalOperatorIdentity,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../infrastructure/security/local-operator-identity.js"
import { runOfflineMarketRecovery } from "../../scripts/recovery-market-context.js"

function sameStringSet({ left, right }) {
  return Array.isArray(left) &&
    [...left].sort().join("|") === [...right].sort().join("|")
}

function getLatestFact({ records, factType }) {
  return [...records].reverse().find((record) => record.factType === factType)
}

function validateStoppedSession({ records, runtimeSessionId }) {
  const started = getLatestFact({
    records,
    factType: "PROCESS_STARTED",
  })
  const baseline = getLatestFact({
    records,
    factType: "CONFIGURATION_BASELINE",
  })
  if (!started ||
      !baseline ||
      started.runtimeSessionId !== runtimeSessionId ||
      baseline.runtimeSessionId !== started.runtimeSessionId ||
      started.data.configurationFingerprint !== baseline.data.fingerprint ||
      !sameStringSet({
        left: started.data.markets,
        right: baseline.data.markets,
      })) {
    throw new Error("Evidence runtime session does not match the latest durable configuration/process baseline")
  }
  const stopped = [...records].reverse().find((record) =>
    Number(record.sequence) > Number(started.sequence) &&
    record.factType === "PROCESS_STOPPED" &&
    record.runtimeSessionId === runtimeSessionId
  )
  if (!stopped || stopped.data.clean !== true) {
    throw new Error("Account blocker resolution requires the matching process to be cleanly stopped")
  }
  return [...baseline.data.markets]
}

function hasSharedAccountEvidence(context) {
  return Array.isArray(context.journalRecords) &&
    Array.isArray(context.markets) &&
    Array.isArray(context.assets) &&
    Boolean(context.exchange?.currentAccountSnapshot) &&
    Array.isArray(context.exchange?.openOrders) &&
    Array.isArray(context.exchange?.ownedOrderHistory) &&
    Boolean(context.marketsEvidence)
}

function hasExactMarketEvidence({ context, configuredMarkets }) {
  return sameStringSet({
    left: context.configuredMarkets,
    right: configuredMarkets,
  }) &&
    sameStringSet({
      left: context.markets.map(({ symbol }) => symbol),
      right: configuredMarkets,
    }) &&
    sameStringSet({
      left: Object.keys(context.marketsEvidence),
      right: configuredMarkets,
    })
}

function validateEvidenceContext({ context, configuredMarkets }) {
  if (typeof context?.runtimeSessionId !== "string" ||
      !hasSharedAccountEvidence(context) ||
      !hasExactMarketEvidence({
        context,
        configuredMarkets,
      })) {
    throw new TypeError("Account evidence bundle must cover the exact configured markets and shared account/order evidence")
  }
}

function createMarketEvidenceContext({ context, symbol }) {
  const evidence = context.marketsEvidence[symbol]
  if (!evidence?.coverage || !evidence?.tradeHistory) {
    throw new Error(`Account evidence is missing reviewed coverage or trade history for ${symbol}`)
  }
  return {
    ...context,
    symbol,
    coverage: evidence.coverage,
    exchange: {
      ...context.exchange,
      tradeHistory: evidence.tradeHistory,
    },
  }
}

function hasCompleteMarketTradeHistory({ tradeHistory, symbol }) {
  return tradeHistory?.complete === true &&
    tradeHistory.scope === "MARKET" &&
    tradeHistory.marketSymbol === symbol &&
    tradeHistory.historyRetentionFactType === "MARKET_HISTORY_COVERAGE_CONFIRMED" &&
    Number.isSafeInteger(tradeHistory.historyStartTime) &&
    Number.isSafeInteger(tradeHistory.historyRetentionVerifiedAt) &&
    typeof tradeHistory.historyRetentionEvidenceDigest === "string" &&
    /^[a-f0-9]{64}$/.test(tradeHistory.historyRetentionEvidenceDigest) &&
    typeof tradeHistory.historyRetentionVerifiedBy === "string" &&
    tradeHistory.historyRetentionVerifiedBy.trim() !== "" &&
    Number.isSafeInteger(tradeHistory.fillsChecked) &&
    Number.isSafeInteger(tradeHistory.journalFillsChecked) &&
    tradeHistory.reconciledOwnedOrderFills === 0
}

function hasNoUnownedOpenOrders(audit) {
  return Array.isArray(audit.unownedOpenOrders) &&
    audit.unownedOpenOrders.length === 0
}

function hasNoBlockedMarkets(audit) {
  return Array.isArray(audit.blockedMarkets) &&
    audit.blockedMarkets.length === 0
}

function hasCompleteOwnedOrderReconciliation(reconciliation) {
  return Number.isSafeInteger(reconciliation.orderReconciliation?.reconciledOrders)
}

function isMarketAuditReady({ result, reconciliation, audit, symbol }) {
  return result?.ok === true &&
    reconciliation?.ready === true &&
    reconciliation.status === "READY" &&
    audit?.skipped !== true &&
    audit?.targetMarketBlocked === false &&
    hasCompleteMarketTradeHistory({
      tradeHistory: audit.tradeHistory,
      symbol,
    }) &&
    hasNoUnownedOpenOrders(audit) &&
    hasNoBlockedMarkets(audit) &&
    hasCompleteOwnedOrderReconciliation(reconciliation)
}

function validateMarketAuditEvidence({
  symbol,
  audit,
  accountSnapshotSourceTime,
}) {
  if (audit.sourceTime !== accountSnapshotSourceTime ||
      !Number.isSafeInteger(audit.balancesChecked) ||
      audit.balancesChecked <= 0 ||
      !Number.isSafeInteger(audit.openOrdersChecked) ||
      audit.openOrdersChecked < 0 ||
      !Number.isSafeInteger(audit.reservationsChecked) ||
      audit.reservationsChecked < 0) {
    throw new Error(`${symbol}: account, balance, order, or reservation evidence is incomplete or stale`)
  }
}

function validateMarketAudit({
  symbol,
  result,
  accountSnapshotSourceTime,
}) {
  const reconciliation = result?.data?.reconciliation
  const audit = reconciliation?.audit
  if (!isMarketAuditReady({
    result,
    reconciliation,
    audit,
    symbol,
  })) {
    const cause = result?.errors?.[0]
    throw new Error(
      `${symbol}: ${cause?.message ?? "production account/order/fill reconciliation did not prove READY"}`,
      { cause },
    )
  }
  validateMarketAuditEvidence({
    symbol,
    audit,
    accountSnapshotSourceTime,
  })
  return {
    symbol,
    ready: true,
    accountSnapshotSourceTime,
    balancesChecked: audit.balancesChecked,
    openOrdersChecked: audit.openOrdersChecked,
    reservationsChecked: audit.reservationsChecked,
    ownedOrderReconciliation: reconciliation.orderReconciliation,
    unownedOpenOrders: audit.unownedOpenOrders,
    blockedMarkets: audit.blockedMarkets,
    tradeHistory: audit.tradeHistory,
  }
}

async function auditAllConfiguredMarkets({ context, configuredMarkets, reconcileMarket }) {
  const { currentAccountSnapshot } = context.exchange
  const { sourceTime } = currentAccountSnapshot
  const summaries = []
  for (const symbol of configuredMarkets) {
    const marketContext = createMarketEvidenceContext({
      context,
      symbol,
    })
    const result = await reconcileMarket({
      context: marketContext,
      confirm: false,
    })
    summaries.push(validateMarketAudit({
      symbol,
      result,
      accountSnapshotSourceTime: sourceTime,
    }))
  }
  return summaries
}

function validateAccountAuditSet({ configuredMarkets, marketAudits, context }) {
  const auditedMarkets = marketAudits.map(({ symbol }) => symbol)
  const { currentAccountSnapshot } = context.exchange
  const { sourceTime } = currentAccountSnapshot
  if (marketAudits.length !== configuredMarkets.length ||
      !sameStringSet({
        left: auditedMarkets,
        right: configuredMarkets,
      }) ||
      !Number.isSafeInteger(sourceTime) ||
      marketAudits.some((audit) => audit.accountSnapshotSourceTime !== sourceTime ||
        audit.ready !== true ||
        !hasCompleteMarketTradeHistory({
          tradeHistory: audit.tradeHistory,
          symbol: audit.symbol,
        }) ||
        audit.unownedOpenOrders.length !== 0 ||
        audit.blockedMarkets.length !== 0)) {
    throw new Error("Account-wide resolution requires a complete, consistent audit for every configured market")
  }
}

function createAccountAudit({
  blockers,
  blockerIds,
  configuredMarkets,
  operatorId,
  operatorIdentity,
  actionId,
  resolutionReason,
  context,
  marketAudits,
}) {
  validateAccountAuditSet({
    configuredMarkets,
    marketAudits,
    context,
  })
  return {
    status: "READY",
    scope: "ACCOUNT",
    source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
    allConfiguredMarketsAudited: marketAudits.length === configuredMarkets.length,
    auditedMarkets: marketAudits.map(({ symbol }) => symbol),
    openOrdersReconciled: marketAudits.every(({ openOrdersChecked }) =>
      Number.isSafeInteger(openOrdersChecked)),
    fillsReconciled: marketAudits.every(({ tradeHistory }) =>
      tradeHistory.complete === true && tradeHistory.reconciledOwnedOrderFills === 0),
    balancesReconciled: marketAudits.every(({ balancesChecked }) =>
      Number.isSafeInteger(balancesChecked) && balancesChecked > 0),
    accountingConsistent: true,
    unresolvedOwnedOrders: 0,
    unresolvedOwnedFills: 0,
    unresolvedExternalOrders: 0,
    balanceDiscrepancies: 0,
    blockerIds,
    actionBlockerIds: blockerIds,
    operatorId,
    operatorAuthMethod: operatorIdentity.authMethod,
    actionId,
    resolutionReason,
    blockerOrigins: blockers.map(({ blockerId, producer }) => ({
      blockerId,
      producer,
    })),
    reconciliationId: `offline-account-resolution:${operatorId}:${actionId}`,
    capturedAt: new Date(context.exchange.currentAccountSnapshot.sourceTime).toISOString(),
    marketAudits,
  }
}

function validateResolutionRequest({
  operatorId,
  operatorIdentity,
  actionId,
  resolutionReason,
  causeFixed,
}) {
  if (causeFixed !== true ||
      !LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "") ||
      !isAuthenticatedLocalOperatorIdentity(operatorIdentity) ||
      operatorIdentity.operatorId !== operatorId ||
      operatorIdentity.authMethod !== "OS_ACCOUNT" ||
      typeof actionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId) ||
      typeof resolutionReason !== "string" ||
      resolutionReason.trim() !== resolutionReason ||
      resolutionReason.length < 8 ||
      resolutionReason.length > 512 ||
      /[\u0000-\u001F\u007F]/.test(resolutionReason)) {
    throw new TypeError("Offline account resolution requires authenticated operator identity, unique action ID, resolution reason, and causeFixed=true")
  }
}

async function readVerifiedOperationalProjection(operationalStateStore) {
  const result = await operationalStateStore.readAll()
  if (result?.ok !== true ||
      result.data?.durableWriteSupported !== true ||
      !Array.isArray(result.data.records)) {
    throw result?.errors?.[0] ?? new Error("Offline account resolution requires a verified durable Operational State Store")
  }
  const projection = projectHarvesterOperationalState({ records: result.data.records })
  if (projection?.ok !== true) {
    throw projection?.errors?.[0] ?? new Error("Operational State projection failed")
  }
  const { data } = projection
  return {
    records: result.data.records,
    projection: data,
  }
}

async function resolveAuditedAccountBlockers({
  operationalStateStore,
  context,
  operatorId,
  operatorIdentity,
  actionId,
  resolutionReason,
  causeFixed,
  configuredMarkets,
  blockers,
  blockerIds,
  marketAudits,
  resolveBlockers,
}) {
  const audit = createAccountAudit({
    blockers,
    blockerIds,
    configuredMarkets,
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    context,
    marketAudits,
  })
  return resolveBlockers({
    operationalStateStore,
    reconcileAccount: async () => toResult({ data: audit }),
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    causeFixed,
    configuredMarkets,
  })
}

/**
 * Run the existing production account/order/fill audit for every configured
 * market against one shared account snapshot and order evidence bundle.
 */
async function runResolutionWorkflow(options) {
  const {
    context,
    operationalStateStore,
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    causeFixed,
    reconcileMarket,
    resolveBlockers,
  } = options
  validateResolutionRequest({
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    causeFixed,
  })
  const state = await readVerifiedOperationalProjection(operationalStateStore)
  const configuredMarkets = validateStoppedSession({
    records: state.records,
    runtimeSessionId: context.runtimeSessionId,
  })
  validateEvidenceContext({
    context,
    configuredMarkets,
  })
  const targets = getAccountResolutionTargetBlockers({
    records: state.records,
    projection: state.projection,
    operatorId,
    actionId,
    resolutionReason,
  })
  const blockers = targets.blockers
  const marketAudits = await auditAllConfiguredMarkets({
    context,
    configuredMarkets,
    reconcileMarket,
  })
  return resolveAuditedAccountBlockers({
    operationalStateStore,
    context,
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    causeFixed,
    configuredMarkets,
    blockers,
    blockerIds: targets.blockerIds,
    marketAudits,
    resolveBlockers,
  })
}

export async function runOfflineAccountBlockerResolution(options = {}) {
  try {
    return await runResolutionWorkflow({
      ...options,
      reconcileMarket: options.reconcileMarket ?? runOfflineMarketRecovery,
      resolveBlockers: options.resolveBlockers ?? resolveUserDataAccountBlockers,
    })
  } catch (error) {
    return toResult({ error })
  }
}
