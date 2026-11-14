import { toResult } from "@coinzilla/utils"
import { confirmMarketHistoryCoverage } from "../src/use-cases/confirm-market-history-coverage.js"
import { reconcileRecoveredMarketState } from "../src/use-cases/reconcile-recovered-market-state.js"
import {
  createAccountSnapshot,
  createCanonicalEvidence,
  createCanonicalFill,
  reconcileOfflineOwnedOrders,
} from "./recovery-market-evidence.js"

function requireObject({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(field + " must be an object")
  }
  return value
}

function requireArray({ value, field }) {
  if (!Array.isArray(value)) throw new TypeError(field + " must be an array")
  return value
}

function requireString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value
}

/**
 * Run ADR-0001 Step 7 against an explicit offline evidence bundle.
 *
 * The adapter reads no broker, exchange, Journal directory, or runtime state.
 * All exchange observations are supplied by the operator in the context file.
 * It can append only the market-history coverage fact, and only when the
 * caller explicitly sets confirm=true and supplies the existing durable store.
 *
 * @param {object} options
 * @param {object} options.context - Operator-prepared Journal and exchange evidence bundle.
 * @param {boolean} [options.confirm=false] - Whether to append the coverage fact after a READY audit.
 * @param {object} [options.operationalStateStore] - Existing ADR-0001 durable-facts read/append port; required only for confirmation.
 * @returns {Promise<object>} Result containing an audit-only reconciliation or explicit confirmation outcome.
 */
export async function runOfflineMarketRecovery({
  context,
  confirm = false,
  operationalStateStore,
} = {}) {
  try {
    if (typeof confirm !== "boolean") throw new TypeError("confirm must be a boolean")
    const canonical = createCanonicalEvidence({ context })
    if (canonical?.ok !== true) return canonical
    const {
      projection,
      recoveredState: initialRecoveredState,
      markets,
      marketsBySymbol,
      assetsByLookup,
    } = canonical.data
    const symbol = requireString({ value: context.symbol, field: "context.symbol" })
    const targetMarket = marketsBySymbol.get(symbol)
    if (!targetMarket) throw new Error("Canonical target market metadata is missing for " + symbol)
    const coverage = requireObject({ value: context.coverage, field: "context.coverage" })
    const historyRetentionEvidence = {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: "market-history-coverage:" + symbol + ":baseline",
      symbol,
      coveredFromTime: coverage.coveredFromTime,
      verifiedAt: coverage.verifiedAt,
      evidenceDigest: coverage.evidenceDigest,
      verifiedBy: coverage.verifiedBy,
    }
    const exchange = requireObject({ value: context.exchange, field: "context.exchange" })
    const currentAccountSnapshot = createAccountSnapshot({
      input: exchange.currentAccountSnapshot,
      assetsByLookup,
    })
    const openOrders = requireArray({
      value: exchange.openOrders,
      field: "exchange.openOrders",
    })
    const tradeHistory = requireObject({
      value: exchange.tradeHistory,
      field: "exchange.tradeHistory",
    })
    const exchangeFills = requireArray({
      value: tradeHistory.fills,
      field: "exchange.tradeHistory.fills",
    }).map((fill) => createCanonicalFill({ input: fill, marketsBySymbol, assetsByLookup }))
    let recoveredState = initialRecoveredState

    const reconcileMarketState = async ({ historyRetentionEvidence: candidateEvidence }) => {
      return reconcileRecoveredMarketState({
        projection,
        reconcileOwnedOrders: async () => {
          recoveredState = reconcileOfflineOwnedOrders({
            recoveredState,
            orderHistory: exchange.ownedOrderHistory,
            marketsBySymbol,
          })
          return toResult({ data: { reconciledOrders: recoveredState.reconciledOrders } })
        },
        getRecoveredState: async () => recoveredState,
        refreshAccountSnapshot: async () => toResult({ data: currentAccountSnapshot }),
        refreshOpenOrders: async () => toResult({ data: openOrders }),
        fetchMarketTradeHistory: async ({ market: requestedMarket, startTime }) => {
          if (requestedMarket.id !== targetMarket.id || startTime !== coverage.coveredFromTime ||
              tradeHistory.historyStartTime !== startTime ||
              tradeHistory.historyScope !== "MARKET" ||
              !Array.isArray(tradeHistory.marketsQueried) ||
              tradeHistory.marketsQueried.length !== 1 ||
              tradeHistory.marketsQueried[0] !== symbol) {
            throw new Error("Offline trade-history evidence must cover exactly the target market from the reviewed coverage start")
          }
          return toResult({
            data: {
              ...tradeHistory,
              fills: exchangeFills,
              marketUniverseComplete: false,
              historyRetentionEvidence: candidateEvidence,
            },
          })
        },
        markets,
        targetMarket,
        historyRetentionEvidence: candidateEvidence,
      })
    }

    if (confirm) {
      requireString({ value: context.runtimeSessionId, field: "context.runtimeSessionId" })
      if (typeof operationalStateStore?.readAll !== "function" ||
          typeof operationalStateStore?.append !== "function") {
        throw new TypeError("Offline coverage confirmation requires the existing ADR-0001 durable-facts read/append port")
      }
      const confirmation = await confirmMarketHistoryCoverage({
        operationalStateStore,
        symbol,
        ...coverage,
        reconcileMarketState,
      })
      if (confirmation?.ok !== true) {
        return toResult({ errors: confirmation?.errors ?? [new Error("Offline market-history confirmation failed")] })
      }
      return toResult({
        data: Object.freeze({
          mode: "CONFIRM",
          confirmation: confirmation.data,
        }),
      })
    }

    const reconciliation = await reconcileMarketState({ historyRetentionEvidence })
    if (reconciliation?.ok !== true) {
      return toResult({ errors: reconciliation?.errors ?? [new Error("Offline market reconciliation failed")] })
    }
    return toResult({
      data: Object.freeze({
        mode: "AUDIT_ONLY",
        reconciliation: reconciliation.data,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
