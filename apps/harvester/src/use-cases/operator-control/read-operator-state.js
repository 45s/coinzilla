import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"
import { createHarvesterReadinessReport } from "../../application/operator/create-harvester-readiness-report.js"
import { OperatorQueryError } from "./errors/operator-query-error.js"

function hasValidRuntimeMetadata({ snapshot, runtimeState }) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false
  }
  if (!Number.isSafeInteger(snapshot.observedAt) || typeof runtimeState !== "string") {
    return false
  }
  return typeof snapshot.tradingEnabled === "boolean"
}
function hasValidUserDataSnapshot({ userData }) {
  return userData !== null &&
    typeof userData === "object" &&
    typeof userData.ready === "boolean"
}

function isValidOperatorRuntimeSnapshot({ snapshot, runtimeState } = {}) {
  return hasValidRuntimeMetadata({ snapshot, runtimeState }) &&
    hasValidUserDataSnapshot({ userData: snapshot?.userData })
}

function validateRuntimeSnapshot({ snapshot, operation }) {
  const runtimeState = snapshot?.runtimeState ?? (snapshot?.connected === true ? "RUNNING" : "UNKNOWN")
  if (!isValidOperatorRuntimeSnapshot({ snapshot, runtimeState })) {
    const cause = new TypeError("Runtime snapshot must include an integer observedAt, runtime state, trading flag and user-data readiness.")
    throw new OperatorQueryError({
      message: "Harvester operator runtime snapshot is invalid",
      code: "HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_INVALID",
      cause,
      context: { operation },
    })
  }
  return Object.freeze({
    observedAt: snapshot.observedAt,
    startedAt: snapshot.startedAt ?? null,
    runtimeState,
    broker: snapshot.broker ?? "unknown",
    tradingEnabled: snapshot.tradingEnabled,
    tradingMode: snapshot.tradingMode ?? "unknown",
    strategyMode: snapshot.strategyMode ?? "unknown",
    stopping: snapshot.stopping === true,
    startupComplete: snapshot.startupComplete === true,
    startupBoundary: snapshot.startupBoundary === true,
    readinessInputs: snapshot.readinessInputs ?? {},
    userData: Object.freeze({
      ready: snapshot.userData.ready,
      status: snapshot.userData.status ?? "UNKNOWN",
      lastEventAt: snapshot.userData.lastEventAt ?? null,
      ageMs: snapshot.userData.ageMs ?? null,
      requiresReconciliation: snapshot.userData.requiresReconciliation === true,
      accountingFailed: snapshot.userData.accountingFailed === true,
      streamUnsafe: snapshot.userData.streamUnsafe === true,
      pendingRecovery: snapshot.userData.pendingRecovery === true,
      safetyHaltRequired: snapshot.userData.safetyHaltRequired === true,
      retryableRecoveryFailure: snapshot.userData.retryableRecoveryFailure ?? false,
    }),
  })
}

function createMarketReadModels({ markets, readinessReport }) {
  const readinessBySymbol = new Map(readinessReport.markets.map((market) => [market.symbol, market]))
  return Object.freeze(markets.map((market) => {
    if (!market || typeof market.symbol !== "string" || typeof market.enabled !== "boolean" ||
        !Array.isArray(market.blockers)) {
      const cause = new TypeError("Engine market snapshot must include a symbol, enabled flag and blocker array.")
      throw new OperatorQueryError({
        message: "Harvester operator market snapshot is invalid",
        code: "HARVESTER_OPERATOR_MARKET_SNAPSHOT_INVALID",
        cause,
        context: {
          operation: "READ_MARKETS",
          symbol: market?.symbol ?? "unknown",
        },
      })
    }
    const readinessSnapshot = readinessBySymbol.get(market.symbol)
    const blockers = readinessSnapshot?.blockers ?? [...market.blockers]
    const readiness = readinessSnapshot?.readiness ?? "BLOCKED"
    const volatilityProtection = market.volatilityProtection
      ? Object.freeze({ ...market.volatilityProtection })
      : null
    return Object.freeze({
      ...market,
      volatilityProtection,
      blockers: Object.freeze(blockers),
      readiness,
    })
  }))
}

function readRuntimeSnapshot({ getRuntimeSnapshot, operation }) {
  let source
  try {
    source = getRuntimeSnapshot()
  } catch (cause) {
    throw new OperatorQueryError({
      message: "Harvester operator runtime snapshot could not be read",
      code: "HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_READ_FAILED",
      cause,
      context: { operation },
    })
  }
  return validateRuntimeSnapshot({ snapshot: source,
operation })
}

async function readEngineMarketSnapshots({ engine, operation }) {
  let result
  try {
    result = await engine.getOperatorMarketSnapshots()
  } catch (cause) {
    throw new OperatorQueryError({
      message: "Harvester operator market snapshot could not be read",
      code: "HARVESTER_OPERATOR_MARKET_SNAPSHOT_READ_FAILED",
      cause,
      context: { operation },
    })
  }
  if (result?.ok !== true) {
    const cause = result?.errors?.[0] ?? result?.error
    if (cause instanceof Error && typeof cause.code === "string") {
      return { result }
    }
    throw new OperatorQueryError({
      message: "Harvester operator market snapshot could not be read",
      code: "HARVESTER_OPERATOR_MARKET_SNAPSHOT_READ_FAILED",
      cause,
      context: { operation },
    })
  }
  const markets = result.data?.markets
  if (!Array.isArray(markets)) {
    const cause = new TypeError("Engine operator market snapshot must contain a markets array.")
    throw new OperatorQueryError({
      message: "Harvester operator market snapshot is invalid",
      code: "HARVESTER_OPERATOR_MARKET_SNAPSHOT_INVALID",
      cause,
      context: { operation },
    })
  }
  return { markets }
}

