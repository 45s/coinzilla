import { multiplyDecimal, subtractDecimal } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapStrategyDecisionData } from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

function createFilterConstraints({ metadata } = {}) {
  const constraints = metadata?.tradingRules?.constraints ?? []
  return constraints.map((constraint) => ({
    type: constraint.type,
    status: constraint.status,
    value: constraint.value?.amount ?? null,
    assetCode: constraint.value?.asset?.code ?? null,
  }))
}

function findRecoverySellAction({ context, allocation } = {}) {
  const executableActions = allocation?.executableActions ?? []
  const effectiveActions = context.effectiveActions ?? []
  return executableActions.find((action) => action.side === "SELL") ??
    effectiveActions.find((action) => action.side === "SELL")
}

function resolveRecoveryResidualQuantity({ inventoryDisposition, position, activeQuantity, keepQuantity, sellAction } = {}) {
  if (inventoryDisposition?.quantity !== undefined) {
    return inventoryDisposition.quantity
  }
  if (position?.baseQuantity?.amount !== undefined) {
    return subtractDecimal({
      left: activeQuantity,
      right: keepQuantity,
    })
  }
  return sellAction?.quantity ?? "0"
}

function createRecoveryFilterSnapshot({ metadata, marketPrice } = {}) {
  const constraints = createFilterConstraints({ metadata })
  const capturedAt = metadata?.metadataCapturedAt ?? null
  const captureSource = capturedAt === null ? "EVALUATION_ONLY" : "LOCAL_METADATA_CACHE"
  return {
    capturedAt,
    version: metadata?.metadataVersion ?? null,
    evaluationTimestamp: marketPrice.timestamp ?? null,
    captureSource,
    available: constraints.length > 0,
    constraints,
  }
}

function createRecoveryPlannedSell({ sellAction, decision } = {}) {
  if (sellAction === undefined) {
    return null
  }
  return {
    side: "SELL",
    type: sellAction.type,
    price: sellAction.price,
    quantity: sellAction.quantity,
    notional: multiplyDecimal({
      left: sellAction.price,
      right: sellAction.quantity,
    }),
    reason: sellAction.reason ?? decision.reason ?? "RECOVERY_SELL_THROUGH",
  }
}

function createRecoveryDecisionEvidence({
  dependencies,
  context,
  balances,
  allocation,
} = {}) {
  const { decision, symbol, marketPrice, metadata } = context
  const sellAction = findRecoverySellAction({
    context,
    allocation,
  })
  const inventoryDisposition = decision.inventoryDisposition
  if (inventoryDisposition === undefined && sellAction === undefined) {
    return undefined
  }
  const position = balances?.position ?? context.portfolioBefore?.getPosition?.({ symbol })
  const activeQuantity = position?.baseQuantity?.amount ?? "0"
  const keepQuantity = String(dependencies.pairs[symbol].keepQuantity)
  const residualQuantity = resolveRecoveryResidualQuantity({
    inventoryDisposition,
    position,
    activeQuantity,
    keepQuantity,
    sellAction,
  })
  const evaluatedPrice = inventoryDisposition?.evaluatedPrice ?? sellAction?.price ?? marketPrice.price
  const candidateQuantity = inventoryDisposition?.evaluatedQuantity ?? sellAction?.quantity ?? "0"
  const sellableQuantity = sellAction?.quantity ?? "0"
  const candidateNotional = inventoryDisposition?.evaluatedNotional ??
    multiplyDecimal({
      left: evaluatedPrice,
      right: candidateQuantity,
    })
  return {
    status: inventoryDisposition?.status ?? "SELL_THROUGH_PLANNED",
    reason: inventoryDisposition?.reason ?? sellAction?.reason ?? decision.reason ?? "RECOVERY_SELL_THROUGH",
    activeQuantity,
    keepQuantity,
    residualQuantity,
    candidateQuantity,
    sellableQuantity,
    evaluatedPrice,
    residualNotional: multiplyDecimal({
      left: evaluatedPrice,
      right: residualQuantity,
    }),
    candidateNotional,
    sellableNotional: multiplyDecimal({
      left: evaluatedPrice,
      right: sellableQuantity,
    }),
    inventoryDisposition: inventoryDisposition ?? null,
    plannedSell: createRecoveryPlannedSell({
      sellAction,
      decision,
    }),
    filterSnapshot: createRecoveryFilterSnapshot({
      metadata,
      marketPrice,
    }),
  }
}

function createStrategyDecisionInputs({ context, balances, pairs } = {}) {
  const { symbol, activeOrdersBefore, lastBuyPrice, recoveryLedgerBefore } = context
  if (balances === undefined) {
    const position = context.portfolioBefore?.getPosition?.({ symbol })
    return {
      lastBuyPrice: lastBuyPrice ?? null,
      activeOrderCount: activeOrdersBefore.length,
      activeBuyCount: activeOrdersBefore.filter((order) => order.side === "BUY").length,
      activeSellCount: activeOrdersBefore.filter((order) => order.side === "SELL").length,
      activeBaseQuantity: position?.baseQuantity?.amount ?? "0",
      keepQuantity: String(pairs[symbol].keepQuantity),
      outstandingRecoveryAmount: recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
    }
  }
  const {
    position,
    portfolioBaseBalance,
    quoteBalance,
    baseBalance,
    quoteCashFlow,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
  } = balances
  return {
    lastBuyPrice: lastBuyPrice ?? null,
    activeOrderCount: activeOrdersBefore.length,
    activeBuyCount: activeOrdersBefore.filter((order) => order.side === "BUY").length,
    activeSellCount: activeOrdersBefore.filter((order) => order.side === "SELL").length,
    activeBaseQuantity: position?.baseQuantity.amount ?? "0",
    portfolioBaseBalance,
    freeQuoteBalance: quoteBalance.amount,
    freeBaseBalance: baseBalance.amount,
    quoteCashFlow,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    outstandingRecoveryAmount: recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
    investmentLimit: String(pairs[symbol].investment),
    orderQuantity: String(pairs[symbol].orderQuantity),
    keepQuantity: String(pairs[symbol].keepQuantity),
    priceStepPercent: String(pairs[symbol].priceStepPercent),
    makerPercent: String(pairs[symbol].makerPercent),
    takerPercent: String(pairs[symbol].takerPercent),
    minProfit: String(pairs[symbol].minProfit),
  }
}

/**
 * Publish one strategy decision using the balances and allocation used by the
 * current serialized evaluation. A no-action recovery disposition can be
 * published before completion is attempted.
 *
 * @param {object} input Evaluation dependencies, context, balances and allocation.
 */
export function publishStrategyDecision({ dependencies, context, balances, allocation } = {}) {
  const { eventPublisher, pairs } = dependencies
  const { decision, symbol, marketPrice } = context
  const executableActions = allocation?.executableActions ?? context.effectiveActions ?? []
  const recoveryEvidence = createRecoveryDecisionEvidence({
    dependencies,
    context,
    balances,
    allocation,
  })
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STRATEGY_DECISION,
    dataResult: mapStrategyDecisionData({
      strategy: decision.strategy ?? "CONSERVATIVE",
      symbol,
      referencePrice: marketPrice.price,
      reason: decision.reason ?? executableActions[0]?.reason ?? recoveryEvidence?.reason,
      inputs: createStrategyDecisionInputs({
        context,
        balances,
        pairs,
      }),
      actions: executableActions,
      ...(recoveryEvidence === undefined ? {} : { recoveryEvidence }),
    }),
  })
}
