const UNRESOLVED_BUY_STATUSES = new Set([
  "PENDING",
  "UNKNOWN",
  "OPEN",
  "NEW",
  "PARTIALLY_FILLED",
  "PARTIAL",
])
const UNRESOLVED_SELL_STATUSES = new Set(["PENDING", "UNKNOWN"])

function addBlocker(blockers, reason) {
  if (typeof reason === "string" && reason.trim() && !blockers.includes(reason)) {
    blockers.push(reason)
  }
}

function getExternalBlockerReason(blocker) {
  if (typeof blocker === "string") return blocker
  return blocker?.reason ?? blocker?.code ?? blocker?.message
}

function getMarketOrderBlockers({ state, symbol, blockers } = {}) {
  const ownedOrders = state.registry.orders.filter((order) => order.market.symbol === symbol)
  const activeOrders = state.registry.getActiveOrders().filter((order) => order.market.symbol === symbol)
  if (ownedOrders.some((order) => order.side === "BUY" && UNRESOLVED_BUY_STATUSES.has(order.status)) ||
      activeOrders.some((order) => order.side === "BUY")) {
    addBlocker(blockers, "OWNED_BUY_ORDER_UNRESOLVED")
  }
  if (ownedOrders.some((order) => order.side === "SELL" && UNRESOLVED_SELL_STATUSES.has(order.status))) {
    addBlocker(blockers, "OWNED_SELL_ORDER_UNRESOLVED")
  }
  if (state.replacementIntents.has(symbol)) addBlocker(blockers, "ORDER_REPLACEMENT_UNRESOLVED")
  if (state.trailingBuyRepriceIntents.has(symbol)) addBlocker(blockers, "TRAILING_BUY_TRANSITION_UNRESOLVED")
  if (state.shutdownRecoveryReplanSymbols.has(symbol)) addBlocker(blockers, "RECOVERY_SELL_REPLAN_UNRESOLVED")
  if (state.recoveryManagedPausedMarkets.has(symbol)) addBlocker(blockers, "RECOVERY_MANAGED_MARKET_PAUSED")
  if (state.completedRecoverySellSymbols.has(symbol)) addBlocker(blockers, "RECOVERY_SELL_COMPLETION_UNRESOLVED")
  if (ownedOrders.some((order) =>
    state.recoveryManagedCancellationClientOrderIds.has(order.clientOrderId))) {
    addBlocker(blockers, "RECOVERY_SELL_CANCELLATION_UNRESOLVED")
  }
  if (ownedOrders.some((order) =>
    state.unrequestedTerminalOrderClientIds.has(order.clientOrderId))) {
    addBlocker(blockers, "UNREQUESTED_TERMINAL_ORDER_UNRECONCILED")
  }
  if (state.deferredEvaluations.has(symbol)) addBlocker(blockers, "DEFERRED_EVALUATION_PENDING")
}

function getCoverageBlockers({ coverageResult, symbol, blockers } = {}) {
  if (coverageResult?.ok !== true) {
    addBlocker(blockers, "RECOVERY_SELL_COVERAGE_UNVERIFIED")
    return
  }
  if (coverageResult.data?.covered === true) return
  const allFindings = coverageResult.data?.findings
  if (!Array.isArray(allFindings)) {
    addBlocker(blockers, "RECOVERY_SELL_COVERAGE_INCOMPLETE")
    return
  }
  const findings = allFindings.filter((finding) => finding.symbol === symbol)
  for (const finding of findings) {
    addBlocker(blockers, "RECOVERY_SELL_COVERAGE:" + finding.reason)
  }
}

function getMarketSafetyBlockers({
  state,
  symbol,
  reconciliationComplete,
  journalDurable,
  coverageResult,
  externalBlockers,
  hasBlockingOpenOrdersForSymbol,
} = {}) {
  const blockers = []
  if (state.shutdownBuyGate !== true) addBlocker(blockers, "CONSERVATIVE_BUY_GATE_INACTIVE")
  if (reconciliationComplete !== true) addBlocker(blockers, "ORDER_OR_FILL_RECONCILIATION_INCOMPLETE")
  if (journalDurable !== true) addBlocker(blockers, "JOURNAL_NOT_DURABLE")
  getCoverageBlockers({ coverageResult, symbol, blockers })
  getMarketOrderBlockers({ state, symbol, blockers })
  if (hasBlockingOpenOrdersForSymbol({ symbol })) {
    addBlocker(blockers, "UNOWNED_OPEN_ORDERS_PRESENT")
  }
  for (const blocker of externalBlockers ?? []) {
    addBlocker(blockers, getExternalBlockerReason(blocker))
  }
  return blockers
}

