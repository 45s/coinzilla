import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"

function validateRuntimeSnapshot(snapshot) {
  const runtimeState = snapshot?.runtimeState ?? (snapshot?.connected === true ? "RUNNING" : "UNKNOWN")
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !Number.isSafeInteger(snapshot.observedAt) ||
      typeof runtimeState !== "string" ||
      typeof snapshot.tradingEnabled !== "boolean" ||
      !snapshot.userData || typeof snapshot.userData !== "object" ||
      typeof snapshot.userData.ready !== "boolean") {
    throw new TypeError("Operator runtime snapshot is incomplete or invalid")
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
    userData: Object.freeze({
      ready: snapshot.userData.ready,
      status: snapshot.userData.status ?? "UNKNOWN",
      lastEventAt: snapshot.userData.lastEventAt ?? null,
      ageMs: snapshot.userData.ageMs ?? null,
    }),
  })
}

function createMarketReadModels({ markets, runtime }) {
  return Object.freeze(markets.map((market) => {
    if (!market || typeof market.symbol !== "string" || typeof market.enabled !== "boolean" ||
        !Array.isArray(market.blockers)) {
      throw new TypeError("Operator engine market snapshot is incomplete or invalid")
    }
    const blockers = [...market.blockers]
    if (market.enabled && runtime.tradingEnabled && runtime.userData.ready !== true &&
        !blockers.includes("USER_DATA_NOT_READY")) {
      blockers.push("USER_DATA_NOT_READY")
    }
    const readiness = !market.enabled
      ? "DISABLED"
      : !runtime.tradingEnabled
        ? "OBSERVATION_ONLY"
        : blockers.length > 0
          ? "BLOCKED"
          : "READY"
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

  const readSnapshot = async ({ actor } = {}) => {
    try {
      authorizeOperatorActor({ actor })
      const runtime = validateRuntimeSnapshot(getRuntimeSnapshot())
      const marketResult = await engine.getOperatorMarketSnapshots()
      if (marketResult?.ok !== true) {
        return marketResult?.ok === false
          ? marketResult
          : toResult({ error: new Error("Engine market snapshot was not confirmed") })
      }
      const sourceMarkets = marketResult.data?.markets
      if (!Array.isArray(sourceMarkets)) {
        throw new TypeError("Engine operator market snapshot must contain a markets array")
      }
      return toResult({
        data: Object.freeze({
          runtime,
          markets: createMarketReadModels({ markets: sourceMarkets, runtime }),
        }),
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  const getStatus = async ({ actor } = {}) => {
    const snapshotResult = await readSnapshot({ actor })
    if (!snapshotResult?.ok) {return snapshotResult}
    const { runtime, markets } = snapshotResult.data
    const blockers = []
    if (runtime.runtimeState !== "RUNNING") {blockers.push("RUNTIME_NOT_RUNNING")}
    if (runtime.tradingEnabled && runtime.userData.ready !== true) {
      blockers.push(runtime.userData.status || "USER_DATA_NOT_READY")
    }
    if (runtime.stopping) {blockers.push("RUNTIME_STOPPING")}
    const state = !runtime.tradingEnabled
      ? "TRADING_DISABLED"
      : blockers.length > 0
        ? "BLOCKED"
        : "READY"
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
        readiness: Object.freeze({ state, blockers: Object.freeze(blockers) }),
        markets: Object.freeze({
          configured: markets.length,
          enabled: markets.filter(({ enabled }) => enabled).length,
          blocked: markets.filter(({ readiness }) => readiness === "BLOCKED").length,
        }),
      }),
    })
  }

  const getMarkets = async ({ actor } = {}) => {
    const snapshotResult = await readSnapshot({ actor })
    if (!snapshotResult?.ok) {return snapshotResult}
    const { runtime, markets } = snapshotResult.data
    return toResult({
      data: Object.freeze({
        observedAt: runtime.observedAt,
        tradingEnabled: runtime.tradingEnabled,
        userDataReady: runtime.userData.ready,
        userDataStatus: runtime.userData.status,
        markets,
      }),
    })
  }

  return Object.freeze({ getStatus, getMarkets })
}
