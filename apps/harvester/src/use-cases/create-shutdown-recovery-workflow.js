import { addDecimal, compareDecimal, maxDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { failureResult } from "./recovery-failure.js"

export function createShutdownRecoveryWorkflow(dependencies = {}) {
  const {
    state,
    getCurrentMarketMetadata,
    getPortfolio,
    getRecoveryLedger,
    pairs,
    strategyPolicy,
    settings,
    cancelAndReconcileRecoverySells,
    hasBlockingOpenOrdersForSymbol,
    evaluateLatestTransition,
    isStopping,
    runTransition,
  } = dependencies

  const shutdownRecoveryError = ({ code, message }) => Object.assign(new Error(message), { code })

  const getShutdownRecoveryMetadata = ({ symbol } = {}) => {
    try {
      return getCurrentMarketMetadata({ symbol })
    } catch {
      return undefined
    }
  }

  const getShutdownRecoveryOrders = ({ symbol, portfolio } = {}) => {
    const activeOrdersForSymbol = state.registry.orders.filter((order) =>
      order.market.symbol === symbol &&
      ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
    return {
      activeSellsForSymbol: activeOrdersForSymbol.filter((order) => order.side === "SELL"),
      positionBySymbol: portfolio.getPosition({ strategyId: StrategyId.COIN_GRABBER, symbol }),
    }
  }

  const inventoryWithoutMarketMetadata = ({
    symbol,
    portfolio,
    metadata,
    positionBySymbol,
    activeSells,
  } = {}) => {
    const marketEnabled = pairs[symbol]?.enabled === true
    return {
      symbol,
      portfolio,
      metadata,
      position: positionBySymbol,
      activeSells,
      errorReason: positionBySymbol || activeSells.length > 0 || marketEnabled
        ? "MARKET_METADATA_UNAVAILABLE"
        : null,
      noRecoveryRequired: !positionBySymbol && activeSells.length === 0 && !marketEnabled,
    }
  }

  const buildShutdownRecoveryInventory = ({
    symbol,
    portfolio,
    metadata,
    positionBySymbol,
  } = {}) => {
    const position = portfolio.getPosition({
      strategyId: StrategyId.COIN_GRABBER,
      marketId: metadata.market.id,
    }) ?? positionBySymbol
    const recoveryLedger = getRecoveryLedger({ marketId: metadata.market.id })
    const activeSells = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .filter((order) => order.side === "SELL")
    if (!position && activeSells.length === 0) {
      return {
        symbol,
        metadata,
        portfolio,
        position: null,
        recoveryLedger,
        activeSells,
        noRecoveryRequired: true,
      }
    }
    if (position && pairs[symbol].keepQuantity === undefined) {
      return {
        symbol,
        metadata,
        portfolio,
        position,
        recoveryLedger,
        activeSells,
        errorReason: "KEEP_QUANTITY_UNAVAILABLE",
      }
    }
    const activeQuantity = position?.quantity.amount ?? "0"
    const keepQuantity = String(pairs[symbol].keepQuantity ?? "0")
    const sellableQuantity = maxDecimal({
      left: "0",
      right: subtractDecimal({ left: activeQuantity, right: keepQuantity }),
    })
    // Position.spent is authoritative accumulated BUY cost, including actual commissions.
    // RecoveryLedger.buyCost is only a consistency mirror; the ledger contributes confirmed net SELL proceeds.
    const recoveryCost = position?.spent.amount ?? "0"
    const outstandingRecoveryAmount = maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: recoveryCost,
        right: recoveryLedger?.netSellProceeds ?? "0",
      }),
    })
    const committedQuantity = activeSells.reduce((total, order) =>
      addDecimal({ left: total, right: order.remainingQuantity.amount }), "0")
    const common = {
      symbol,
      activeQuantity,
      keepQuantity,
      sellableQuantity,
      outstandingRecoveryAmount,
      activeSellCount: activeSells.length,
      committedQuantity,
    }
    const requiresSell = compareDecimal({ left: sellableQuantity, right: "0" }) > 0 ||
      compareDecimal({ left: outstandingRecoveryAmount, right: "0" }) > 0
    return {
      symbol,
      metadata,
      portfolio,
      position,
      recoveryLedger,
      activeSells,
      common,
      requiresSell,
      noRecoveryRequired: !requiresSell && activeSells.length === 0,
    }
  }

  const getShutdownRecoveryInventory = ({ symbol } = {}) => {
    const metadata = getShutdownRecoveryMetadata({ symbol })
    const portfolio = getPortfolio()
    const { activeSellsForSymbol, positionBySymbol } = getShutdownRecoveryOrders({
      symbol,
      portfolio,
    })
    if (!metadata?.market) {
      return inventoryWithoutMarketMetadata({
        symbol,
        portfolio,
        metadata,
        positionBySymbol,
        activeSells: activeSellsForSymbol,
      })
    }
    return buildShutdownRecoveryInventory({
      symbol,
      portfolio,
      metadata,
      positionBySymbol,
    })
  }

  const getShutdownRecoverySellPlan = ({
    symbol,
    inventory
  } = {}) => {
    const marketPrice = state.prices.get(symbol)
    if (!marketPrice) {
      return { reason: "MARKET_PRICE_UNAVAILABLE" }
    }
    try {
      const decision = strategyPolicy.evaluate({
        marketPrice,
        pairConfig: pairs[symbol],
        settings,
        portfolio: inventory.portfolio,
        recoveryLedger: inventory.recoveryLedger,
        marketMetadata: inventory.metadata,
        activeOrders: [],
        // This value only feeds the BUY intent, which shutdown filters out.
        lastBuyPrice: state.lastBuyPrices.get(symbol) ?? marketPrice.price,
      })
      return {
        plannedSell: decision.actions.find((action) => action.side === "SELL"),
        inventoryDisposition: decision.inventoryDisposition?.status ?? null,
      }
    } catch (error) {
      return {
        reason: "RECOVERY_SELL_PLAN_UNAVAILABLE",
        error
      }
    }
  }

  const compareShutdownRecoverySell = ({
    inventory,
    plannedSell
  } = {}) => {
    const {
      activeSells,
      common
    } = inventory
    if (!plannedSell) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_UNAVAILABLE",
        inventoryDisposition: inventory.inventoryDisposition ?? null,
      }
    }
    if (activeSells.length === 0) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_MISSING",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    if (activeSells.length !== 1) {
      return {
        covered: false,
        ...common,
        reason: "MULTIPLE_ACTIVE_RECOVERY_SELLS",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    const [order] = activeSells
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status) ||
        typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_STATE_UNRESOLVED",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    const quantityComparison = compareDecimal({
      left: order.remainingQuantity.amount,
      right: plannedSell.quantity,
    })
    const quantityMatches = quantityComparison === 0
    let priceSufficient
    if (compareDecimal({
      left: common.outstandingRecoveryAmount,
      right: "0"
    }) === 0) {
      priceSufficient = compareDecimal({
        left: order.limitPrice?.amount ?? "0",
        right: "0"
      }) > 0
    } else {
      priceSufficient = compareDecimal({
        left: order.limitPrice?.amount ?? "0",
        right: plannedSell.price,
      }) >= 0
    }
    let reason = null
    if (!quantityMatches) {
      reason = quantityComparison < 0 ? "RECOVERY_SELL_UNDERSIZED" : "RECOVERY_SELL_OVERCOMMITTED"
    } else if (!priceSufficient) {
      reason = "RECOVERY_SELL_FINANCIALLY_INSUFFICIENT"
    }
    return {
      covered: reason === null,
      ...common,
      requiredQuantity: plannedSell.quantity,
      requiredPrice: plannedSell.price,
      committedPrice: order.limitPrice?.amount ?? null,
      reason,
    }
  }

  const assessShutdownRecoverySellCoverage = ({ symbol } = {}) => {
    const inventory = getShutdownRecoveryInventory({ symbol })
    if (inventory.errorReason) {
      return {
        covered: false,
        symbol,
        reason: inventory.errorReason,
        activeSellCount: inventory.activeSells.length,
      }
    }
    if (inventory.noRecoveryRequired) {
      return {
        covered: true,
        symbol,
        activeQuantity: inventory.position?.quantity.amount ?? "0",
        keepQuantity: String(pairs[symbol].keepQuantity),
        sellableQuantity: "0",
        outstandingRecoveryAmount: "0",
        activeSellCount: 0,
        committedQuantity: "0",
      }
    }
    if (!inventory.metadata?.market) {
      return {
        covered: false,
        symbol,
        reason: "MARKET_METADATA_UNAVAILABLE"
      }
    }
    if (!inventory.requiresSell) {
      return inventory.activeSells.length === 0
        ? {
          covered: true,
          ...inventory.common
        }
        : {
          covered: false,
          ...inventory.common,
          reason: "RECOVERY_SELL_UNNECESSARY"
        }
    }
    const plan = getShutdownRecoverySellPlan({
      symbol,
      inventory
    })
    if (plan.reason) {
      return {
        covered: false,
        ...inventory.common,
        reason: plan.reason,
        error: plan.error
      }
    }
    return compareShutdownRecoverySell({
      inventory: {
        ...inventory,
        inventoryDisposition: plan.inventoryDisposition
      },
      plannedSell: plan.plannedSell,
    })
  }

  const isShutdownRecoveryInputUnavailable = ({ assessment } = {}) =>
    ["MARKET_PRICE_UNAVAILABLE", "MARKET_METADATA_UNAVAILABLE", "KEEP_QUANTITY_UNAVAILABLE", "RECOVERY_SELL_PLAN_UNAVAILABLE"].includes(assessment.reason)

  const cancelStaleShutdownRecoverySells = async ({ symbol, assessment } = {}) => {
    const metadata = getCurrentMarketMetadata({ symbol })
    const activeSells = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .filter((order) => order.side === "SELL")
    if (activeSells.length === 0) {
      return { ok: true, assessment, canceledStaleSell: false }
    }
    const cancellation = await cancelAndReconcileRecoverySells({
      symbol,
      marketId: metadata.market.id,
    })
    if (!cancellation?.ok || cancellation.data?.deferred === true) {
      return {
        ok: false,
        error: cancellation?.errors?.[0] ??
          shutdownRecoveryError({
            code: "SHUTDOWN_RECOVERY_CANCELLATION_UNRESOLVED",
            message: `Shutdown recovery SELL cancellation is unresolved for ${symbol}`,
          }),
      }
    }
    return {
      ok: true,
      assessment: assessShutdownRecoverySellCoverage({ symbol }),
      canceledStaleSell: true,
    }
  }

  const getShutdownRecoveryReplacementBlocker = ({ symbol } = {}) => {
    if (!state.paused.has(symbol) && !hasBlockingOpenOrdersForSymbol({ symbol })) {return null}
    return shutdownRecoveryError({
      code: "SHUTDOWN_RECOVERY_REPLACEMENT_BLOCKED",
      message: `Shutdown recovery SELL replacement is blocked for ${symbol}`,
    })
  }

  const submitShutdownRecoveryReplacement = async ({ symbol } = {}) => {
    const blocker = getShutdownRecoveryReplacementBlocker({ symbol })
    if (blocker) {return { ok: false, error: blocker }}
    const replacement = await evaluateLatestTransition({
      symbol,
      shutdownRecoveryOnly: true,
    })
    const submittedSell = replacement?.data?.submittedOrders?.some((order) => order.side === "SELL") === true
    if (!replacement?.ok || replacement.data?.deferred === true ||
        replacement.data?.skipped === true || !submittedSell) {
      return {
        ok: false,
        error: replacement?.errors?.[0] ??
          shutdownRecoveryError({
            code: "SHUTDOWN_RECOVERY_REPLACEMENT_UNCONFIRMED",
            message: `Shutdown recovery SELL replacement was not confirmed for ${symbol}`,
          }),
      }
    }
    return { ok: true }
  }

  const reconcileRecoverySellForShutdownSymbol = async ({ symbol } = {}) => {
    let assessment = assessShutdownRecoverySellCoverage({ symbol })
    if (assessment.covered) {return { ok: true, assessment }}
    if (isShutdownRecoveryInputUnavailable({ assessment })) {
      return {
        ok: false,
        error: shutdownRecoveryError({
          code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
          message: `Shutdown recovery SELL cannot be safely evaluated for ${symbol}: ${assessment.reason}`,
        }),
      }
    }
    const cancellation = await cancelStaleShutdownRecoverySells({ symbol, assessment })
    if (!cancellation.ok) {return cancellation}
    assessment = cancellation.assessment
    if (assessment.covered) {
      return {
        ok: true,
        assessment,
        canceledStaleSell: cancellation.canceledStaleSell,
      }
    }
    const replacement = await submitShutdownRecoveryReplacement({ symbol })
    if (!replacement.ok) {return replacement}
    assessment = assessShutdownRecoverySellCoverage({ symbol })
    if (!assessment.covered) {
      return {
        ok: false,
        error: shutdownRecoveryError({
          code: "SHUTDOWN_RECOVERY_COVERAGE_INCOMPLETE",
          message: `Shutdown recovery SELL coverage remains incomplete for ${symbol}: ${assessment.reason}`,
        }),
      }
    }
    return {
      ok: true,
      assessment,
      replacedStaleSell: true,
    }
  }

  const reconcileRecoverySellsForShutdown = () => runTransition({
    task: async () => {
      if (isStopping?.() !== true) {
        return toResult({ error: shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_REQUIRES_STOPPING_STATE", message: "Shutdown recovery SELL reconciliation requires the stopping state" }) })
      }
      const reconciledSymbols = []
      const failures = []
      for (const symbol of Object.keys(pairs)) {
        const result = await reconcileRecoverySellForShutdownSymbol({ symbol })
        if (!result.ok) {
          failures.push(result.error)
          continue
        }
        state.shutdownRecoveryReplanSymbols.delete(symbol)
        if (result.canceledStaleSell || result.replacedStaleSell) {
          reconciledSymbols.push(symbol)
        }
      }
      if (failures.length > 0) {
        return failureResult({
          errors: failures,
          category: "ORDER_TRANSITION",
          stage: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION",
          retryable: true,
        })
      }
      return toResult({ data: { reconciledSymbols } })
    },
  })

  const auditShutdownRecoverySellCoverage = () => runTransition({
    task: async () => {
      const findings = []
      for (const symbol of Object.keys(pairs)) {
        const assessment = assessShutdownRecoverySellCoverage({ symbol })
        if (!assessment.covered) {
          findings.push(Object.freeze({
            symbol,
            reason: assessment.reason ?? "RECOVERY_SELL_COVERAGE_INVALID",
            requiredQuantity: assessment.requiredQuantity ?? null,
            committedQuantity: assessment.committedQuantity ?? null,
            requiredPrice: assessment.requiredPrice ?? null,
            committedPrice: assessment.committedPrice ?? null,
            outstandingRecoveryAmount: assessment.outstandingRecoveryAmount ?? null,
            activeSellCount: assessment.activeSellCount ?? 0,
          }))
        }
      }
      return toResult({
        data: Object.freeze({
          covered: findings.length === 0,
          findings: Object.freeze(findings),
        }),
      })
    },
  })


  return Object.freeze({
    reconcileRecoverySellsForShutdown,
    auditShutdownRecoverySellCoverage,
  })
}
