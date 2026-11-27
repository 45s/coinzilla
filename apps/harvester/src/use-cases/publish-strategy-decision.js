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

function resolveRecoveryPosition({ balances, context, symbol } = {}) {
  return balances?.position ?? context.portfolioBefore?.getPosition?.({ symbol })
}

function resolveRecoveryActiveQuantity({ position } = {}) {
  return position?.baseQuantity?.amount ?? "0"
}

function resolveRecoveryResidualQuantity({
  inventoryDisposition,
  position,
  activeQuantity,
  keepQuantity,
  sellAction,
} = {}) {
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

function resolveRecoveryEvidenceStatus({ inventoryDisposition } = {}) {
  return inventoryDisposition?.status ?? "SELL_THROUGH_PLANNED"
}

function resolveRecoveryEvidenceReason({ inventoryDisposition, sellAction, decision } = {}) {
  if (inventoryDisposition?.reason !== undefined) {
    return inventoryDisposition.reason
  }
  if (sellAction?.reason !== undefined) {
    return sellAction.reason
  }
  if (typeof decision.reason === "string" && decision.reason.trim()) {
    return decision.reason
  }
  return "RECOVERY_SELL_THROUGH"
}

function resolveRecoveryEvaluatedPrice({ inventoryDisposition, sellAction, marketPrice } = {}) {
  if (inventoryDisposition?.evaluatedPrice !== undefined) {
    return inventoryDisposition.evaluatedPrice
  }
  if (sellAction?.price !== undefined) {
    return sellAction.price
  }
  return marketPrice.price
}

function resolveRecoveryCandidateQuantity({ inventoryDisposition, sellAction } = {}) {
  if (inventoryDisposition?.evaluatedQuantity !== undefined) {
    return inventoryDisposition.evaluatedQuantity
  }
  return sellAction?.quantity ?? "0"
}

function resolveRecoverySellableQuantity({ sellAction } = {}) {
  return sellAction?.quantity ?? "0"
}

function resolveRecoveryCandidateNotional({ evaluatedPrice, candidateQuantity } = {}) {
  return multiplyDecimal({
    left: evaluatedPrice,
    right: candidateQuantity,
  })
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

function createRecoveryDecisionMeasurements({
  dependencies,
  context,
  balances,
  inventoryDisposition,
  sellAction,
} = {}) {
  const { symbol, marketPrice } = context
  const position = resolveRecoveryPosition({
    balances,
    context,
    symbol,
  })
  const activeQuantity = resolveRecoveryActiveQuantity({ position })
  const keepQuantity = String(dependencies.pairs[symbol].keepQuantity)
  const residualQuantity = resolveRecoveryResidualQuantity({
    inventoryDisposition,
    position,
    activeQuantity,
    keepQuantity,
    sellAction,
  })
  const evaluatedPrice = resolveRecoveryEvaluatedPrice({
    inventoryDisposition,
    sellAction,
    marketPrice,
  })
  const candidateQuantity = resolveRecoveryCandidateQuantity({
    inventoryDisposition,
    sellAction,
  })
  const sellableQuantity = resolveRecoverySellableQuantity({ sellAction })
  const candidateNotional = resolveRecoveryCandidateNotional({
    evaluatedPrice,
    candidateQuantity,
  })
  return {
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
  }
}

function createRecoveryDecisionEvidence({ dependencies, context, balances, allocation } = {}) {
  const { decision, metadata, marketPrice } = context
  const { inventoryDisposition } = decision
  const sellAction = findRecoverySellAction({
    context,
    allocation,
  })
  if (inventoryDisposition === undefined && sellAction === undefined) {
    return undefined
  }
  const measurements = createRecoveryDecisionMeasurements({
    dependencies,
    context,
    balances,
    inventoryDisposition,
    sellAction,
  })
  return {
    status: resolveRecoveryEvidenceStatus({ inventoryDisposition }),
    reason: resolveRecoveryEvidenceReason({
      inventoryDisposition,
      sellAction,
      decision,
    }),
    ...measurements,
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

function createStrategyDecisionInputsWithoutBalances({ context, pairs } = {}) {
  const { symbol, activeOrdersBefore, lastBuyPrice, recoveryLedgerBefore } = context
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

function createStrategyDecisionInputsWithBalances({ context, balances, pairs } = {}) {
  const { symbol, activeOrdersBefore, lastBuyPrice, recoveryLedgerBefore } = context
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

function createStrategyDecisionInputs({ context, balances, pairs } = {}) {
  if (balances === undefined) {
    return createStrategyDecisionInputsWithoutBalances({
      context,
      pairs,
    })
  }
  return createStrategyDecisionInputsWithBalances({
    context,
    balances,
    pairs,
  })
}

/**
 * Publish one strategy decision using the balances and allocation used by the
 * current serialized evaluation. A no-action recovery disposition can be
 * published before completion is attempted.
 *
 * @param {object} input Evaluation dependencies, context, balances and allocation.
 */
function publishStrategyDecisionEvent({ dependencies, context, balances, allocation } = {}) {
  const { eventPublisher, pairs } = dependencies
  const { decision, symbol, marketPrice } = context
  const executableActions = allocation?.executableActions ?? context.effectiveActions ?? []
  const recoveryEvidence = createRecoveryDecisionEvidence({
    dependencies,
    context,
    balances,
    allocation,
  })
  const publication = publishLifecycleEvent({
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
  return {
    eventPublisher,
    publication,
    recoveryEvidence,
  }
}

function assertRecoveryDecisionPublicationSucceeded({ publication } = {}) {
  if (publication?.pending === true) {
    throw new Error("Recovery strategy decision evidence requires synchronous publication")
  }
  if (publication?.ok !== true) {
    throw publication?.errors?.[0] ?? new Error("Recovery strategy decision evidence publication failed")
  }
}

function assertRecoveryDecisionFlushCapability({ eventPublisher } = {}) {
  if (typeof eventPublisher?.flushWrites !== "function") {
    throw new TypeError("Recovery strategy decision evidence requires a write-only durable Journal flush capability")
  }
}

function assertRecoveryDecisionFlushSucceeded({ flushed } = {}) {
  if (flushed?.ok !== true || flushed?.durable !== true) {
    throw flushed?.errors?.[0] ?? new Error("Recovery strategy decision evidence was published but not durably journaled")
  }
}

function createRecoveryDecisionEvidencePersistenceError(error) {
  const failure = new Error("Recovery strategy decision evidence could not be durably persisted", {
    cause: error,
  })
  failure.name = "RecoveryDecisionEvidencePersistenceError"
  failure.code = "RECOVERY_DECISION_EVIDENCE_PERSISTENCE_FAILED"
  return failure
}

async function flushRecoveryDecisionEvidence({ eventPublisher, publication, recoveryEvidence } = {}) {
  if (recoveryEvidence === undefined) {
    return publication
  }
  try {
    assertRecoveryDecisionPublicationSucceeded({ publication })
    assertRecoveryDecisionFlushCapability({ eventPublisher })
    const flushed = await eventPublisher.flushWrites()
    assertRecoveryDecisionFlushSucceeded({ flushed })
    return {
      ok: true,
      durable: true,
    }
  } catch (error) {
    throw createRecoveryDecisionEvidencePersistenceError(error)
  }
}

/**
 * Publish a strategy decision. Recovery decisions await a durable Journal
 * flush before the evaluator may complete recovery or submit a residual SELL.
 *
 * @param {object} input Evaluation dependencies, context, balances and allocation.
 */
export async function publishStrategyDecision(input = {}) {
  const result = publishStrategyDecisionEvent(input)
  return flushRecoveryDecisionEvidence(result)
}