function evaluateOperatorReadinessReport({ runtime, markets, operation }) {
  try {
    return createHarvesterReadinessReport({
      runtime,
      markets,
      readinessInputs: runtime.readinessInputs,
      observedAt: runtime.observedAt,
    })
  } catch (cause) {
    throw new OperatorQueryError({
      message: "Harvester startup readiness report could not be evaluated",
      code: "HARVESTER_OPERATOR_READINESS_REPORT_FAILED",
      cause,
      context: { operation },
    })
  }
}

async function readOperatorSnapshot({ engine, getRuntimeSnapshot, actor, operation }) {
  try {
    authorizeOperatorActor({ actor })
    const runtime = readRuntimeSnapshot({ getRuntimeSnapshot,
operation })
    const marketRead = await readEngineMarketSnapshots({ engine,
operation })
    if (marketRead.result) {
      return marketRead.result
    }
    const readinessReport = evaluateOperatorReadinessReport({
      runtime,
      markets: marketRead.markets,
      operation,
    })
    return toResult({
      data: Object.freeze({
        runtime,
        readinessReport,
        markets: createMarketReadModels({
          markets: marketRead.markets,
          readinessReport,
        }),
      }),
    })
  } catch (error) {
    if (error instanceof OperatorQueryError || error?.code === "OPERATOR_UNAUTHORIZED") {
      return toResult({ error })
    }
    return toResult({
      error: new OperatorQueryError({
        message: "Harvester operator read query failed",
        code: "HARVESTER_OPERATOR_QUERY_FAILED",
        cause: error,
        context: { operation },
      }),
    })
  }
}
function getOperatorReadinessState(status) {
  if (status === "HEALTHY") {
    return "READY"
  }
  if (status === "OBSERVATION_ONLY") {
    return "TRADING_DISABLED"
  }
  if (status === "DEGRADED") {
    return "DEGRADED"
  }
  return "BLOCKED"
}

function createOperatorStatus({ runtime, markets, readinessReport }) {
  const state = getOperatorReadinessState(readinessReport.status)
  return toResult({
    data: Object.freeze({
      observedAt: runtime.observedAt,
      startedAt: runtime.startedAt,
      runtimeState: runtime.runtimeState,
      broker: runtime.broker,
      tradingEnabled: runtime.tradingEnabled,
      tradingMode: runtime.tradingMode,
      strategyMode: runtime.strategyMode,
      stopping: runtime.stopping,
      userData: runtime.userData,
      readiness: Object.freeze({
        state,
        blockers: readinessReport.blockers,
        warnings: readinessReport.warnings,
      }),
      readinessReport,
      markets: Object.freeze({
        configured: markets.length,
        enabled: markets.filter(({ enabled }) => enabled).length,
        blocked: readinessReport.summary.blockedMarkets,
        ready: readinessReport.summary.readyMarkets,
      }),
    }),
  })
}

function createOperatorMarkets({ runtime, markets, readinessReport }) {
  return toResult({
    data: Object.freeze({
      observedAt: runtime.observedAt,
      tradingEnabled: runtime.tradingEnabled,
      userDataReady: runtime.userData.ready,
      userDataStatus: runtime.userData.status,
      readinessReport,
      markets,
    }),
  })
}

/**
 * Create the authorized, transport-neutral read-only operator queries.
 *
 * The engine supplies serialized market snapshots. Bootstrap supplies a
 * process-lifecycle snapshot; this use case combines them without accessing
 * broker APIs or mutating trading state.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative engine read-model boundary.
 * @param {Function} options.getRuntimeSnapshot - Read-only process runtime snapshot provider.
 * @returns {Readonly<{getStatus: Function, getMarkets: Function}>} Read-only operator queries.
 */
export function createReadOperatorState({ engine, getRuntimeSnapshot } = {}) {
  if (typeof engine?.getOperatorMarketSnapshots !== "function") {
    throw new TypeError("createReadOperatorState requires the engine getOperatorMarketSnapshots query")
  }
  if (typeof getRuntimeSnapshot !== "function") {
    throw new TypeError("createReadOperatorState requires a runtime snapshot provider")
  }

  const getStatus = async ({ actor } = {}) => {
    const snapshotResult = await readOperatorSnapshot({
      engine,
      getRuntimeSnapshot,
      actor,
      operation: "READ_STATUS",
    })
    if (!snapshotResult?.ok) {
      return snapshotResult
    }
    return createOperatorStatus(snapshotResult.data)
  }

  const getMarkets = async ({ actor } = {}) => {
    const snapshotResult = await readOperatorSnapshot({
      engine,
      getRuntimeSnapshot,
      actor,
      operation: "READ_MARKETS",
    })
    if (!snapshotResult?.ok) {
      return snapshotResult
    }
    return createOperatorMarkets(snapshotResult.data)
  }

  return Object.freeze({ getStatus, 
    getMarkets })
}
