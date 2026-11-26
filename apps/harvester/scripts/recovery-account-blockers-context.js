import { toResult } from "@coinzilla/utils"
import { projectHarvesterOperationalState } from "../src/infrastructure/operational-state/project-harvester.js"
import { resolveUserDataAccountBlockers } from "../src/use-cases/resolve-user-data-account-blockers.js"
import { runOfflineMarketRecovery } from "./recovery-market-context.js"

function sameStringSet(left, right) {
  return Array.isArray(left) &&
    [...left].sort().join("|") === [...right].sort().join("|")
}

function getLatestFact(records, factType) {
  return [...records].reverse().find((record) => record.factType === factType)
}

function validateStoppedSession({ records, runtimeSessionId }) {
  const started = getLatestFact(records, "PROCESS_STARTED")
  const baseline = getLatestFact(records, "CONFIGURATION_BASELINE")
  if (!started ||
      !baseline ||
      started.runtimeSessionId !== runtimeSessionId ||
      started.data.configurationFingerprint !== baseline.data.fingerprint ||
      !sameStringSet(started.data.markets, baseline.data.markets)) {
    throw new Error("Evidence runtime session does not match the latest durable configuration/process baseline")
  }
  const startedIndex = records.findIndex((record) => record.factId === started.factId)
  const stoppedIndex = records.findIndex((record, index) =>
    index > startedIndex &&
    record.factType === "PROCESS_STOPPED" &&
    record.runtimeSessionId === runtimeSessionId
  )
  const stopped = stoppedIndex >= 0 ? records[stoppedIndex] : undefined
  if (!stopped || stopped.data.clean !== true) {
    throw new Error("Account blocker resolution requires the matching process to be cleanly stopped")
  }
  return [...baseline.data.markets]
}

function validateEvidenceContext({ context, configuredMarkets }) {
  if (context?.runtimeSessionId === undefined ||
      !Array.isArray(context.journalRecords) ||
      !Array.isArray(context.markets) ||
      !Array.isArray(context.assets) ||
      !context.exchange ||
      !context.exchange.currentAccountSnapshot ||
      !Array.isArray(context.exchange.openOrders) ||
      !Array.isArray(context.exchange.ownedOrderHistory) ||
      !context.marketsEvidence ||
      !sameStringSet(context.configuredMarkets, configuredMarkets) ||
      !sameStringSet(context.markets.map(({ symbol }) => symbol), configuredMarkets) ||
      !sameStringSet(Object.keys(context.marketsEvidence), configuredMarkets)) {
    throw new TypeError("Account evidence bundle must cover the exact configured markets and shared account/order evidence")
  }
}

function validateActiveUserDataAccountBlockers({ projection, blockerIds }) {
  const blockers = (projection.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
  if (blockers.length === 0 ||
      !sameStringSet(blockers.map(({ blockerId }) => blockerId), blockerIds) ||
      blockers.some(({ producer }) => producer !== "USER_DATA_EVENT_HANDLER")) {
    throw new Error("Active ACCOUNT blockers are not exclusively user-data sourced")
  }
  return blockers
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

function validateMarketAudit({ symbol, result, accountSnapshotSourceTime }) {
  const reconciliation = result?.data?.reconciliation
  const audit = reconciliation?.audit
  if (result?.ok !== true ||
      reconciliation?.ready !== true ||
      audit?.status !== "READY" ||
      audit?.targetMarketBlocked === true ||
      audit?.tradeHistory?.complete !== true ||
      !Array.isArray(audit.unownedOpenOrders) ||
      audit.unownedOpenOrders.length !== 0 ||
      !Array.isArray(audit.blockedMarkets) ||
      audit.blockedMarkets.length !== 0 ||
      audit.accountSnapshot?.sourceTime !== accountSnapshotSourceTime ||
      !Number.isSafeInteger(audit.balancesChecked) ||
      audit.balancesChecked <= 0) {
    const error = result?.errors?.[0] ?? new Error(`Account-wide reconciliation did not prove ${symbol} READY`)
    error.message = `${symbol}: ${error.message}`
    throw error
  }
  return {
    symbol,
    ready: true,
    accountSnapshotSourceTime,
    balancesChecked: audit.balancesChecked,
    openOrdersChecked: audit.openOrdersChecked,
    reservationsChecked: audit.reservationsChecked,
    ownedOrderReconciliation: reconciliation.orderReconciliation,
    tradeHistory: audit.tradeHistory,
  }
}

async function auditAllConfiguredMarkets({ context, configuredMarkets, reconcileMarket }) {
  const sourceTime = context.exchange.currentAccountSnapshot.sourceTime
  const summaries = []
  for (const symbol of configuredMarkets) {
    const marketContext = createMarketEvidenceContext({ context, symbol })
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

function createAccountAudit({ blockerIds, configuredMarkets, operatorId, actionId, context, marketAudits }) {
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
    reconciliationId: `offline-account-resolution:${operatorId}:${actionId}`,
    capturedAt: new Date(context.exchange.currentAccountSnapshot.sourceTime).toISOString(),
    marketAudits,
  }
}

/**
 * Run the existing production account/order/fill audit once for every market
 * using one shared account snapshot and open-order/owned-order evidence bundle.
 */
export async function runOfflineAccountBlockerResolution({
  context,
  operationalStateStore,
  operatorId,
  actionId,
  causeFixed,
  reconcileMarket = runOfflineMarketRecovery,
  resolveBlockers = resolveUserDataAccountBlockers,
} = {}) {
  try {
    if (causeFixed !== true ||
        typeof operatorId !== "string" ||
        operatorId.trim() === "" ||
        typeof actionId !== "string" ||
        actionId.trim() === "") {
      throw new TypeError("Offline account resolution requires operator identity, unique action ID, and causeFixed=true")
    }
    const storeResult = await operationalStateStore.readAll()
    if (storeResult?.ok !== true ||
        storeResult.data?.durableWriteSupported !== true ||
        !Array.isArray(storeResult.data.records)) {
      throw storeResult?.errors?.[0] ?? new Error("Offline account resolution requires a verified durable Operational State Store")
    }
    const projection = projectHarvesterOperationalState({ records: storeResult.data.records })
    if (projection?.ok !== true) {
      throw projection?.errors?.[0] ?? new Error("Operational State projection failed")
    }
    const configuredMarkets = validateStoppedSession({
      records: storeResult.data.records,
      runtimeSessionId: context.runtimeSessionId,
    })
    validateEvidenceContext({ context, configuredMarkets })
    const blockers = validateActiveUserDataAccountBlockers({
      projection: projection.data,
      blockerIds: (projection.data.stickySafetyBlockers ?? [])
        .filter(({ scope }) => scope === "ACCOUNT")
        .map(({ blockerId }) => blockerId),
    })
    const blockerIds = blockers.map(({ blockerId }) => blockerId).sort()
    const marketAudits = await auditAllConfiguredMarkets({
      context,
      configuredMarkets,
      reconcileMarket,
    })
    const audit = createAccountAudit({
      blockerIds,
      configuredMarkets,
      operatorId,
      actionId,
      context,
      marketAudits,
    })
    return await resolveBlockers({
      operationalStateStore,
      reconcileAccount: async () => toResult({ data: audit }),
      operatorId,
      actionId,
      causeFixed,
      configuredMarkets,
    })
  } catch (error) {
    return toResult({ error })
  }
}
