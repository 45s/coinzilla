import { toResult } from "@coinzilla/utils"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"
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
      started.data.configurationFingerprint !== baseline.data.fingerprint ||
      !sameStringSet({
        left: started.data.markets,
        right: baseline.data.markets,
      })) {
    throw new Error("Evidence runtime session does not match the latest durable configuration/process baseline")
  }
  const stopped = records.find((record) =>
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

function getActiveUserDataAccountBlockers(projection) {
  const blockers = (projection.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
  if (blockers.length === 0 ||
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

function isMarketAuditReady({
    result,
    reconciliation,
    audit,
  }) {
  return result?.ok === true &&
    reconciliation?.ready === true &&
    audit?.status === "READY" &&
    audit?.targetMarketBlocked !== true &&
    audit?.tradeHistory?.complete === true &&
    Array.isArray(audit.unownedOpenOrders) &&
    audit.unownedOpenOrders.length === 0 &&
    Array.isArray(audit.blockedMarkets) &&
    audit.blockedMarkets.length === 0
}

function validateMarketAuditEvidence({ symbol, audit, accountSnapshotSourceTime }) {
  if (audit.accountSnapshot?.sourceTime !== accountSnapshotSourceTime ||
      !Number.isSafeInteger(audit.balancesChecked) ||
      audit.balancesChecked <= 0) {
    throw new Error(`${symbol}: account balance evidence is incomplete or not from the shared snapshot`)
  }
}

function validateMarketAudit({ symbol, result, accountSnapshotSourceTime }) {
  const reconciliation = result?.data?.reconciliation
  const audit = reconciliation?.audit
  if (!isMarketAuditReady({ result, reconciliation, audit })) {
    const cause = result?.errors?.[0]
    throw new Error(
      `${symbol}: ${cause?.message ?? "account-wide reconciliation did not prove READY"}`,
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

function createAccountAudit({
  blockerIds,
  configuredMarkets,
  operatorId,
  actionId,
  context,
  marketAudits,
}) {
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

function validateResolutionRequest({ operatorId, actionId, causeFixed }) {
  if (causeFixed !== true ||
      typeof operatorId !== "string" ||
      operatorId.trim() === "" ||
      typeof actionId !== "string" ||
      actionId.trim() === "") {
    throw new TypeError("Offline account resolution requires operator identity, unique action ID, and causeFixed=true")
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
  actionId,
  causeFixed,
  configuredMarkets,
  blockers,
  marketAudits,
  resolveBlockers,
}) {
  const blockerIds = blockers.map(({ blockerId }) => blockerId).sort()
  const audit = createAccountAudit({
    blockerIds,
    configuredMarkets,
    operatorId,
    actionId,
    context,
    marketAudits,
  })
  return resolveBlockers({
    operationalStateStore,
    reconcileAccount: async () => toResult({ data: audit }),
    operatorId,
    actionId,
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
    actionId,
    causeFixed,
    reconcileMarket,
    resolveBlockers,
  } = options
  validateResolutionRequest({
    operatorId,
    actionId,
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
  const blockers = getActiveUserDataAccountBlockers(state.projection)
  const marketAudits = await auditAllConfiguredMarkets({
    context,
    configuredMarkets,
    reconcileMarket,
  })
  return resolveAuditedAccountBlockers({
    operationalStateStore,
    context,
    operatorId,
    actionId,
    causeFixed,
    configuredMarkets,
    blockers,
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