function getEnabledSymbols({ pairs } = {}) {
  return Object.entries(pairs)
    .filter(([, pairConfig]) => pairConfig.enabled === true)
    .map(([symbol]) => symbol)
}

function createInitialSafetyMarkers({ pairs } = {}) {
  return new Map(getEnabledSymbols({ pairs }).map((symbol) => [symbol, {
    status: "UNSAFE",
    blockers: ["SHUTDOWN_NOT_REQUESTED"],
    revision: 0,
  }]))
}

function createSafetySnapshot({ state, pairs } = {}) {
  return Object.freeze({
    revision: state.shutdownSafetyRevision,
    markets: Object.freeze(getEnabledSymbols({ pairs }).map((symbol) => {
      const marker = state.shutdownSafetyBySymbol.get(symbol)
      return Object.freeze({
        symbol,
        enabled: pairs[symbol]?.enabled === true,
        status: marker?.status ?? "UNSAFE",
        blockers: Object.freeze([...(marker?.blockers ?? ["SHUTDOWN_SAFETY_NOT_PROVEN"])]),
        revision: marker?.revision ?? 0,
      })
    })),
  })
}

export function createConservativeShutdownSafety({
  state,
  pairs,
  runTransition,
  hasBlockingOpenOrdersForSymbol = () => false,
} = {}) {
  const enabledSymbols = getEnabledSymbols({ pairs })
  state.shutdownSafetyBySymbol = createInitialSafetyMarkers({ pairs })
  state.shutdownSafetyRevision = 0
  state.shutdownBuyGate = false

  const notifyRevision = () => {
    state.shutdownSafetyRevision += 1
    return state.shutdownSafetyRevision
  }

  const invalidateShutdownSafety = ({ symbol, symbols: requestedSymbols, reason = "NEW_ORDER_EVIDENCE" } = {}) => {
    const symbols = typeof symbol === "string"
      ? [symbol]
      : Array.isArray(requestedSymbols)
        ? requestedSymbols
        : enabledSymbols
    const revision = notifyRevision()
    for (const targetSymbol of symbols) {
      if (!Object.hasOwn(pairs, targetSymbol)) continue
      state.shutdownSafetyBySymbol.set(targetSymbol, {
        status: "UNSAFE",
        blockers: [reason],
        revision,
      })
    }
    return revision
  }

  const beginShutdown = () => {
    state.shutdownBuyGate = true
    state.deferredEvaluations.clear()
    invalidateShutdownSafety({ reason: "SHUTDOWN_SAFETY_NOT_PROVEN" })
    return { ok: true }
  }

  const auditShutdownSafety = ({
    symbol,
    reconciliationComplete = false,
    journalDurable = false,
    coverageResult,
    externalBlockers = [],
  } = {}) => runTransition({
    task: async () => {
      const symbols = typeof symbol === "string" ? [symbol] : enabledSymbols
      if (symbols.some((targetSymbol) => !enabledSymbols.includes(targetSymbol))) {
        return { ok: false, errors: [new Error("Conservative shutdown audit received an unknown market")] }
      }
      for (const targetSymbol of symbols) {
        const blockers = getMarketSafetyBlockers({
          state,
          symbol: targetSymbol,
          reconciliationComplete,
          journalDurable,
          coverageResult,
          externalBlockers,
          hasBlockingOpenOrdersForSymbol,
        })
        const revision = notifyRevision()
        const status = blockers.length === 0 ? "SAFE_TO_SHUTDOWN" : "UNSAFE"
        state.shutdownSafetyBySymbol.set(targetSymbol, {
          status,
          blockers,
          revision,
        })
      }
      return {
        ok: true,
        data: createSafetySnapshot({ state, pairs }),
      }
    },
  })

  return Object.freeze({
    beginShutdown,
    auditShutdownSafety,
    invalidateShutdownSafety,
    getShutdownSafetySnapshot: () => createSafetySnapshot({ state, pairs }),
  })
}
