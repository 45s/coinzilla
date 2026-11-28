import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createMarketVolatilityProtectionEligibility } from "../domain/market/create-market-volatility-protection-eligibility.js"
import { createMarketComponentLogger } from "../application/logging/create-market-component-logger.js"
import { linkSharedAccountOrderRegistry } from "../application/providers/account-runtime-registry.js"
import { createPositionId } from "../domain/portfolio/position.js"
import { validateStrategySubmissionOwnership } from "../domain/orders/recovery-seller-submission-ownership.js"
import { createStrategyLogger } from "../application/logging/create-strategy-logger.js"
import { CanonicalOrder, Fill, Quantity } from "@coinzilla/entities"
import { addDecimal, assertDecimalString, compareDecimal, divideDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { isCanonicalNonNegativeSafeInteger } from "../domain/time/is-canonical-non-negative-safe-integer.js"
import { EXTERNAL_ORDERS_POLICIES } from "../domain/external-orders-policy.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"
import { createRecoverySellerOrderSubmitter } from "./create-recovery-seller-order-submitter.js"
import { createRecoverySellerActionAuthorizer } from "./create-recovery-seller-action-authorizer.js"
import { makeCollectOwnedOrderSnapshots } from "./collect-owned-order-snapshots.js"
import { makeOrderEventWorkflow } from "./order-event-workflow.js"
import { makeVolatilityProtectionWorkflow } from "./volatility-protection-workflow.js"
import { createSubmissionGate } from "./create-submission-gate.js"
import { createShutdownRecoveryWorkflow } from "./create-shutdown-recovery-workflow.js"
import { createConservativeShutdownSafety } from "./create-conservative-shutdown-safety.js"
import { createLatestTransitionEvaluator } from "./create-latest-transition-evaluator.js"
import { createMarketMetadataCache } from "./create-market-metadata-cache.js"
import { MarketMetadataRefreshError } from "./market-metadata-refresh-error.js"
import { createFreshMarketPriceWaiter, createMarketPriceTransitionHandler } from "./create-market-price-transition-handler.js"
import { validateConservativeTradingEngineOptions } from "./validate-conservative-trading-engine-options.js"
import { failureResult, recoveryFailureError, withFailure } from "./recovery-failure.js"
import { OperatorBuyCancellationIncompleteError } from "./errors/operator-buy-cancellation-incomplete-error.js"
import { StrategySafetyPauseIncompleteError } from "./errors/strategy-safety-pause-incomplete-error.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderCancellationRequestedData,
  mapOrderSubmissionFailedData,
  mapOrderSubmissionDeferredData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapRecoveryCycleCompletedData,
  mapRecoveryCycleNotCompletedData,
  mapStrategyPausedData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { logOrderLifecycle } from "../application/logging/order-lifecycle-log.js"
import { validateCancellationEligibility } from "../domain/orders/validate-cancellation-eligibility.js"
import { allocateOrderCommitments } from "../domain/orders/allocate-order-commitments.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import {
  createVolatilityProtectionState,
  VOLATILITY_PROTECTION_MODES,
} from "../domain/market/volatility-protection-state.js"

export function createMarketBook({ bookTicker } = {}) {
  if (!bookTicker || typeof bookTicker !== "object" || Array.isArray(bookTicker)) {
    throw new TypeError("createMarketBook requires a normalized bookTicker object")
  }
  const { symbol, timestamp } = bookTicker
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("Market book symbol must be a non-empty uppercase symbol")
  }
  if (!isCanonicalNonNegativeSafeInteger(timestamp)) {
    throw new TypeError("Market book timestamp must be a non-negative safe integer other than negative zero")
  }
  const positive = ({ value, field }) => {
    assertDecimalString({ value,
field })
    if (compareDecimal({ left: value,
right: "0" }) <= 0) {throw new RangeError(`${field  } must be positive`)}
    return value
  }
  const bestBidPrice = positive({ value: bookTicker.bestBidPrice, 
    
    field: "bestBidPrice" })
  
  const bestBidQuantity = positive({ value: bookTicker.bestBidQuantity, 
    field: "bestBidQuantity" })
  
  const bestAskPrice = positive({ value: bookTicker.bestAskPrice, 
    field: "bestAskPrice" })
  const bestAskQuantity = positive({ value: bookTicker.bestAskQuantity, 
    field: "bestAskQuantity" })
  if (compareDecimal({ left: bestBidPrice,
right: bestAskPrice }) >= 0) {
    throw new RangeError("Market book best bid must be below best ask")
  }
  return Object.freeze({ symbol,
bestBidPrice,
bestBidQuantity,
bestAskPrice,
bestAskQuantity,
timestamp })
}

export function isPostOnlyOrderCrossing({ order, marketBook } = {}) {
  if (order?.type !== "LIMIT_MAKER") {return false}
  if (!marketBook || order.market?.symbol !== marketBook.symbol) {
    throw new TypeError("Post-only order and market book must refer to the same symbol")
  }
  const price = order.limitPrice?.amount
  assertDecimalString({ value: price,
field: "post-only limit price" })
  if (order.side === "BUY") {return compareDecimal({ left: price,
right: marketBook.bestAskPrice }) >= 0}
  if (order.side === "SELL") {return compareDecimal({ left: price,
right: marketBook.bestBidPrice }) <= 0}
  throw new TypeError("Post-only order side must be BUY or SELL")
}

/** Coordinate an injected strategy policy, in-process order ownership, and actual fills. */
function createRecoveryManagedCancellationState({ state } = {}) {
  const hasPendingRecoveryManagedCancellation = ({ symbol, side } = {}) =>
    [...state.recoveryManagedCancellationClientOrderIds].some((clientOrderId) => {
      const order = state.registry.getOrder({ clientOrderId })
      return order?.market.symbol === symbol && (side === undefined || order.side === side)
    })
  const releaseRecoveryManagedPause = ({ symbol } = {}) => {
    if (
      !state.recoveryManagedPausedMarkets.has(symbol) ||
      hasPendingRecoveryManagedCancellation({ symbol }) ||
      state.durablePausedMarkets.has(symbol) ||
      state.replacementIntents.has(symbol) ||
      state.trailingBuyRepriceIntents.has(symbol)
    ) {
      return false
    }
    state.recoveryManagedPausedMarkets.delete(symbol)
    state.paused.delete(symbol)
    return true
  }
  const resolveRecoveryManagedCancellation = ({ order } = {}) => {
    if (!state.recoveryManagedCancellationClientOrderIds.delete(order.clientOrderId)) {
      return false
    }
    const { market: { symbol } } = order
    if (order.side === "SELL" &&
        !hasPendingRecoveryManagedCancellation({ symbol,
side: "SELL" })) {
      state.replacementIntents.delete(symbol)
    }
    if (order.side === "BUY" &&
        !hasPendingRecoveryManagedCancellation({ symbol,
side: "BUY" })) {
      state.trailingBuyRepriceIntents.delete(symbol)
    }
    releaseRecoveryManagedPause({ symbol })
    return true
  }
  return {
    hasPendingRecoveryManagedCancellation,
    releaseRecoveryManagedPause,
    resolveRecoveryManagedCancellation,
  }
}

function createProcessedFillTracker({ state } = {}) {
  return ({ fill }) => {
    const fillIds = state.processedFillIdsByOrder.get(fill.brokerOrderId) ?? new Set()
    if (fillIds.has(fill.id)) {
      return false
    }
    fillIds.add(fill.id)
    state.processedFillIdsByOrder.set(fill.brokerOrderId, fillIds)
    const fills = state.processedFillsByOrder.get(fill.brokerOrderId) ?? new Map()
    fills.set(fill.id, fill)
    state.processedFillsByOrder.set(fill.brokerOrderId, fills)
    return true
  }
}

function createExecutionFillRecorder({
  rememberProcessedFill,
  totalsByOrder,
  includeQuoteQuantity = false,
} = {}) {
  return ({ fill }) => {
    if (!rememberProcessedFill({ fill })) {
      return
    }
    const current = totalsByOrder.get(fill.brokerOrderId) ?? {
      quantity: "0",
      ...(includeQuoteQuantity ? { quoteQuantity: "0" } : {}),
      fillIds: new Set(),
    }
    current.quantity = addDecimal({ left: current.quantity,
right: fill.quantity.amount })
    if (includeQuoteQuantity) {
      current.quoteQuantity = addDecimal({ left: current.quoteQuantity,
right: fill.quoteQuantity.amount })
    }
    current.fillIds.add(fill.id)
    totalsByOrder.set(fill.brokerOrderId, current)
  }
}

function createExecutionFillAccounting({ state, rememberProcessedFill } = {}) {
  const recordBuyExecutionFill = createExecutionFillRecorder({
    rememberProcessedFill,
    totalsByOrder: state.buyExecutionTotals,
    includeQuoteQuantity: true,
  })
  const recordSellExecutionFill = createExecutionFillRecorder({
    rememberProcessedFill,
    totalsByOrder: state.sellExecutionTotals,
  })
  const getReconciledBuyExecutionPrice = ({ order }) => {
    const totals = state.buyExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({ left: totals.quantity,
right: order.executedQuantity.amount }) !== 0 ||
        compareDecimal({ left: order.executedQuantity.amount,
right: order.originalQuantity.amount }) !== 0) {
      throw new Error("Completed BUY execution history does not reconcile with the filled order quantity")
    }
    return divideDecimal({
      left: totals.quoteQuantity,
      right: totals.quantity,
      scale: 18,
      rounding: "half-up",
    })
  }
  const assertReconciledSellExecution = ({ order }) => {
    const totals = state.sellExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({ left: totals.quantity,
right: order.executedQuantity.amount }) !== 0 ||
        compareDecimal({ left: order.executedQuantity.amount,
right: order.originalQuantity.amount }) !== 0) {
      throw new Error("Completed recovery SELL execution history does not reconcile with the filled order quantity")
    }
  }
  return {
    recordBuyExecutionFill,
    getReconciledBuyExecutionPrice,
    recordSellExecutionFill,
    assertReconciledSellExecution,
  }
}

function observeDurableIntentPublication({ published, eventName, dataResult } = {}) {
  if (published?.pending === true ||
      (published && typeof published.then === "function")) {
    // A custom asynchronous EventBus observer is optional for an initial BUY:
    // do not await it or turn an otherwise durable operational submission into
    // a failure. Recovery SELL and cancellation intents remain fail-closed,
    // because their Journal evidence must exist before changing exchange state.
    if (eventName === HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED &&
        dataResult?.data?.side === "BUY") {
      return toResult({ data: { skipped: true } })
    }
    return toResult({
      error: new TypeError("Durable recovery lifecycle intent publication must complete synchronously before Journal flush"),
    })
  }
  if (published?.ok === false) {
    return published
  }
  if (published?.skipped === true) {
    return toResult({ data: { skipped: true } })
  }
  return undefined
}

async function flushDurableIntent({ eventPublisher }) {
  if (typeof eventPublisher?.flushWrites !== "function") {
    return toResult({
      error: new TypeError("Trading intent requires a durable Journal write-only flush capability"),
    })
  }
  try {
    const flushed = await eventPublisher.flushWrites()
    if (flushed?.ok !== true || flushed?.durable !== true) {
      return flushed?.ok === false
        ? flushed
        : toResult({ error: new Error("Trading intent was published but not durably journaled") })
    }
    return toResult({ data: { durable: true } })
  } catch (error) {
    return toResult({ error })
  }
}

function createDurableIntentPublisher({ eventPublisher } = {}) {
  return async ({ eventName, dataResult } = {}) => {
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName,
      dataResult,
    })
    const publicationResult = observeDurableIntentPublication({
      published,
      eventName,
      dataResult,
    })
    if (publicationResult) {
      return publicationResult
    }
    return flushDurableIntent({ eventPublisher })
  }
}


function createRecoveryCycleNotCompletedFacts({
  data,
  order,
  getPortfolio,
  getRecoveryLedger,
  pairs,
}) {
  const marketId = order.market.id
  const portfolio = typeof getPortfolio === "function" ? getPortfolio() : undefined
  const position = portfolio?.getPosition({
    strategyId: StrategyId.COIN_GRABBER,
    marketId,
  })
  const recoveryLedger = typeof getRecoveryLedger === "function"
    ? getRecoveryLedger({ marketId })
    : undefined
  const realizedNetProfit = data.realizedNetProfit ?? (
    position && recoveryLedger
      ? subtractDecimal({
        left: recoveryLedger.netSellProceeds,
        right: position.spent.amount,
      })
      : undefined
  )
  return {
    marketId,
    realizedNetProfit,
    activeQuantity: data.activeQuantity ?? position?.baseQuantity.amount,
    keepQuantity: data.keepQuantity ?? String(pairs[order.market.symbol].keepQuantity),
    minProfit: data.minProfit ?? String(pairs[order.market.symbol].minProfit),
  }
}

function getRecoveryCycleNotCompletedOutcome({ data }) {
  const continueReasons = [
    "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
  ]
  return data.pause === false && continueReasons.includes(data.reason)
    ? "CONTINUE_SELL_THROUGH"
    : "BLOCKED"
}

function createRecoveryCycleNotCompletedData({
  order,
  completion,
  getPortfolio,
  getRecoveryLedger,
  pairs,
}) {
  const data = completion?.data
  if (!data) {
    return undefined
  }
  const facts = createRecoveryCycleNotCompletedFacts({
    data,
    order,
    getPortfolio,
    getRecoveryLedger,
    pairs,
  })
  if ([facts.realizedNetProfit, facts.activeQuantity, facts.keepQuantity, facts.minProfit]
    .some((value) => value === undefined)) {
    return undefined
  }
  return mapRecoveryCycleNotCompletedData({
    symbol: order.market.symbol,
    marketId: facts.marketId,
    sellOrderClientId: order.clientOrderId,
    sellOrderBrokerOrderId: order.brokerOrderId,
    outcome: getRecoveryCycleNotCompletedOutcome({ data }),
    reason: data.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
    realizedNetProfit: facts.realizedNetProfit,
    activeQuantity: facts.activeQuantity,
    keepQuantity: facts.keepQuantity,
    minProfit: facts.minProfit,
  })
}


function createRecoveryCycleNotCompletedPublisher({
  eventPublisher,
  getPortfolio,
  getRecoveryLedger,
  pairs,
} = {}) {
  return ({ order, completion }) => {
    const dataResult = createRecoveryCycleNotCompletedData({
      order,
      completion,
      getPortfolio,
      getRecoveryLedger,
      pairs,
    })
    if (!dataResult) {
      return undefined
    }
    return publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_NOT_COMPLETED,
      dataResult,
    })
  }
}


function readActiveStrategySafetyPauseBuyOrders({ state, symbol }) {
  return state.registry.getActiveOrders()
    .filter((order) => order.market?.symbol === symbol && order.side === "BUY")
    .map((order) => Object.freeze({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId ?? null,
      status: order.status,
    }))
}

async function persistStrategySafetyPauseFact({ callback, symbol, reason, error }) {
  if (typeof callback !== "function") {
    return {
      persisted: null,
      errors: [],
    }
  }
  try {
    const result = await callback({
      symbol,
      reason,
      ...(error === undefined ? {} : { error }),
    })
    const persisted = result?.ok === true && result.data?.durable === true
    return {
      persisted,
      errors: persisted ? [] : result?.errors ?? [new Error("Strategy safety pause fact was not durably committed")],
    }
  } catch (pauseError) {
    return {
      persisted: false,
      errors: [pauseError],
    }
  }
}

async function publishStrategySafetyPauseEvent({
  callback,
  eventPublisher,
  symbol,
  reason,
  error,
}) {
  if (typeof eventPublisher?.publish !== "function") {
    return {
      published: null,
      errors: [],
    }
  }
  try {
    const result = await callback({
      symbol,
      reason,
      error,
    })
    const published = result?.ok === true
    return {
      published,
      errors: published ? [] : result?.errors ?? [new Error("Strategy safety pause event publication failed")],
    }
  } catch (publicationError) {
    return {
      published: false,
      errors: [publicationError],
    }
  }
}

function getReusableStrategySafetyPauseBlocker({ previousStatus } = {}) {
  if (previousStatus?.blockerPersisted !== true) {
    return undefined
  }
  return {
    persisted: true,
    blockerId: previousStatus.blockerId,
    errors: [],
  }
}

function createStrategySafetyPauseBlockerEvidence({
  pauseReason,
  pauseFactPersisted,
  pauseEventPublished,
  cancellationResult,
  unresolvedOrders,
  failures,
}) {
  return {
    pauseReason,
    pauseFactPersisted,
    pauseEventPublished,
    cancellationSucceeded: cancellationResult?.ok === true,
    unresolvedOrderReferences: unresolvedOrders.map((order) => (
      `${order.clientOrderId}:${order.brokerOrderId ?? "UNKNOWN"}:${order.status}`
    )).sort(),
    failureCodes: failures.map((failure) => failure.code ?? failure.name ?? "ERROR").sort(),
  }
}

function getStrategySafetyPauseBlockerId({ result } = {}) {
  return result?.data?.record?.data?.blockerId ?? result?.data?.blockerId ?? null
}

function classifyStrategySafetyPauseBlockerResult({ result } = {}) {
  const persisted = result?.ok === true && result.data?.durable === true
  return {
    persisted,
    blockerId: getStrategySafetyPauseBlockerId({ result }),
    errors: persisted
      ? []
      : result?.errors ?? [new Error("Strategy safety-pause blocker was not durably committed")],
  }
}

async function persistStrategySafetyPauseBlocker({
  callback,
  previousStatus,
  symbol,
  pauseReason,
  pauseFactPersisted,
  pauseEventPublished,
  cancellationResult,
  unresolvedOrders,
  failures,
}) {
  const reusable = getReusableStrategySafetyPauseBlocker({ previousStatus })
  if (reusable) {
    return reusable
  }
  if (typeof callback !== "function") {
    return {
      persisted: null,
      blockerId: null,
      errors: [],
    }
  }
  const evidence = createStrategySafetyPauseBlockerEvidence({
    pauseReason,
    pauseFactPersisted,
    pauseEventPublished,
    cancellationResult,
    unresolvedOrders,
    failures,
  })
  try {
    const result = await callback({
      scope: "MARKET",
      symbol,
      reason: "STRATEGY_SAFETY_PAUSE_INCOMPLETE",
      evidence,
    })
    return classifyStrategySafetyPauseBlockerResult({ result })
  } catch (blockerError) {
    return {
      persisted: false,
      blockerId: null,
      errors: [blockerError],
    }
  }
}

function createStrategySafetyPauseStatus({
  symbol, reason, complete, pauseFactPersisted, pauseEventPublished,
  cancellationResult, unresolvedOrders, blocker, failures, status,
}) {
  return Object.freeze({
    symbol,
    reason,
    status: status ?? (complete ? "COMPLETE" : "INCOMPLETE"),
    pauseFactPersisted,
    pauseEventPublished,
    canceled: cancellationResult?.data?.canceled ?? 0,
    reconciled: cancellationResult?.data?.reconciled ?? 0,
    unresolvedOrders: Object.freeze(unresolvedOrders),
    blockerPersisted: blocker.persisted,
    blockerId: blocker.blockerId,
    incompleteReasons: Object.freeze([...new Set(
      failures.map((failure) => failure.message ?? String(failure)),
    )]),
  })
}

async function prepareStrategySafetyPause({
  state, symbol, reason, error, previousStatus,
  onOperationalStateStrategyMarketPaused, publishStrategyPaused, eventPublisher,
}) {
  const wasPaused = state.durablePausedMarkets.has(symbol)
  state.paused.add(symbol)
  state.durablePausedMarkets.add(symbol)
  let pauseFactPersisted = previousStatus?.pauseFactPersisted ?? null
  let pauseEventPublished = previousStatus?.pauseEventPublished ?? null
  const failures = []
  if (!wasPaused) {
    const fact = await persistStrategySafetyPauseFact({
      callback: onOperationalStateStrategyMarketPaused,
      symbol,
      reason,
      error,
    })
    pauseFactPersisted = fact.persisted
    failures.push(...fact.errors)
    const publication = await publishStrategySafetyPauseEvent({
      callback: publishStrategyPaused,
      eventPublisher,
      symbol,
      reason,
      error,
    })
    pauseEventPublished = publication.published
    failures.push(...publication.errors)
  }
  if (previousStatus?.status === "INCOMPLETE") {
    failures.push(new Error("Previous strategy safety-pause blocker requires explicit reconciliation"))
  }
  if (pauseFactPersisted === false) {
    failures.push(new Error("Strategy safety pause fact persistence is incomplete"))
  }
  if (pauseEventPublished === false) {
    failures.push(new Error("Strategy safety pause event publication is incomplete"))
  }
  return {
    pauseFactPersisted,
    pauseEventPublished,
    failures,
  }
}

async function cancelStrategySafetyPauseBuys({ symbol, cancelOwnedBuyOrdersWithinTransition }) {
  try {
    return await cancelOwnedBuyOrdersWithinTransition({
      symbol,
      reason: "STRATEGY_SAFETY_PAUSE",
      pauseOnFailure: false,
    })
  } catch (cancellationError) {
    return toResult({ error: cancellationError })
  }
}

function collectStrategySafetyPauseFinalizationFacts({
  state,
  symbol,
  prepared,
  cancellationResult,
  cancellationRequired,
}) {
  const failures = [...prepared.failures]
  if (cancellationResult?.ok !== true) {
    failures.push(...(
      cancellationResult?.errors ?? [new Error("Owned BUY cancellation did not complete")]
    ))
  }
  const unresolvedOrders = cancellationRequired
    ? readActiveStrategySafetyPauseBuyOrders({
      state,
      symbol,
    })
    : []
  if (unresolvedOrders.length > 0) {
    failures.push(new Error("One or more current-process-owned BUY orders remain unresolved"))
  }
  return {
    failures,
    unresolvedOrders,
    complete: failures.length === 0 && unresolvedOrders.length === 0,
  }
}

async function finalizeStrategySafetyPause({
  state,
  symbol,
  reason,
  previousStatus,
  prepared,
  cancellationResult,
  onSafetyBlockerRaised,
  cancellationRequired,
}) {
  const facts = collectStrategySafetyPauseFinalizationFacts({
    state,
    symbol,
    prepared,
    cancellationResult,
    cancellationRequired,
  })
  const blocker = facts.complete
    ? {
      persisted: null,
      blockerId: null,
      errors: [],
    }
    : await persistStrategySafetyPauseBlocker({
      callback: onSafetyBlockerRaised,
      previousStatus,
      symbol,
      pauseReason: reason,
      pauseFactPersisted: prepared.pauseFactPersisted,
      pauseEventPublished: prepared.pauseEventPublished,
      cancellationResult,
      unresolvedOrders: facts.unresolvedOrders,
      failures: facts.failures,
    })
  facts.failures.push(...blocker.errors)
  const status = createStrategySafetyPauseStatus({
    symbol,
    reason,
    complete: facts.complete,
    pauseFactPersisted: prepared.pauseFactPersisted,
    pauseEventPublished: prepared.pauseEventPublished,
    cancellationResult,
    unresolvedOrders: facts.unresolvedOrders,
    blocker,
    failures: facts.failures,
    status: !cancellationRequired && facts.complete ? "NOT_REQUIRED" : undefined,
  })
  state.strategySafetyPauseStatuses.set(symbol, status)
  return {
    complete: facts.complete,
    status,
    failures: facts.failures,
    unresolvedOrders: facts.unresolvedOrders,
  }
}

async function notifyStrategySafetyPause({
  onPause,
  logger,
  symbol,
  reason,
  error,
  result,
}) {
  if (!result.complete) {
    logger?.error?.({
      message: "Conservative strategy safety pause is incomplete",
      symbol,
      reason,
      status: result.status,
      errors: result.failures,
    })
  }
  try {
    await onPause?.({
      symbol,
      reason,
      error,
      status: result.status,
    })
  } catch (notificationError) {
    logger?.error?.({
      message: "Unable to notify Harvester about strategy safety pause",
      symbol,
      reason,
      error: notificationError,
    })
  }
}

function recordStrategySafetyPauseInProgressStatus({
  state,
  symbol,
  reason,
  prepared,
  cancellationRequired,
}) {
  const status = createStrategySafetyPauseStatus({
    symbol,
    reason,
    complete: false,
    pauseFactPersisted: prepared.pauseFactPersisted,
    pauseEventPublished: prepared.pauseEventPublished,
    cancellationResult: null,
    unresolvedOrders: readActiveStrategySafetyPauseBuyOrders({
      state,
      symbol,
    }),
    blocker: {
      persisted: null,
      blockerId: null,
    },
    failures: prepared.failures,
    status: cancellationRequired ? "CANCELLING" : "NOT_REQUIRED",
  })
  state.strategySafetyPauseStatuses.set(symbol, status)
}

const NON_CANCELLING_STRATEGY_PAUSE_REASONS = new Set([
  "STRATEGY_ORDER_VALIDATION_FAILED",
  "RECOVERY_SELL_FILTERS_UNAVAILABLE",
  "TRAILING_BUY_REPLACEMENT_RULES_UNAVAILABLE",
  "TRAILING_BUY_REPLACEMENT_VALIDATION_FAILED",
])

const CANCELLING_STRATEGY_PAUSE_REASONS = new Set([
  "STRATEGY_EVALUATION_FAILED",
  "ORDER_INTENT_NOT_DURABLE",
  "ORDER_SUBMISSION_UNKNOWN",
  "ACCOUNT_INTEGRITY_FAILURE",
  "CANCELED_ORDER_NOT_REGISTERED",
  "RECONCILIATION_PENDING_ORDER_OUTCOME",
  "RECOVERY_DECISION_EVIDENCE_PERSISTENCE_FAILED",
])

function shouldCancelOwnedBuysForStrategyPause({ reason, error } = {}) {
  const retryableTransportFailure = error?.recoveryFailure?.retryable === true ||
    error?.retryable === true ||
    error?.code === "RPC_TIMEOUT" ||
    error?.name === "RpcTimeoutError"
  if (retryableTransportFailure) {
    return false
  }
  if (typeof reason !== "string" || NON_CANCELLING_STRATEGY_PAUSE_REASONS.has(reason)) {
    return false
  }
  if (CANCELLING_STRATEGY_PAUSE_REASONS.has(reason) || reason.endsWith("_UNCONFIRMED")) {
    return true
  }
  return [
    "ACKNOWLEDGED_",
    "REST_",
    "RECOVERY_SELL_",
    "TRAILING_BUY_",
    "EXECUTION_",
    "TERMINAL_ORDER_",
    "RS_TERMINAL_",
    "ACCOUNTING_",
  ].some((prefix) => reason.startsWith(prefix))
}

async function prepareAndCancelStrategySafetyPause({
  dependencies,
  input,
  previousStatus,
}) {
  const {
    state,
    onOperationalStateStrategyMarketPaused,
    publishStrategyPaused,
    eventPublisher,
    cancelOwnedBuyOrdersWithinTransition,
  } = dependencies
  const { symbol, reason, error } = input
  const prepared = await prepareStrategySafetyPause({
    state,
    symbol,
    reason,
    error,
    previousStatus,
    onOperationalStateStrategyMarketPaused,
    publishStrategyPaused,
    eventPublisher,
  })
  const cancellationRequired = shouldCancelOwnedBuysForStrategyPause({
    reason,
    error,
  })
  recordStrategySafetyPauseInProgressStatus({
    state,
    symbol,
    reason,
    prepared,
    cancellationRequired,
  })
  const cancellationResult = cancellationRequired
    ? await cancelStrategySafetyPauseBuys({
      symbol,
      cancelOwnedBuyOrdersWithinTransition,
    })
    : toResult({
      data: {
        canceled: 0,
        reconciled: 0,
        notRequired: true,
      },
    })
  return {
    prepared,
    cancellationRequired,
    cancellationResult,
  }
}

async function executeStrategySafetyPause({ dependencies, input } = {}) {
  const { state, logger, onPause, onSafetyBlockerRaised } = dependencies
  const { symbol, reason, error } = input
  const previousStatus = state.strategySafetyPauseStatuses.get(symbol)
  if (state.strategySafetyPauseCancellationInProgress.has(symbol)) {
    return toResult({
      data: previousStatus ?? {
        symbol,
        reason,
        status: "CANCELLING",
      },
    })
  }
  state.strategySafetyPauseCancellationInProgress.add(symbol)
  try {
    const preparedResult = await prepareAndCancelStrategySafetyPause({
      dependencies,
      input,
      previousStatus,
    })
    const result = await finalizeStrategySafetyPause({
      state,
      symbol,
      reason,
      previousStatus,
      prepared: preparedResult.prepared,
      cancellationResult: preparedResult.cancellationResult,
      onSafetyBlockerRaised,
      cancellationRequired: preparedResult.cancellationRequired,
    })
    await notifyStrategySafetyPause({
      onPause,
      logger,
      symbol,
      reason,
      error,
      result,
    })
    if (!result.complete) {
      return toResult({
        error: new StrategySafetyPauseIncompleteError({
          symbol,
          reason,
          unresolvedOrderCount: result.unresolvedOrders.length,
          failureCount: result.failures.length,
          cause: result.failures[0] ?? error,
        }),
      })
    }
    return toResult({ data: result.status })
  } finally {
    state.strategySafetyPauseCancellationInProgress.delete(symbol)
  }
}

function createPauseHandler({
  state, logger, onPause, onOperationalStateStrategyMarketPaused,
  onSafetyBlockerRaised, publishStrategyPaused, eventPublisher,
  cancelOwnedBuyOrdersWithinTransition,
} = {}) {
  const dependencies = {
    state,
    logger,
    onPause,
    onOperationalStateStrategyMarketPaused,
    onSafetyBlockerRaised,
    publishStrategyPaused,
    eventPublisher,
    cancelOwnedBuyOrdersWithinTransition,
  }
  return (input = {}) => executeStrategySafetyPause({
    dependencies,
    input,
  })
}

function createOrderCancellationEventPublishers({ eventPublisher, logger, state } = {}) {
  return {
    publishOrderCancelled: ({ order }) => {
      const ownership = state?.registry?.getOwnership?.({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        marketId: order.market.id,
      })
      logOrderLifecycle({
        logger,
        order,
        ownership,
        status: "CANCELLED",
      })
      return publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLED,
        dataResult: mapOrderCancelledData({
          order,
          ownership,
        }),
      })
    },
    publishOrderCancelFailed: ({ order, outcome, error }) => {
      let lifecycleStatus = "CANCEL_FAILED"
      if (outcome === "NOT_SENT") {
        lifecycleStatus = "CANCEL_NOT_SENT"
      } else if (["UNCONFIRMED", "OUTCOME_UNKNOWN", "UNKNOWN"].includes(outcome)) {
        lifecycleStatus = "CANCEL_UNKNOWN"
      }
      const ownership = state?.registry?.getOwnership?.({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        marketId: order.market.id,
      })
      logOrderLifecycle({
        logger,
        order,
        ownership,
        status: lifecycleStatus,
      })
      return publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED,
        dataResult: mapOrderCancelFailedData({
          order,
          ownership,
          outcome,
          error,
        }),
      })
    },
  }
}

function createMarkCancellationUnknownHandler({ state, pause, publishOrderCancelFailed } = {}) {
  return async ({ symbol, order, reason, error, pauseOnFailure = true } = {}) => {
    const result = state.registry.markCancellationUnknown({ clientOrderId: order.clientOrderId })
    if (!result.ok) {
      const registryError = result.errors?.[0] ?? new Error("Unable to retain an unconfirmed cancellation as UNKNOWN")
      await pause({ symbol,
reason: `${reason  }_REGISTRY_FAILED`,
error: registryError })
      return toResult({ errors: result.errors ?? [registryError] })
    }
    state.registry = result.data.registry
    publishOrderCancelFailed({ order: result.data.order,
outcome: "UNCONFIRMED",
error })
    if (pauseOnFailure) {
      await pause({ symbol,
reason,
error })
    }
    return toResult({ error: error ?? new Error("Broker cancellation outcome is unconfirmed") })
  }
}

function createMarkCancellationNotSentHandler({ pause, publishOrderCancelFailed } = {}) {
  return async ({ symbol, order, reason, error, pauseOnFailure = true } = {}) => {
    publishOrderCancelFailed({ order,
outcome: "NOT_SENT",
error })
    const notSentReason = reason.replace(/_UNCONFIRMED$/, "_NOT_SENT")
    if (pauseOnFailure) {
      await pause({ symbol,
reason: notSentReason,
error })
    }
    return toResult({ error: error ?? new Error("Broker cancellation request was not sent") })
  }
}

function createMarkCancellationFailureHandler({ markCancellationUnknown, markCancellationNotSent } = {}) {
  return async ({
    symbol,
    order,
    reason,
    error,
    cancellationResultOk,
    cancellationOutcome,
    pauseOnFailure = true,
  } = {}) => {
    if (cancellationResultOk === false && cancellationOutcome === "NOT_SENT") {
      return markCancellationNotSent({ symbol,
order,
reason,
error,
pauseOnFailure })
    }
    return markCancellationUnknown({ symbol,
order,
reason,
error,
pauseOnFailure })
  }
}

function createCancellationFailureHandlers({ state, pause, publishOrderCancelFailed } = {}) {
  const markCancellationUnknown = createMarkCancellationUnknownHandler({
    state,
    pause,
    publishOrderCancelFailed,
  })
  const markCancellationNotSent = createMarkCancellationNotSentHandler({
    pause,
    publishOrderCancelFailed,
  })
  return {
    markCancellationUnknown,
    markCancellationNotSent,
    markCancellationFailure: createMarkCancellationFailureHandler({
      markCancellationUnknown,
      markCancellationNotSent,
    }),
  }
}

function createMarketBookTransitionHandler({ state, isMarketBookFresh, evaluateLatestTransition } = {}) {
  return async ({ symbol, bookTicker } = {}) => {
    try {
      const marketBook = createMarketBook({ bookTicker })
      if (marketBook.symbol !== symbol) {
        throw new Error("Market book symbol does not match subscription")
      }
      if (!isMarketBookFresh(marketBook)) {
        return toResult({ data: { skipped: true,
reason: "STALE_MARKET_BOOK" } })
      }
      state.books.set(symbol, marketBook)
      if (state.deferredEvaluations.has(symbol) && !state.paused.has(symbol)) {
        return evaluateLatestTransition({ symbol })
      }
      return toResult({ data: { updated: true } })
    } catch (error) {
      state.books.delete(symbol)
      return toResult({ error })
    }
  }
}

function createOperatorMarketPauseHandler({ state, pairs, runTransition } = {}) {
  return ({ symbol, beforeApply } = {}) => runTransition({
    task: async () => {
      if (typeof symbol !== "string" || !Object.hasOwn(pairs, symbol)) {
        const error = new TypeError("Operator pause requires a configured market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        return toResult({ error })
      }
      if (state.operatorPausedMarkets.has(symbol)) {
        return toResult({ data: { symbol,
paused: true,
alreadyPaused: true,
durable: typeof beforeApply === "function" } })
      }
      let durable = false
      if (typeof beforeApply === "function") {
        let committed
        try {
          committed = await beforeApply({ symbol,
action: "PAUSE" })
        } catch (error) {
          return toResult({ error })
        }
        if (committed?.ok !== true || committed?.data?.durable !== true) {
          return committed?.ok === false
            ? committed
            : toResult({ error: new Error("Operator pause fact was not durably committed") })
        }
        durable = true
      } else {
        // TEMPORARY: with restart recovery disabled, CC pause is process-local only.
      }
      state.operatorPausedMarkets.add(symbol)
      return toResult({ data: { symbol,
paused: true,
alreadyPaused: false,
durable } })
    },
  })
}

function isOperatorResumeBlocked({ state, symbol, volatilityProtectionEnabled, hasPendingRecoveryManagedCancellation }) {
  const volatilityState = state.volatilityProtection.get(symbol)
  const volatilityBlocked = volatilityProtectionEnabled &&
    volatilityState !== undefined &&
    volatilityState.mode !== VOLATILITY_PROTECTION_MODES.NORMAL
  return state.paused.has(symbol) ||
    state.durablePausedMarkets.has(symbol) ||
    state.recoveryManagedPausedMarkets.has(symbol) ||
    state.replacementIntents.has(symbol) ||
    state.trailingBuyRepriceIntents.has(symbol) ||
    hasPendingRecoveryManagedCancellation({ symbol }) ||
    volatilityBlocked
}

function createOperatorMarketResumeHandler({
  state,
  pairs,
  volatilityProtectionEnabled,
  hasPendingRecoveryManagedCancellation,
  runTransition,
} = {}) {
  return ({ symbol, beforeApply } = {}) => runTransition({
    task: async () => {
      if (typeof symbol !== "string" || !Object.hasOwn(pairs, symbol)) {
        const error = new TypeError("Operator resume requires a configured market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        return toResult({ error })
      }
      if (isOperatorResumeBlocked({
        state,
        symbol,
        volatilityProtectionEnabled,
        hasPendingRecoveryManagedCancellation,
      })) {
        const error = new Error("Market cannot be resumed while a safety or recovery blocker is active")
        error.code = "SAFETY_BLOCKER_ACTIVE"
        return toResult({ error })
      }
      if (!state.operatorPausedMarkets.has(symbol)) {
        return toResult({ data: { symbol,
resumed: false,
reason: "NOT_OPERATOR_PAUSED" } })
      }
      let durable = false
      if (typeof beforeApply === "function") {
        let committed
        try {
          committed = await beforeApply({ symbol,
action: "RESUME" })
        } catch (error) {
          return toResult({ error })
        }
        if (committed?.ok !== true || committed?.data?.durable !== true) {
          return committed?.ok === false
            ? committed
            : toResult({ error: new Error("Operator resume fact was not durably committed") })
        }
        durable = true
      } else {
        // TEMPORARY: with restart recovery disabled, CC resume is process-local only.
      }
      state.operatorPausedMarkets.delete(symbol)
      return toResult({ data: { symbol,
resumed: true,
durable } })
    },
  })
}

function isOperatorBuyPauseActive({ state, symbol } = {}) {
  return state.operatorAllBuysPaused === true || state.operatorBuyPausedMarkets?.has(symbol) === true
}

function getActiveOwnedBuyOrders({ state, symbol } = {}) {
  return state.registry.getActiveOrders().filter((order) =>
    order.side === "BUY" &&
    (symbol === undefined || order.market.symbol === symbol))
}

function getOperatorBuyScopeError({ pairs, symbol, operation } = {}) {
  if (symbol === undefined || (typeof symbol === "string" && Object.hasOwn(pairs, symbol))) {
    return undefined
  }
  const error = new TypeError(`Operator BUY ${operation} requires a configured market symbol`)
  error.code = "INVALID_OPERATOR_MARKET"
  return error
}

async function commitOperatorBuyControlFact({ beforeApply, symbol, action, failureMessage } = {}) {
  if (typeof beforeApply !== "function") {
    return toResult({
      data: { durable: false },
    })
  }
  let committed
  try {
    committed = await beforeApply({
      ...(symbol === undefined ? {} : { symbol }),
      action,
    })
  } catch (error) {
    return toResult({ error })
  }
  if (committed?.ok !== true || committed?.data?.durable !== true) {
    return committed?.ok === false
      ? committed
      : toResult({ error: new Error(failureMessage) })
  }
  return committed
}

async function applyOperatorBuyPauseTransition({ state, pairs, symbol, beforeApply } = {}) {
  const scopeError = getOperatorBuyScopeError({
    pairs,
    symbol,
    operation: "pause",
  })
  if (scopeError) {
    return toResult({ error: scopeError })
  }
  const alreadyPaused = symbol === undefined
    ? state.operatorAllBuysPaused === true
    : state.operatorBuyPausedMarkets.has(symbol)
  if (!alreadyPaused) {
    const committed = await commitOperatorBuyControlFact({
      beforeApply,
      symbol,
      action: symbol === undefined ? "PAUSE_ALL_BUYS" : "PAUSE_BUYS",
      failureMessage: "Operator BUY pause fact was not durably committed",
    })
    if (!committed.ok) {
      return committed
    }
  }
  if (symbol === undefined) {
    state.operatorAllBuysPaused = true
  } else {
    state.operatorBuyPausedMarkets.add(symbol)
  }
  return toResult({
    data: {
      ...(symbol === undefined ? {} : { symbol }),
      paused: true,
      alreadyPaused,
      durable: !alreadyPaused && typeof beforeApply === "function",
    },
  })
}

function createOperatorBuyPauseHandler({ state, pairs, runTransition, cancelOwnedBuyOrders } = {}) {
  return async ({ symbol, beforeApply } = {}) => {
    const applied = await runTransition({
      task: () => applyOperatorBuyPauseTransition({
        state,
        pairs,
        symbol,
        beforeApply,
      }),
    })
    if (!applied?.ok) {
      return applied
    }

    let cancellation
    try {
      cancellation = await cancelOwnedBuyOrders({
        ...(symbol === undefined ? {} : { symbol }),
        reason: "OPERATOR_BUY_PAUSE",
        pauseOnFailure: false,
      })
    } catch (error) {
      cancellation = toResult({ error })
    }
    const unresolvedOrders = getActiveOwnedBuyOrders({
      state,
      symbol,
    })
    if (!cancellation?.ok || unresolvedOrders.length > 0) {
      return toResult({
        error: new OperatorBuyCancellationIncompleteError({
          symbol,
          unresolvedOrderCount: unresolvedOrders.length,
          cause: cancellation?.errors?.[0],
        }),
      })
    }
    return toResult({
      data: {
        ...applied.data,
        canceled: cancellation.data?.canceled ?? 0,
        reconciled: cancellation.data?.reconciled ?? 0,
        unresolved: 0,
      },
    })
  }
}

function isOperatorBuyPauseStillActive({ state, symbol } = {}) {
  if (symbol === undefined) {
    return state.operatorAllBuysPaused === true || state.operatorBuyPausedMarkets.size > 0
  }
  return isOperatorBuyPauseActive({
    state,
    symbol,
  })
}

async function applyOperatorBuyResumeTransition({ state, pairs, symbol, beforeApply } = {}) {
  const scopeError = getOperatorBuyScopeError({
    pairs,
    symbol,
    operation: "resume",
  })
  if (scopeError) {
    return toResult({ error: scopeError })
  }
  const paused = symbol === undefined
    ? state.operatorAllBuysPaused === true
    : state.operatorBuyPausedMarkets.has(symbol)
  if (!paused) {
    return toResult({
      data: {
        ...(symbol === undefined ? {} : { symbol }),
        resumed: false,
        stillPaused: isOperatorBuyPauseStillActive({
          state,
          symbol,
        }),
        reason: "NOT_OPERATOR_BUY_PAUSED",
      },
    })
  }
  const committed = await commitOperatorBuyControlFact({
    beforeApply,
    symbol,
    action: symbol === undefined ? "RESUME_ALL_BUYS" : "RESUME_BUYS",
    failureMessage: "Operator BUY resume fact was not durably committed",
  })
  if (!committed.ok) {
    return committed
  }
  if (symbol === undefined) {
    state.operatorAllBuysPaused = false
  } else {
    state.operatorBuyPausedMarkets.delete(symbol)
  }
  return toResult({
    data: {
      ...(symbol === undefined ? {} : { symbol }),
      resumed: true,
      stillPaused: isOperatorBuyPauseStillActive({
        state,
        symbol,
      }),
      durable: typeof beforeApply === "function",
    },
  })
}

function createOperatorBuyResumeHandler({ state, pairs, runTransition } = {}) {
  return ({ symbol, beforeApply } = {}) => runTransition({
    task: () => applyOperatorBuyResumeTransition({
      state,
      pairs,
      symbol,
      beforeApply,
    }),
  })
}

function resolvePendingOrderOwnership({ order, purpose, ownership } = {}) {
  const resolvedPurpose = ownership?.purpose ?? purpose ??
    (order.side === "BUY" ? "CONSERVATIVE_BUY" : "CONSERVATIVE_SELL")
  return validateStrategySubmissionOwnership({
    order,
    purpose: resolvedPurpose,
    ownership: {
      strategyId: ownership?.strategyId ?? StrategyId.COIN_GRABBER,
      positionId: ownership?.positionId ?? createPositionId({
        marketId: order.market.id,
        strategyId: StrategyId.COIN_GRABBER,
      }),
      purpose: resolvedPurpose,
      ...(ownership?.cycleId === undefined ? {} : { cycleId: ownership.cycleId }),
    },
  })
}

function registerPendingOrderOwnership({ state, order, normalizedOwnership } = {}) {
  state.registry = state.registry.registerPending({
    order,
    ownership: normalizedOwnership,
  }).registry
  const registeredOwnership = state.registry.getOwnership({
    clientOrderId: order.clientOrderId,
  })
  if (!registeredOwnership) {
    throw new Error("Pending order registration did not retain its strategy ownership")
  }
  return registeredOwnership
}

async function persistPendingOrderIntent({
  order,
  registeredOwnership,
  publishDurableIntent,
  pause,
} = {}) {
  const persisted = await publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
    dataResult: mapOrderSubmissionRequestedData({
      order,
      ownership: registeredOwnership,
    }),
  })
  if (persisted.ok) {
    return
  }
  const error = persisted.errors?.[0] ??
    new Error("Order intent was not durably journaled; broker submission was not attempted")
  await pause({
    symbol: order.market.symbol,
    reason: "ORDER_INTENT_NOT_DURABLE",
    error,
  })
  throw error
}

function createPendingOrderLifecycleHandler({ state, publishDurableIntent, pause, logger } = {}) {
  return async ({ order, purpose, ownership } = {}) => {
    if (order.side === "SELL") {
      state.completedRecoverySellSymbols.delete(order.market.symbol)
      state.completedRecoverySellOrdersBySymbol.delete(order.market.symbol)
    }
    const normalizedOwnership = resolvePendingOrderOwnership({
      order,
      purpose,
      ownership,
    })
    const registeredOwnership = registerPendingOrderOwnership({
      state,
      order,
      normalizedOwnership,
    })
    try {
      await persistPendingOrderIntent({
        order,
        registeredOwnership,
        publishDurableIntent,
        pause,
      })
    } catch (error) {
      const removal = state.registry.removePending({
        clientOrderId: order.clientOrderId,
      })
      if (removal.removed) {
        state.registry = removal.registry
      }
      throw error
    }
    logOrderLifecycle({
      logger,
      order,
      ownership: registeredOwnership,
      status: "PENDING",
      detail: "Local PENDING registration; Operational State Store intent and broker placement are not yet confirmed",
    })
    return {
      ownership: registeredOwnership,
    }
  }
}

function createAcknowledgedOrderLifecycleHandler({
  state,
  eventPublisher,
  reconcileFilledAcknowledgement,
  logger,
} = {}) {
  return async ({ order }) => {
    if (order.status === "FILLED") {
      const registered = state.registry.orders.some(
        (item) => item.clientOrderId === order.clientOrderId,
      )
      if (!registered) {
        throw new Error("Broker acknowledged an unregistered Harvester order")
      }
      state.registry = state.registry.attachAcknowledgedBrokerOrderId({ order }).registry
    } else {
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) {
        throw new Error("Broker acknowledged an unregistered Harvester order")
      }
      state.registry = update.registry
    }
    const ownership = state.registry.getOwnership({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      marketId: order.market.id,
    })
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
      dataResult: mapOrderSubmittedData({
        order,
        ownership,
      }),
    })
    const acceptedOrder = state.registry.getOrder({
      clientOrderId: order.clientOrderId,
    }) ?? order
    logOrderLifecycle({
      logger,
      order: acceptedOrder,
      ownership,
      status: "ACCEPTED",
    })
    const reconciliation = await reconcileFilledAcknowledgement({ order })
    if (!reconciliation.ok) {
      throw reconciliation.errors?.[0] ?? new Error("FILLED acknowledgement reconciliation failed")
    }
  }
}

function getRecoverySellDeferralPublicationError({ publication } = {}) {
  if (publication?.ok === true) {
    return undefined
  }
  return publication?.errors?.[0] ?? new Error("Recovery SELL deferral evidence publication failed")
}

function getRecoverySellDeferralFlushError({ flushed } = {}) {
  if (flushed?.ok === true && flushed?.durable === true) {
    return undefined
  }
  return flushed?.errors?.[0] ?? new Error("Recovery SELL deferral evidence was not durably journaled")
}

async function persistRecoverySellDeferralEvidence({ eventPublisher, publication } = {}) {
  const publicationError = getRecoverySellDeferralPublicationError({ publication })
  if (publicationError) {
    return publicationError
  }
  if (typeof eventPublisher?.flushWrites !== "function") {
    return new TypeError("Recovery SELL deferral evidence requires a write-only durable Journal flush capability")
  }
  try {
    return getRecoverySellDeferralFlushError({
      flushed: await eventPublisher.flushWrites(),
    })
  } catch (error) {
    return error
  }
}

function publishDeferredOrderEvidence({ eventPublisher, order, purpose, registered, reason, recoverySell } = {}) {
  try {
    const publication = publishSubmissionDeferral({
      eventPublisher,
      order,
      reason: reason ?? "SUBMISSION_NOT_ALLOWED",
      ...(recoverySell
        ? {
          purpose,
          registered,
        }
        : {}),
    })
    return { publication }
  } catch (error) {
    if (!recoverySell) {
      throw error
    }
    return { publicationError: error }
  }
}

function removeDeferredPendingOrder({ state, order, registered } = {}) {
  if (!registered) {
    return
  }
  const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
  if (!removal.removed) {
    throw new Error("Cannot remove a pending order deferred before broker submission")
  }
  state.registry = removal.registry
}

function createSubmissionDeferredHandler({ state, pause, eventPublisher } = {}) {
  return async ({ order, registered, purpose, reason, errors, error } = {}) => {
    const recoverySell = order.side === "SELL" && purpose === "RECOVERY_SELL"
    const publicationResult = registered || recoverySell
      ? publishDeferredOrderEvidence({
        eventPublisher,
        order,
        purpose,
        registered,
        reason,
        recoverySell,
      })
      : {}
    removeDeferredPendingOrder({
      state,
      order,
      registered,
    })
    state.deferredEvaluations.add(order.market.symbol)
    const persistenceError = publicationResult.publicationError ??
      (recoverySell
        ? await persistRecoverySellDeferralEvidence({
          eventPublisher,
          publication: publicationResult.publication,
        })
        : undefined)
    const intentError = reason === "ORDER_INTENT_NOT_DURABLE"
      ? error ?? errors?.[0] ?? new Error("Durable order-submission intent was not committed")
      : undefined
    const pauseError = intentError ?? persistenceError
    if (pauseError) {
      await pause({
        symbol: order.market.symbol,
        reason: intentError
          ? "ORDER_INTENT_NOT_DURABLE"
          : "RECOVERY_SELL_DEFERRAL_EVIDENCE_PERSISTENCE_FAILED",
        error: pauseError,
      })
    }
    if (persistenceError) {
      throw persistenceError
    }
  }
}

function createOrderValidationFailureHandler({ pause } = {}) {
  return async ({ order, error }) => {
    await pause({
      symbol: order.market.symbol,
      reason: "STRATEGY_ORDER_VALIDATION_FAILED",
      error,
    })
  }
}

function createSubmissionLifecycleCallbacks({
  state,
  publishDurableIntent,
  pause,
  eventPublisher,
  reconcileFilledAcknowledgement,
  logger,
} = {}) {
  return {
    onSubmissionDeferred: createSubmissionDeferredHandler({
      state,
      pause,
      eventPublisher,
    }),
    onPendingOrder: createPendingOrderLifecycleHandler({
      state,
      publishDurableIntent,
      pause,
      logger,
    }),
    onAcknowledgedOrder: createAcknowledgedOrderLifecycleHandler({
      state,
      eventPublisher,
      reconcileFilledAcknowledgement,
      logger,
    }),
    onOrderValidationFailure: createOrderValidationFailureHandler({ pause }),
  }
}

function classifySubmissionFailure({ order, error }) {
  const definitePostOnlyRejection = order.type === "LIMIT_MAKER" &&
    error?.code === "POST_ONLY_WOULD_TAKE"
  const definiteFilterRejection = error?.code === "DEFINITE_EXCHANGE_FILTER_REJECTED" &&
    error?.outcomeUnknown !== true
  return {
    definitePostOnlyRejection,
    definiteRejection: definitePostOnlyRejection || definiteFilterRejection,
  }
}

function publishSubmissionFailure({ eventPublisher, order, outcome, error }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_FAILED,
    dataResult: mapOrderSubmissionFailedData({
      order,
      outcome,
      error,
    }),
  })
}

function handleDefiniteSubmissionRejection({
  state,
  order,
  ownership,
  logger,
  definitePostOnlyRejection,
}) {
  const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
  if (!removal.removed) {
    throw new Error("Cannot remove a definitively rejected pending order")
  }
  state.registry = removal.registry
  logOrderLifecycle({
    logger,
    order,
    ownership,
    status: "REJECTED",
  })
  if (definitePostOnlyRejection) {
    state.books.delete(order.market.symbol)
  }
  state.deferredEvaluations.add(order.market.symbol)
}

async function handleUnknownSubmissionFailure({
  state,
  order,
  outcome,
  submissionError,
  ownership,
  logger,
  pause,
}) {
  const unknownResult = state.registry.markUnknown({ clientOrderId: order.clientOrderId })
  if (!unknownResult.ok) {
    throw unknownResult.errors[0] ?? new Error("Unable to retain an uncertain submission as UNKNOWN")
  }
  state.registry = unknownResult.data.registry
  const unknownOrder = state.registry.getOrder({ clientOrderId: order.clientOrderId }) ??
    unknownResult.data.order ?? order
  logOrderLifecycle({
    logger,
    order: unknownOrder,
    ownership: state.registry.getOwnership({ clientOrderId: order.clientOrderId }) ?? ownership,
    status: "UNKNOWN",
  })
  await pause({
    symbol: order.market.symbol,
    reason: `ORDER_SUBMISSION_${outcome}`,
    error: submissionError,
  })
}

function createSubmissionFailureCallbacks({ state, pause, eventPublisher, logger } = {}) {
  return {
    onSubmissionFailure: async ({ order, error, errors, outcome }) => {
      const submissionError = error ?? errors?.[0]
      const classification = classifySubmissionFailure({
        order,
        error: submissionError,
      })
      const ownership = state.registry.getOwnership({ clientOrderId: order.clientOrderId })
      publishSubmissionFailure({
        eventPublisher,
        order,
        outcome: classification.definiteRejection ? "REJECTED" : outcome,
        error: submissionError,
      })
      if (classification.definiteRejection) {
        handleDefiniteSubmissionRejection({
          state,
          order,
          ownership,
          logger,
          definitePostOnlyRejection: classification.definitePostOnlyRejection,
        })
        return
      }
      await handleUnknownSubmissionFailure({
        state,
        order,
        outcome,
        submissionError,
        ownership,
        logger,
        pause,
      })
    },
  }
}

function validateInitialEngineState({ initialState, pairs } = {}) {
  const initialRegistry = initialState.orderRegistry ?? OrderRegistry.empty()
  if (!(initialRegistry instanceof OrderRegistry)) {
    throw new TypeError("initialState.orderRegistry must be an OrderRegistry")
  }
  for (const field of ["pausedMarkets", "operatorPausedMarkets", "durablePausedMarkets", "recoveryManagedPausedMarkets", "recoveryManagedCancellationClientOrderIds", "unrequestedTerminalOrderClientIds", "replacementIntents", "trailingBuyRepriceIntents", "completedOrderClientIds", "reconciledTerminalOrderClientIds", "trailingBuySymbols"]) {
    const values = initialState[field]
    if (values !== undefined && (
      !(Array.isArray(values) || values instanceof Set) ||
      [...values].some((value) => typeof value !== "string" || !value.trim())
    )) {
      throw new TypeError(`initialState.${  field  } must contain non-empty strings`)
    }
  }
  for (const symbol of initialState.operatorPausedMarkets ?? []) {
    if (!Object.hasOwn(pairs, symbol)) {
      throw new TypeError(`initialState.operatorPausedMarkets contains an unconfigured market: ${  symbol}`)
    }
  }
  if (initialState.journalFills !== undefined && !Array.isArray(initialState.journalFills)) {
    throw new TypeError("initialState.journalFills must be an array")
  }
  return initialRegistry
}

function createInitialJournalFillIndex({ journalFills } = {}) {
  const journalFillsById = new Map()
  for (const journalFill of journalFills ?? []) {
    if (typeof journalFill?.fillId !== "string" || !journalFill.fillId.trim() ||
        journalFillsById.has(journalFill.fillId)) {
      throw new TypeError("initialState.journalFills must contain unique canonical fill IDs")
    }
    journalFillsById.set(journalFill.fillId, journalFill)
  }
  return journalFillsById
}

function getInitialStateArray({ initialState, key }) {
  return initialState[key] ?? []
}

function createInitialVolatilityProtection({ markets }) {
  return new Map(Object.entries(markets)
    .filter(([, marketConfig]) => marketConfig?.enabled === true && marketConfig?.enableVolatilityProtection !== false)
    .map(([symbol]) => [symbol, createVolatilityProtectionState({ symbol })]))
}

function createInitialEngineStateCore({ initialRegistry, journalFillsById }) {
  return {
    registry: initialRegistry,
    journalFillsById,
    prices: new Map(),
    books: new Map(),
    lastBuyPrices: new Map(),
    buyExecutionTotals: new Map(),
    sellExecutionTotals: new Map(),
    processedFillIdsByOrder: new Map(),
    processedFillsByOrder: new Map(),
    lastAdjustmentPrices: new Map(),
    buyReferenceOverrides: new Map(),
    deferredEvaluations: new Set(),
    operatorAllBuysPaused: false,
    operatorBuyPausedMarkets: new Set(),
    completedRecoverySellSymbols: new Set(),
    completedRecoverySellOrdersBySymbol: new Map(),
    shutdownRecoveryReplanSymbols: new Set(),
    marketPriceEventIds: new Map(),
    volatilityCancellationAttemptBySymbol: new Map(),
    volatilitySnapshotSignatureBySymbol: new Map(),
  }
}

function createInitialEngineTrackingState({ initialState }) {
  return {
    strategySafetyPauseStatuses: new Map(),
    strategySafetyPauseCancellationInProgress: new Set(),
    ownedBuyCancellationInProgress: new Set(),
    trailingBuy: new Map([...getInitialStateArray({
      initialState,
      key: "trailingBuySymbols",
    })].map((symbol) => [symbol, true])),
    paused: new Set(getInitialStateArray({
      initialState,
      key: "pausedMarkets",
    })),
    operatorPausedMarkets: new Set(getInitialStateArray({
      initialState,
      key: "operatorPausedMarkets",
    })),
    durablePausedMarkets: new Set(getInitialStateArray({
      initialState,
      key: "durablePausedMarkets",
    })),
    recoveryManagedPausedMarkets: new Set(getInitialStateArray({
      initialState,
      key: "recoveryManagedPausedMarkets",
    })),
    recoveryManagedCancellationClientOrderIds: new Set(getInitialStateArray({
      initialState,
      key: "recoveryManagedCancellationClientOrderIds",
    })),
    unrequestedTerminalOrderClientIds: new Set(getInitialStateArray({
      initialState,
      key: "unrequestedTerminalOrderClientIds",
    })),
    replacementIntents: new Set(getInitialStateArray({
      initialState,
      key: "replacementIntents",
    })),
    trailingBuyRepriceIntents: new Set(getInitialStateArray({
      initialState,
      key: "trailingBuyRepriceIntents",
    })),
    completedOrderTransitions: new Set(getInitialStateArray({
      initialState,
      key: "completedOrderClientIds",
    })),
    reconciledTerminalOrderClientIds: new Set(getInitialStateArray({
      initialState,
      key: "reconciledTerminalOrderClientIds",
    })),
  }
}

function createInitialEngineState({ initialState = {}, pairs, volatilityPairs = pairs, initialRegistry } = {}) {
  const journalFillsById = createInitialJournalFillIndex({
    journalFills: initialState.journalFills,
  })
  const state = {
    ...createInitialEngineStateCore({
      initialRegistry,
      journalFillsById,
    }),
    ...createInitialEngineTrackingState({ initialState }),
    volatilityProtection: createInitialVolatilityProtection({ markets: volatilityPairs }),
  }
  linkSharedAccountOrderRegistry({
    state,
    initialState,
  })
  return { journalFillsById,
state }
}

function createSerializedTransitionQueue() {
  let transitionTail = Promise.resolve()
  return ({ task } = {}) => {
    const current = transitionTail.then(task)
    transitionTail = current.catch(() => undefined)
    return current
  }
}

function createOwnedOrderSnapshotHandlers({
  state,
  broker,
  processExecutionFillTransition,
  processUserDataEventTransition,
  pause,
} = {}) {
  const collectOwnedOrderSnapshots = makeCollectOwnedOrderSnapshots({
    broker,
    journalFillsById: state.journalFillsById,
  })
  const applyOwnedOrderSnapshotsTransition = (options = {}) => applyOwnedOrderSnapshots({
    context: {
      state,
      processExecutionFillTransition,
      processUserDataEventTransition,
      pause,
      affectedSymbol: undefined,
    },
    ...options,
  })
  return {
    collectOwnedOrderSnapshots,
    applyOwnedOrderSnapshotsTransition,
  }
}

function createOwnedOrderCancellationHandlers({
  state, broker, processExecutionFillTransition, pause, ensureCancellationEligible,
  publishDurableIntent, cancelOrderWithOperationalState, markCancellationUnknown,
  markCancellationFailure, publishOrderCancelled, publishOrderCancelFailed, runTransition,
} = {}) {
  const cancellationContext = {
    state,
    ensureCancellationEligible,
    publishDurableIntent,
    cancelOrderWithOperationalState,
    markCancellationUnknown,
    markCancellationFailure,
    broker,
    pause,
    processExecutionFillTransition,
    publishOrderCancelled,
    publishOrderCancelFailed,
  }
  const cancelOwnedBuyOrdersWithinTransition = async (options = {}) => {
    const scope = options.symbol ?? "*"
    const alreadyInProgress = scope === "*"
      ? state.ownedBuyCancellationInProgress.size > 0
      : state.ownedBuyCancellationInProgress.has("*") ||
        state.ownedBuyCancellationInProgress.has(scope)
    if (alreadyInProgress) {
      return toResult({
        data: {
          canceled: 0,
          reconciled: 0,
          skipped: true,
          reason: "CANCELLATION_ALREADY_IN_PROGRESS",
        },
      })
    }
    state.ownedBuyCancellationInProgress.add(scope)
    try {
      return await cancelOwnedBuyOrdersTransition({
        context: cancellationContext,
        options,
      })
    } finally {
      state.ownedBuyCancellationInProgress.delete(scope)
    }
  }
  const cancelOwnedBuyOrders = (options = {}) => runTransition({
    task: () => cancelOwnedBuyOrdersWithinTransition(options),
  })
  return {
    cancelOwnedBuyOrdersWithinTransition,
    cancelOwnedBuyOrders,
    cancelOwnedBuyOrdersForShutdown: (options = {}) => cancelOwnedBuyOrders(options),
    cancelOwnedBuyOrdersForSafetyHalt: () => cancelOwnedBuyOrders({
      reason: "ACCOUNT_INTEGRITY_FAILURE",
    }),
  }
}

function createOwnedOrderReconciliationHandler({
  state,
  broker,
  runTransition,
  pause,
  collectOwnedOrderSnapshots,
  applyOwnedOrderSnapshotsTransition,
} = {}) {
  return (options = {}) => reconcileOwnedOrdersTransition({
    context: {
      state,
      broker,
      runTransition,
      pause,
      collectOwnedOrderSnapshots,
      applyOwnedOrderSnapshotsTransition,
    },
    options,
  })
}

function createOwnedOrderManagementHandlers(options = {}) {
  const snapshotHandlers = createOwnedOrderSnapshotHandlers(options)
  const cancellationHandlers = createOwnedOrderCancellationHandlers(options)
  const reconcileOwnedOrders = createOwnedOrderReconciliationHandler({
    ...options,
    ...snapshotHandlers,
  })
  return {
    ...snapshotHandlers,
    ...cancellationHandlers,
    reconcileOwnedOrders,
  }
}

function createMarketDataBlockers({ metadata, marketPrice, priceFresh, marketBook, bookRequired, bookFresh }) {
  const blockers = []
  if (!metadata?.market) {
    blockers.push("MARKET_METADATA_UNAVAILABLE")
  }
  if (!marketPrice) {
    blockers.push("MARKET_PRICE_UNAVAILABLE")
  } else if (!priceFresh) {
    blockers.push("MARKET_PRICE_STALE")
  }
  if (bookRequired && !marketBook) {
    blockers.push("MARKET_BOOK_UNAVAILABLE")
  } else if (bookRequired && !bookFresh) {
    blockers.push("MARKET_BOOK_STALE")
  }
  return blockers
}

function createOperatorPauseBlockers({
  safetyPaused,
  operatorPaused,
  operatorBuyPaused,
  recoveryManagedPaused,
  replacementPending,
  trailingBuyRepricePending,
}) {
  const blockers = []
  if (safetyPaused) {
    blockers.push("STRATEGY_SAFETY_PAUSED")
  }
  if (operatorPaused) {
    blockers.push("OPERATOR_PAUSED")
  }
  if (operatorBuyPaused) {
    blockers.push("OPERATOR_BUYS_PAUSED")
  }
  if (recoveryManagedPaused) {
    blockers.push("RECOVERY_MANAGED_PAUSED")
  }
  if (replacementPending) {
    blockers.push("ORDER_REPLACEMENT_PENDING")
  }
  if (trailingBuyRepricePending) {
    blockers.push("TRAILING_BUY_REPRICE_PENDING")
  }
  return blockers
}

function createOperatorProtectionBlockers({ volatilityState, openOrderBlockerActive }) {
  const blockers = []
  if (volatilityState && volatilityState.mode !== VOLATILITY_PROTECTION_MODES.NORMAL) {
    blockers.push("VOLATILITY_PROTECTION_ACTIVE")
  }
  if (openOrderBlockerActive) {
    blockers.push("OPEN_ORDER_OWNERSHIP_BLOCKER")
  }
  return blockers
}

function createOperatorMarketBlockers(options) {
  if (options.pairConfig.enabled !== true) {
    return ["MARKET_DISABLED"]
  }
  return [
    ...createMarketDataBlockers(options),
    ...createOperatorPauseBlockers(options),
    ...createOperatorProtectionBlockers(options),
  ]
}
function createOperatorVolatilityProtectionSnapshot({ volatilityState }) {
  if (!volatilityState) {
    return null
  }
  return Object.freeze({
    mode: volatilityState.mode,
    reason: volatilityState.reason,
    stableCandleCount: volatilityState.stableCandleCount,
    volatilityRatio: volatilityState.volatilityRatio,
    natr: volatilityState.natr,
    referenceNatr: volatilityState.referenceNatr,
    atr: volatilityState.atr,
  })
}

function createOperatorMarketSnapshotBlockers({
  pairConfig,
  metadata,
  marketPrice,
  priceFresh,
  marketBook,
  bookRequired,
  bookFresh,
  safetyPaused,
  operatorPaused,
  operatorBuyPaused,
  recoveryManagedPaused,
  replacementPending,
  trailingBuyRepricePending,
  volatilityState,
  openOrderBlockerActive,
}) {
  return createOperatorMarketBlockers({
    pairConfig,
    metadata,
    marketPrice,
    priceFresh,
    marketBook,
    bookRequired,
    bookFresh,
    safetyPaused,
    operatorPaused,
    operatorBuyPaused,
    recoveryManagedPaused,
    replacementPending,
    trailingBuyRepricePending,
    volatilityState,
    openOrderBlockerActive,
  })
}

function createOperatorMarketSnapshotBlockerFacts({
  state,
  symbol,
  pairConfig,
  metadata,
  marketPrice,
  priceFresh,
  marketBook,
  bookRequired,
  bookFresh,
  safetyPaused,
  operatorPaused,
  operatorBuyPaused,
  recoveryManagedPaused,
  replacementPending,
  trailingBuyRepricePending,
  volatilityState,
  openOrderBlockerActive,
}) {
  const safetyPauseCancellation = state.strategySafetyPauseStatuses.get(symbol) ?? null
  const blockers = createOperatorMarketSnapshotBlockers({
    pairConfig,
    metadata,
    marketPrice,
    priceFresh,
    marketBook,
    bookRequired,
    bookFresh,
    safetyPaused,
    operatorPaused,
    operatorBuyPaused,
    recoveryManagedPaused,
    replacementPending,
    trailingBuyRepricePending,
    volatilityState,
    openOrderBlockerActive,
  })
  if (safetyPauseCancellation?.status === "INCOMPLETE") {
    blockers.push("STRATEGY_PAUSE_CANCELLATION_INCOMPLETE")
  }
  return {
    safetyPauseCancellation,
    blockers,
  }
}

function createOperatorMarketDataFacts({
  state,
  symbol,
  pairConfig,
  getCurrentMarketMetadata,
  isMarketPriceFresh,
  isMarketBookFresh,
}) {
  const metadata = getCurrentMarketMetadata({ symbol })
  const marketPrice = state.prices.get(symbol)
  const priceFresh = marketPrice ? isMarketPriceFresh(marketPrice) : false
  const marketBook = state.books.get(symbol)
  const bookFresh = marketBook ? isMarketBookFresh(marketBook) : false
  const orderType = metadata?.orderType ?? pairConfig.orderType ?? "LIMIT_MAKER"
  return {
    metadata,
    marketPrice,
    priceFresh,
    marketBook,
    bookRequired: orderType === "LIMIT_MAKER",
    bookFresh,
  }
}

function createOperatorMarketControlFacts({ state, symbol }) {
  return {
    operatorPaused: state.operatorPausedMarkets.has(symbol),
    operatorBuyPaused: isOperatorBuyPauseActive({ state,
symbol }),
    safetyPaused: state.durablePausedMarkets.has(symbol) ||
      (state.paused.has(symbol) && !state.recoveryManagedPausedMarkets.has(symbol)),
    recoveryManagedPaused: state.recoveryManagedPausedMarkets.has(symbol),
    replacementPending: state.replacementIntents.has(symbol),
    trailingBuyRepricePending: state.trailingBuyRepriceIntents.has(symbol),
  }
}

function createOperatorMarketProtectionFacts({
  state,
  symbol,
  pairConfig,
  hasBlockingOpenOrdersForSymbol,
  isVolatilityProtectionEnabledForSymbol,
}) {
  const openOrderBlockerActive = pairConfig.enabled === true &&
    hasBlockingOpenOrdersForSymbol({ symbol })
  const volatilityEnabled = isVolatilityProtectionEnabledForSymbol(symbol)
  const volatilityState = volatilityEnabled
    ? state.volatilityProtection.get(symbol)
    : undefined
  return {
    openOrderBlockerActive,
    volatilityState,
  }
}

function createOperatorMarketSnapshotFacts(options) {
  const { state, symbol, pairConfig } = options
  const dataFacts = createOperatorMarketDataFacts(options)
  const controlFacts = createOperatorMarketControlFacts({ state,
symbol })
  const protectionFacts = createOperatorMarketProtectionFacts(options)
  const facts = {
    ...dataFacts,
    ...controlFacts,
    ...protectionFacts,
  }
  const { safetyPauseCancellation, blockers } = createOperatorMarketSnapshotBlockerFacts({
    state,
    symbol,
    pairConfig,
    ...facts,
  })
  return {
    ...facts,
    safetyPauseCancellation,
    volatilityProtection: createOperatorVolatilityProtectionSnapshot({
      volatilityState: facts.volatilityState,
    }),
    blockers,
  }
}
function createOperatorMarketSnapshotIdentity({ symbol, pairConfig }) {
  return {
    symbol,
    enabled: pairConfig.enabled === true,
  }
}

function createOperatorMarketSnapshotMetadata({ facts, pairConfig }) {
  const market = facts.metadata?.market
  return {
    baseAsset: market?.baseAsset?.code ?? null,
    quoteAsset: market?.quoteAsset?.code ?? null,
    marketMetadataReady: Boolean(market),
    orderType: facts.metadata?.orderType ?? pairConfig.orderType ?? "LIMIT_MAKER",
  }
}

function createOperatorMarketSnapshotPrice({ facts }) {
  return {
    latestPrice: facts.marketPrice?.price ?? null,
    priceTimestamp: facts.marketPrice?.timestamp ?? null,
    priceFresh: facts.priceFresh,
  }
}

function createOperatorMarketSnapshotBook({ facts }) {
  return {
    bookRequired: facts.bookRequired,
    bookTimestamp: facts.marketBook?.timestamp ?? null,
    bookFresh: facts.bookFresh,
  }
}

function createOperatorMarketSnapshotControls({ facts }) {
  return {
    operatorPaused: facts.operatorPaused,
    operatorBuysPaused: facts.operatorBuyPaused,
    safetyPaused: facts.safetyPaused,
    safetyPauseCancellation: facts.safetyPauseCancellation,
    recoveryManagedPaused: facts.recoveryManagedPaused,
    replacementPending: facts.replacementPending,
    trailingBuyRepricePending: facts.trailingBuyRepricePending,
    openOrderBlockerActive: facts.openOrderBlockerActive,
    volatilityProtection: facts.volatilityProtection,
  }
}

function createOperatorMarketSnapshot(options) {
  const { symbol, pairConfig } = options
  const facts = createOperatorMarketSnapshotFacts(options)
  return Object.freeze({
    ...createOperatorMarketSnapshotIdentity({ symbol,
pairConfig }),
    ...createOperatorMarketSnapshotMetadata({ facts,
pairConfig }),
    ...createOperatorMarketSnapshotPrice({ facts }),
    ...createOperatorMarketSnapshotBook({ facts }),
    ...createOperatorMarketSnapshotControls({ facts }),
    blockers: Object.freeze(facts.blockers),
  })
}
function createOperatorMarketSnapshotsGetter({
  state,
  pairs,
  runTransition,
  getCurrentMarketMetadata,
  isMarketPriceFresh,
  isMarketBookFresh,
  hasBlockingOpenOrdersForSymbol,
  isVolatilityProtectionEnabledForSymbol,
} = {}) {
  return () => runTransition({
    task: async () => {
      const markets = Object.entries(pairs).map(([symbol, pairConfig]) =>
        createOperatorMarketSnapshot({
          state,
          symbol,
          pairConfig,
          getCurrentMarketMetadata,
          isMarketPriceFresh,
          isMarketBookFresh,
          hasBlockingOpenOrdersForSymbol,
          isVolatilityProtectionEnabledForSymbol,
        })
      )
      return toResult({ data: Object.freeze({ markets: Object.freeze(markets) }) })
    },
  })
}


function bindSharedAccountOrderRegistry({ state, sharedAccountState } = {}) {
  if (sharedAccountState === undefined) {
    return
  }
  if (!sharedAccountState ||
      typeof sharedAccountState !== "object" ||
      !(sharedAccountState.orderRegistry instanceof OrderRegistry)) {
    throw new TypeError("sharedAccountState must expose an OrderRegistry")
  }
  if (state.registry !== sharedAccountState.orderRegistry) {
    throw new TypeError("initialState.orderRegistry must match sharedAccountState.orderRegistry")
  }
  Object.defineProperty(state, "registry", {
    enumerable: true,
    get: () => sharedAccountState.orderRegistry,
    set: (registry) => {
      if (!(registry instanceof OrderRegistry)) {
        throw new TypeError("sharedAccountState.orderRegistry must remain an OrderRegistry")
      }
      sharedAccountState.orderRegistry = registry
    },
  })
}

function createConservativeMarketMetadataCache({ dependencies, getMarketMetadata } = {}) {
  return createMarketMetadataCache({
    getMarketMetadata,
    getSymbolFilters: ({ symbol }) => dependencies.broker.getSymbolFilters({ symbol }),
    validateMarketMetadata: validateMarketTradingReadiness,
    now: dependencies.now,
  })
}

function createMarketVolatilityRuntime({ dependencies, pairs } = {}) {
  const volatilityPairs = dependencies.volatilityPairs ?? pairs
  const volatilityProtectionEnabled = typeof dependencies.getVolatilityData === "function"
  const isVolatilityProtectionEnabledForSymbol = createMarketVolatilityProtectionEligibility({
    markets: volatilityPairs,
    volatilityProtectionEnabled,
  })
  return {
    volatilityPairs,
    volatilityProtectionEnabled,
    isVolatilityProtectionEnabledForSymbol,
  }
}

function createConservativeEngineState({ initialState, pairs, volatilityPairs = pairs, sharedAccountState } = {}) {
  const initialRegistry = validateInitialEngineState({
    initialState,
    pairs,
  })
  const { state } = createInitialEngineState({
    initialState,
    pairs,
    volatilityPairs,
    initialRegistry,
  })
  bindSharedAccountOrderRegistry({
    state,
    sharedAccountState,
  })
  return state
}

function createConservativeEngineBaseContext({ dependencies } = {}) {
  const {
    appConfig,
    getMarketMetadata,
    initialState,
    hasUnownedOpenOrdersForSymbol,
    sharedAccountState,
  } = dependencies
  const { settings, pairs } = appConfig.strategies[StrategyId.COIN_GRABBER]
  const volatilityRuntime = createMarketVolatilityRuntime({
    dependencies,
    pairs,
  })
  const hasBlockingOpenOrdersForSymbol = ({ symbol } = {}) =>
    pairs[symbol]?.externalOrdersPolicy === EXTERNAL_ORDERS_POLICIES.BLOCK &&
    hasUnownedOpenOrdersForSymbol({ symbol })
  const state = createConservativeEngineState({
    initialState,
    pairs,
    volatilityPairs: volatilityRuntime.volatilityPairs,
    sharedAccountState,
  })
  const marketMetadataCache = createConservativeMarketMetadataCache({
    dependencies,
    getMarketMetadata,
  })
  const runTransition = sharedAccountState?.runTransition ?? createSerializedTransitionQueue()
  const shutdownSafety = createConservativeShutdownSafety({
    state,
    pairs,
    runTransition,
  })
  let strategyEvaluationSequence = 0
  let marketPriceEventSequence = 0
  const recoveryCancellationState = createRecoveryManagedCancellationState({ state })
  const rememberProcessedFill = createProcessedFillTracker({ state })
  const executionFillAccounting = createExecutionFillAccounting({
    state,
    rememberProcessedFill,
  })
  return {
    dependencies,
    settings,
    pairs,
    ...volatilityRuntime,
    hasBlockingOpenOrdersForSymbol,
    marketMetadataCache,
    ...marketMetadataCache,
    state,
    runTransition,
    nextEvaluationId: () => ++strategyEvaluationSequence,
    nextMarketPriceEventId: () => ++marketPriceEventSequence,
    ...recoveryCancellationState,
    ...executionFillAccounting,
    ...shutdownSafety,
  }
}

function createConservativeEnginePublishingContext({ context } = {}) {
  const {
    eventPublisher, getPortfolio, getRecoveryLedger, logger, onPause,
    onOperationalStateStrategyMarketPaused, onSafetyBlockerRaised,
  } = context.dependencies
  context.publishDurableIntent = createDurableIntentPublisher({
    eventPublisher,
  })
  context.publishRecoveryCycleNotCompleted = createRecoveryCycleNotCompletedPublisher({
    eventPublisher,
    getPortfolio,
    getRecoveryLedger,
    pairs: context.pairs,
  })
  const publishStrategyPaused = ({ symbol, reason, error } = {}) => publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STRATEGY_PAUSED,
    dataResult: mapStrategyPausedData({
      symbol,
      reason,
      error,
    }),
  })
  context.pause = createPauseHandler({
    state: context.state,
    onOperationalStateStrategyMarketPaused,
    onSafetyBlockerRaised,
    logger,
    eventPublisher,
    publishStrategyPaused,
    onPause,
    cancelOwnedBuyOrdersWithinTransition: (options = {}) =>
      context.cancelOwnedBuyOrdersWithinTransition(options),
  })
}

function createConservativeEngineCancellationContext({ context } = {}) {
  const { broker, eventPublisher, onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome, logger } = context.dependencies
  context.reconcileFilledAcknowledgement = (options = {}) => reconcileFilledAcknowledgementTransition({
    ...options,
    broker,
    pause: context.pause,
    processUserDataEventTransition: context.processUserDataEventTransition,
  })
  const cancellationEventPublishers = createOrderCancellationEventPublishers({
    eventPublisher,
    logger,
    state: context.state,
  })
  context.publishOrderCancelled = cancellationEventPublishers.publishOrderCancelled
  context.publishOrderCancelFailed = cancellationEventPublishers.publishOrderCancelFailed
  const cancellationFailureHandlers = createCancellationFailureHandlers({
    state: context.state,
    pause: context.pause,
    publishOrderCancelFailed: context.publishOrderCancelFailed,
  })
  context.markCancellationUnknown = cancellationFailureHandlers.markCancellationUnknown
  context.markCancellationFailure = cancellationFailureHandlers.markCancellationFailure
  context.ensureCancellationEligible = async ({
    symbol,
    order,
    reason,
    pauseOnFailure = true,
  }) => {
    const result = validateCancellationEligibility({ order })
    if (result.ok) {return result}
    const [error] = result.errors
    context.publishOrderCancelFailed({
      order,
      outcome: "INVALID_CANCELLATION_REQUEST",
      error,
    })
    if (pauseOnFailure) {await context.pause({ symbol,
reason,
error })}
    return result
  }
  context.cancelOrderWithOperationalState = (options = {}) => cancelOrderWithOperationalStateTransition({
    dependencies: {
      broker,
      onOperationalStateCancellationIntent,
      onOperationalStateCancellationOutcome,
      logger,
      state: context.state,
    },
    ...options,
  })
}

function createRecoverySellerStopAdmissionCallbacks({ dependencies } = {}) {
  return {
    isRecoverySellerBuyAdmissionBlocked: () =>
      dependencies.recoverySellerStopWorkflow?.isBuyAdmissionBlocked?.() === true,
    isRecoverySellerSellAdmissionBlocked: () =>
      dependencies.recoverySellerStopWorkflow?.isSellAdmissionBlocked?.() === true,
  }
}

function createConservativeEngineSubmissionContext({ context } = {}) {
  const { dependencies } = context
  context.shutdownRecoverySubmission = { allowed: false }
  context.canSubmit = createSubmissionGate({
    state: context.state,
    getPortfolio: dependencies.getPortfolio,
    getRecoveryLedger: dependencies.getRecoveryLedger,
    canTrade: dependencies.canTrade,
    isStopping: dependencies.isStopping,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    isMarketBookFresh: dependencies.isMarketBookFresh,
    getVolatilityData: dependencies.getVolatilityData,
    isVolatilityProtectionEnabledForSymbol: context.isVolatilityProtectionEnabledForSymbol,
    hasBlockingOpenOrdersForSymbol: context.hasBlockingOpenOrdersForSymbol,
    getAccountSafetyBlocker: dependencies.getAccountSafetyBlocker,
    ...createRecoverySellerStopAdmissionCallbacks({ dependencies }),
    isPostOnlyOrderCrossing,
    isShutdownRecoverySubmissionAllowed: () => context.shutdownRecoverySubmission.allowed,
  })
  if (Object.keys(dependencies.recoverySellerPairs ?? {}).length > 0) {
    const latchSubmissionFailure = (input = {}) => latchRecoverySellerSubmissionFailure({
      recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
      ...input,
    })
    context.submitRecoverySellerOrder = createRecoverySellerOrderSubmitter({
      broker: dependencies.broker,
      recoverySellerAccountingWorkflow: dependencies.recoverySellerWorkflow,
      onDurableSubmissionIntent: dependencies.onOperationalStateSubmissionIntent,
      onDurableSubmissionOutcome: dependencies.onOperationalStateSubmissionOutcome,
      onUnresolvedSubmission: latchSubmissionFailure,
      onOrderValidationFailure: latchSubmissionFailure,
      canSubmit: context.canSubmit,
      onSellReserved: dependencies.onRecoverySellerSellReserved ??
        dependencies.recoverySellerWorkflow?.reserveSellCycle,
    })
  }
  context.submit = makeExecuteStrategyDecision({
    broker: dependencies.broker,
    onDurableSubmissionIntent: dependencies.onOperationalStateSubmissionIntent,
    onDurableSubmissionOutcome: dependencies.onOperationalStateSubmissionOutcome,
    requireDurableSubmission: dependencies.requireOperationalStateSubmissionDurability,
    canSubmit: context.canSubmit,
    ...createSubmissionLifecycleCallbacks({
      state: context.state,
      publishDurableIntent: context.publishDurableIntent,
      pause: context.pause,
      eventPublisher: dependencies.eventPublisher,
      reconcileFilledAcknowledgement: context.reconcileFilledAcknowledgement,
      logger: dependencies.logger,
    }),
    ...createSubmissionFailureCallbacks({
      state: context.state,
      pause: context.pause,
      eventPublisher: dependencies.eventPublisher,
      logger: dependencies.logger,
    }),
  })
}

function createConservativeEngineRecoverySubmissionContext({ context } = {}) {
  const { dependencies } = context
  context.cancelAndReconcileRecoverySells = (options = {}) => cancelRecoverySells({
    context: {
      state: context.state,
      logger: dependencies.logger,
      ensureCancellationEligible: context.ensureCancellationEligible,
      publishDurableIntent: context.publishDurableIntent,
      cancelOrderWithOperationalState: context.cancelOrderWithOperationalState,
      markCancellationUnknown: context.markCancellationUnknown,
      markCancellationFailure: context.markCancellationFailure,
      publishOrderCancelFailed: context.publishOrderCancelFailed,
      publishOrderCancelled: context.publishOrderCancelled,
      reconcileTerminalOrderFills: context.reconcileTerminalOrderFills,
      assertReconciledSellExecution: context.assertReconciledSellExecution,
      completeRecoveryCycle: dependencies.completeRecoveryCycle,
      publishRecoveryCycleNotCompleted: context.publishRecoveryCycleNotCompleted,
      pause: context.pause,
      pairs: context.pairs,
      eventPublisher: dependencies.eventPublisher,
    },
    ...options,
  })
  context.cancelAndReconcileTrailingBuy = (options = {}) => cancelAndReconcileTrailingBuyTransition({
    context: {
      ensureCancellationEligible: context.ensureCancellationEligible,
      publishDurableIntent: context.publishDurableIntent,
      cancelOrderWithOperationalState: context.cancelOrderWithOperationalState,
      markCancellationUnknown: context.markCancellationUnknown,
      markCancellationFailure: context.markCancellationFailure,
      publishOrderCancelFailed: context.publishOrderCancelFailed,
      publishOrderCancelled: context.publishOrderCancelled,
      state: context.state,
      broker: dependencies.broker,
      updateTradingAccounting: dependencies.updateTradingAccounting,
      pause: context.pause,
    },
    ...options,
  })
  context.maybeReplaceTrailingBuy = (options = {}) => maybeReplaceTrailingBuyTransition({
    context: {
      getCurrentMarketMetadata: context.getCurrentMarketMetadata,
      pairs: context.pairs,
      state: context.state,
      logger: dependencies.logger,
      strategyPolicy: dependencies.strategyPolicy,
      getPortfolio: dependencies.getPortfolio,
      broker: dependencies.broker,
      refreshedMarketMetadata: context.refreshedMarketMetadata,
      refreshMarketMetadata: context.refreshMarketMetadata,
      pause: context.pause,
      evaluateLatestTransition: (transitionOptions) => context.evaluateLatestTransition(transitionOptions),
      cancelAndReconcileTrailingBuy: context.cancelAndReconcileTrailingBuy,
      canTrade: dependencies.canTrade,
      isStopping: dependencies.isStopping,
    },
    ...options,
  })
}

function createEngineRecoverySellerActionAuthorizer({ context, dependencies } = {}) {
  if (Object.keys(dependencies.recoverySellerPairs ?? {}).length === 0) {
    return undefined
  }
  return createRecoverySellerActionAuthorizer({
    state: context.state,
    recoverySellerPairs: dependencies.recoverySellerPairs,
    recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
    getPortfolio: dependencies.getPortfolio,
    getAccountSnapshot: dependencies.getAccountSnapshot,
    getAdditionalTrackedBaseQuantity: dependencies.getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow: dependencies.getAdditionalTrackedQuoteCashFlow,
    allocateOrderCommitments,
  })
}

function createLatestTransitionEvaluatorDependencies({ context, dependencies, authorizeRecoverySellerAction } = {}) {
  return {
    state: context.state,
    hasBlockingOpenOrdersForSymbol: context.hasBlockingOpenOrdersForSymbol,
    isStopping: dependencies.isStopping,
    canTrade: dependencies.canTrade,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    isMarketBookFresh: dependencies.isMarketBookFresh,
    getCurrentMarketMetadata: context.getCurrentMarketMetadata,
    getVolatilityData: dependencies.getVolatilityData,
    isVolatilityProtectionEnabledForSymbol: context.isVolatilityProtectionEnabledForSymbol,
    refreshRecoverySellMarketMetadata: createRecoverySellMetadataRefreshOperation({ context }),
    nextEvaluationId: context.nextEvaluationId,
    getPortfolio: dependencies.getPortfolio,
    getRecoveryLedger: dependencies.getRecoveryLedger,
    pairs: context.pairs,
    settings: context.settings,
    logger: dependencies.logger,
    recoverySellerLogger: dependencies.recoverySellerLogger,
    strategyPolicy: dependencies.strategyPolicy,
    evaluateRecoverySellerTransition: dependencies.evaluateRecoverySellerTransition,
    authorizeRecoverySellerAction,
    recoverySellerPairs: dependencies.recoverySellerPairs,
    recoverySellerWorkflow: dependencies.recoverySellerWorkflow,
    recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
    submitRecoverySellerOrder: context.submitRecoverySellerOrder,
    getRecoverySellerMarketMetadata: dependencies.getRecoverySellerMarketMetadata,
    pause: context.pause,
    completeRecoveryCycle: dependencies.completeRecoveryCycle,
    eventPublisher: dependencies.eventPublisher,
    publishRecoveryCycleNotCompleted: context.publishRecoveryCycleNotCompleted,
    getAccountSnapshot: dependencies.getAccountSnapshot,
    getAdditionalTrackedBaseQuantity: dependencies.getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow: dependencies.getAdditionalTrackedQuoteCashFlow,
    allocateOrderCommitments,
    submit: context.submit,
    setShutdownRecoverySubmissionAllowed: (value) => { context.shutdownRecoverySubmission.allowed = value },
    evaluateLatestTransition: (options) => context.evaluateLatestTransition(options),
  }
}

function createConservativeEngineEvaluationContext({ context } = {}) {
  const { dependencies } = context
  const authorizeRecoverySellerAction = createEngineRecoverySellerActionAuthorizer({
    context,
    dependencies,
  })
  context.evaluateLatestTransition = createLatestTransitionEvaluator(
    createLatestTransitionEvaluatorDependencies({
      context,
      dependencies,
      authorizeRecoverySellerAction,
    }),
  )
  const workflow = createShutdownRecoveryWorkflow({
    state: context.state,
    getCurrentMarketMetadata: context.getCurrentMarketMetadata,
    getPortfolio: dependencies.getPortfolio,
    getRecoveryLedger: dependencies.getRecoveryLedger,
    pairs: context.pairs,
    strategyPolicy: dependencies.strategyPolicy,
    settings: context.settings,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    cancelAndReconcileRecoverySells: context.cancelAndReconcileRecoverySells,
    hasBlockingOpenOrdersForSymbol: context.hasBlockingOpenOrdersForSymbol,
    evaluateLatestTransition: context.evaluateLatestTransition,
    isStopping: dependencies.isStopping,
    runTransition: context.runTransition,
  })
  context.reconcileRecoverySellsForShutdown = workflow.reconcileRecoverySellsForShutdown
  context.auditShutdownRecoverySellCoverage = workflow.auditShutdownRecoverySellCoverage
}

function createConservativeEngineMarketEventContext({ context } = {}) {
  const { dependencies } = context
  const freshMarketPriceWaiter = createFreshMarketPriceWaiter({
    state: context.state,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    setTimeoutFn: dependencies.setTimeoutFn,
    clearTimeoutFn: dependencies.clearTimeoutFn,
  })
  context.waitForFreshMarketPrice = freshMarketPriceWaiter.waitForFreshMarketPrice
  context.processMarketBookTransition = createMarketBookTransitionHandler({
    state: context.state,
    isMarketBookFresh: dependencies.isMarketBookFresh,
    evaluateLatestTransition: context.evaluateLatestTransition,
  })
  context.processMarketPriceTransition = createMarketPriceTransitionHandler({
    state: context.state,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    getCurrentMarketMetadata: context.getCurrentMarketMetadata,
    logger: dependencies.logger,
    getPortfolio: dependencies.getPortfolio,
    getRecoveryLedger: dependencies.getRecoveryLedger,
    canTrade: dependencies.canTrade,
    maybeReplaceTrailingBuy: context.maybeReplaceTrailingBuy,
    evaluateLatestTransition: context.evaluateLatestTransition,
    nextMarketPriceEventId: context.nextMarketPriceEventId,
    notifyFreshMarketPrice: freshMarketPriceWaiter.notifyFreshMarketPrice,
  })
}

async function latchRecoverySellerSubmissionFailure({
  recoverySellerStopWorkflow,
  order,
  reason,
  outcome,
  error,
} = {}) {
  if (typeof recoverySellerStopWorkflow?.latch !== "function") {
    return toResult({
      error: new Error("Recovery Seller submission failure requires the durable global STOP workflow"),
    })
  }
  let detail = "no additional error details"
  if (error instanceof Error) {
    detail = error.message
  } else if (error !== undefined) {
    detail = String(error)
  }
  const orderIdentity = typeof order?.clientOrderId === "string" && order.clientOrderId.trim()
    ? {
        clientOrderId: order.clientOrderId,
        ...(typeof order.brokerOrderId === "string" && order.brokerOrderId.trim()
          ? { brokerOrderId: order.brokerOrderId }
          : {}),
      }
    : undefined
  return recoverySellerStopWorkflow.latch({
    explanation: `Recovery Seller submission requires operator reconciliation (${reason ?? outcome ?? "UNRESOLVED"}): ${detail}`,
    ...(orderIdentity === undefined ? {} : { orderIdentity }),
  })
}

async function latchRecoverySellerTerminalFailure({
  recoverySellerStopWorkflow,
  order,
  reason,
  error,
} = {}) {
  if (typeof recoverySellerStopWorkflow?.latch !== "function") {
    return toResult({
      error: new Error("Recovery Seller terminal failure requires the durable global STOP workflow"),
    })
  }
  return recoverySellerStopWorkflow.latch({
    explanation: `Recovery Seller terminal SELL reconciliation failed (${reason}): ${error?.message ?? String(error)}`,
    orderIdentity: {
      clientOrderId: order.clientOrderId,
      ...(typeof order.brokerOrderId === "string" && order.brokerOrderId.trim()
        ? { brokerOrderId: order.brokerOrderId }
        : {}),
    },
  })
}

export function createConservativeEngineOrderEventContext({ context } = {}) {
  const { dependencies } = context
  const orderEventWorkflow = makeOrderEventWorkflow({
    state: context.state,
    broker: dependencies.broker,
    eventPublisher: dependencies.eventPublisher,
    logger: dependencies.logger,
    pairs: context.pairs,
    updateTradingAccounting: dependencies.updateTradingAccounting,
    updateRecoverySellerAccounting: dependencies.updateRecoverySellerAccounting,
    recordBuyExecutionFill: context.recordBuyExecutionFill,
    recordSellExecutionFill: context.recordSellExecutionFill,
    pause: context.pause,
    resolveRecoveryManagedCancellation: context.resolveRecoveryManagedCancellation,
    cancelAndReconcileRecoverySells: context.cancelAndReconcileRecoverySells,
    evaluateLatestTransition: context.evaluateLatestTransition,
    getReconciledBuyExecutionPrice: context.getReconciledBuyExecutionPrice,
    assertReconciledSellExecution: context.assertReconciledSellExecution,
    completeRecoveryCycle: dependencies.completeRecoveryCycle,
    publishRecoveryCycleNotCompleted: context.publishRecoveryCycleNotCompleted,
    isStopping: dependencies.isStopping,
    onUnownedExternalOrderObserved: dependencies.onUnownedExternalOrderObserved,
    isCurrentProcessClientOrderId: context.submit?.isCurrentProcessClientOrderId,
    reconcileRecoverySellerMixedSell: dependencies.recoverySellerWorkflow?.reconcileTerminalMixedSell,
    latchRecoverySellerStop: ({ order, reason, error } = {}) =>
      latchRecoverySellerTerminalFailure({
        recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
        order,
        reason,
        error,
      }),
  })
  Object.assign(context, orderEventWorkflow)
  const ownedOrderManagement = createOwnedOrderManagementHandlers({
    state: context.state,
    broker: dependencies.broker,
    processExecutionFillTransition: context.processExecutionFillTransition,
    processUserDataEventTransition: context.processUserDataEventTransition,
    pause: context.pause,
    ensureCancellationEligible: context.ensureCancellationEligible,
    publishDurableIntent: context.publishDurableIntent,
    cancelOrderWithOperationalState: context.cancelOrderWithOperationalState,
    markCancellationUnknown: context.markCancellationUnknown,
    markCancellationFailure: context.markCancellationFailure,
    publishOrderCancelled: context.publishOrderCancelled,
    publishOrderCancelFailed: context.publishOrderCancelFailed,
    runTransition: context.runTransition,
  })
  Object.assign(context, ownedOrderManagement)
}


function createConservativeEngineProtectionContext({ context } = {}) {
  const { dependencies } = context
  const volatilityWorkflow = makeVolatilityProtectionWorkflow({
    state: context.state,
    isStopping: dependencies.isStopping,
    isVolatilityProtectionEnabledForSymbol: context.isVolatilityProtectionEnabledForSymbol,
    getVolatilityData: dependencies.getVolatilityData,
    runTransition: context.runTransition,
    cancelOwnedBuyOrders: context.cancelOwnedBuyOrders,
    evaluateLatest: ({ symbol }) => context.evaluateLatestTransition({ symbol }),
    logger: createMarketComponentLogger({
      logger: dependencies.volatilityLogger ?? dependencies.logger,
      component: "market-volatility-protection",
    }),
  })
  Object.assign(context, volatilityWorkflow)
  context.pauseMarket = createOperatorMarketPauseHandler({
    state: context.state,
    pairs: context.pairs,
    runTransition: context.runTransition,
  })
  context.resumeMarket = createOperatorMarketResumeHandler({
    state: context.state,
    pairs: context.pairs,
    volatilityProtectionEnabled: context.volatilityProtectionEnabled,
    hasPendingRecoveryManagedCancellation: context.hasPendingRecoveryManagedCancellation,
    runTransition: context.runTransition,
  })
  context.pauseBuys = createOperatorBuyPauseHandler({
    state: context.state,
    pairs: context.pairs,
    runTransition: context.runTransition,
    cancelOwnedBuyOrders: context.cancelOwnedBuyOrders,
  })
  context.resumeBuys = createOperatorBuyResumeHandler({
    state: context.state,
    pairs: context.pairs,
    runTransition: context.runTransition,
  })
}

function getEventRecordMarketSymbol({ record }) {
  return record?.market?.symbol
}

function getUserDataEventSymbolCandidates({ event = {} } = {}) {
  const { executedOrder, order, fill, market, symbol, s } = event ?? {}
  return [
    getEventRecordMarketSymbol({ record: executedOrder }),
    getEventRecordMarketSymbol({ record: order }),
    getEventRecordMarketSymbol({ record: fill }),
    market?.symbol,
    symbol,
    s,
  ]
}

function getUserDataEventSymbol(event) {
  return getUserDataEventSymbolCandidates({ event })
    .find((symbol) => symbol !== undefined && symbol !== null)
}

function createMarketEventOperations({ context } = {}) {
  context.processMarketPrice = async ({ symbol, priceEvent } = {}) => {
    if (context.state.shutdownBuyGate !== true) {
      const protection = await context.refreshVolatilityProtectionIfNeeded({ symbol })
      if (!protection?.ok) {return protection}
    }
    return context.runTransition({ task: () => context.processMarketPriceTransition({
      symbol,
      priceEvent,
    }) })
  }
  context.processBookTicker = async ({ symbol, bookTicker } = {}) => {
    if (context.state.shutdownBuyGate !== true) {
      const protection = await context.refreshVolatilityProtectionIfNeeded({ symbol })
      if (!protection?.ok) {return protection}
    }
    return context.runTransition({ task: () => context.processMarketBookTransition({
      symbol,
      bookTicker,
    }) })
  }
  context.processUserDataEvent = ({ event, recoveryMode = false } = {}) =>
    context.runTransition({ task: async () => {
      const symbol = getUserDataEventSymbol(event)
      if (context.state.shutdownBuyGate === true) {
        context.invalidateShutdownSafety({
          ...(typeof symbol === "string" ? { symbol } : {}),
          reason: "LATE_ORDER_EXECUTION_EVIDENCE",
        })
      }
      return context.processUserDataEventTransition({
        event,
        recoveryMode,
      })
    } })
  context.evaluateLatest = ({ symbol, shutdownRecoveryOnly = false } = {}) =>
    context.runTransition({
      task: () => context.evaluateLatestTransition({
        symbol,
        shutdownRecoveryOnly,
      }),
    })
}

function createShutdownSafetyOperations({ context } = {}) {
  const {
    reconcileOwnedOrders,
    cancelOwnedBuyOrdersForShutdown,
    reconcileRecoverySellsForShutdown,
  } = context
  context.reconcileOwnedOrders = (options = {}) => {
    context.invalidateShutdownSafety({
      ...(typeof options.symbol === "string" ? { symbol: options.symbol } : {}),
      ...(Array.isArray(options.symbols) ? { symbols: options.symbols } : {}),
      reason: "OWNED_ORDER_RECONCILIATION",
    })
    return reconcileOwnedOrders(options)
  }
  context.cancelOwnedBuyOrdersForShutdown = (options = {}) => {
    context.invalidateShutdownSafety({
      ...(typeof options.symbol === "string" ? { symbol: options.symbol } : {}),
      reason: "OWNED_BUY_CANCELLATION",
    })
    return cancelOwnedBuyOrdersForShutdown(options)
  }
  context.reconcileRecoverySellsForShutdown = (options = {}) => {
    context.invalidateShutdownSafety({
      ...(Array.isArray(options.symbols) ? { symbols: options.symbols } : {}),
      reason: "RECOVERY_SELL_RECONCILIATION",
    })
    return reconcileRecoverySellsForShutdown(options)
  }
  context.resumeDeferredEvaluations = () => context.runTransition({
    task: async () => {
      if (context.state.shutdownBuyGate === true) {
        return toResult({
          data: {
            results: [],
            skipped: true,
            reason: "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE",
          },
        })
      }
      const results = []
      for (const symbol of [...context.state.deferredEvaluations]) {
        const result = await context.evaluateLatestTransition({ symbol })
        results.push({ symbol,
result })
      }
      return toResult({ data: { results } })
    },
  })
}

function createConservativeEngineRuntimeOperations({ context } = {}) {
  createMarketEventOperations({ context })
  createShutdownSafetyOperations({ context })
  const { dependencies } = context
  context.getOperatorMarketSnapshots = createOperatorMarketSnapshotsGetter({
    state: context.state,
    pairs: context.pairs,
    runTransition: context.runTransition,
    getCurrentMarketMetadata: context.getCurrentMarketMetadata,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    isMarketBookFresh: dependencies.isMarketBookFresh,
    hasBlockingOpenOrdersForSymbol: context.hasBlockingOpenOrdersForSymbol,
    isVolatilityProtectionEnabledForSymbol: context.isVolatilityProtectionEnabledForSymbol,
  })
}

function createConservativeEnginePublicApi({ context } = {}) {
  return Object.freeze({
    processMarketPrice: context.processMarketPrice,
    waitForFreshMarketPrice: context.waitForFreshMarketPrice,
    processBookTicker: context.processBookTicker,
    beginShutdown: context.beginShutdown,
    waitForShutdownGate: context.waitForShutdownGate,
    auditShutdownSafety: context.auditShutdownSafety,
    getShutdownSafetySnapshot: context.getShutdownSafetySnapshot,
    processUserDataEvent: context.processUserDataEvent,
    reconcileOwnedOrders: context.reconcileOwnedOrders,
    reconcileRecoverySellsForShutdown: context.reconcileRecoverySellsForShutdown,
    auditShutdownRecoverySellCoverage: context.auditShutdownRecoverySellCoverage,
    cancelOwnedBuyOrdersForShutdown: context.cancelOwnedBuyOrdersForShutdown,
    cancelOwnedBuyOrdersForSafetyHalt: context.cancelOwnedBuyOrdersForSafetyHalt,
    processVolatilitySnapshot: context.processVolatilitySnapshot,
    getVolatilityProtectionState: ({ symbol } = {}) => context.state.volatilityProtection.get(symbol),
    getOperatorMarketSnapshots: context.getOperatorMarketSnapshots,
    evaluateLatest: context.evaluateLatest,
    resumeDeferredEvaluations: context.resumeDeferredEvaluations,
    getOrders: () => context.state.registry.orders,
    getActiveOrders: () => context.state.registry.getActiveOrders(),
    getRecoveryIntents: () => Object.freeze({
      pausedMarkets: Object.freeze([...context.state.paused]),
      operatorPausedMarkets: Object.freeze([...context.state.operatorPausedMarkets]),
      replacementIntents: Object.freeze([...context.state.replacementIntents]),
      trailingBuyRepriceIntents: Object.freeze([...context.state.trailingBuyRepriceIntents]),
      deferredEvaluations: Object.freeze([...context.state.deferredEvaluations]),
    }),
    getPausedMarkets: () => [...context.state.paused],
    getOperatorPausedMarkets: () => [...context.state.operatorPausedMarkets],
    getOperatorBuyPauseState: () => Object.freeze({
      allBuysPaused: context.state.operatorAllBuysPaused,
      pausedMarkets: Object.freeze([...context.state.operatorBuyPausedMarkets]),
    }),
    pauseMarket: context.pauseMarket,
    resumeMarket: context.resumeMarket,
    pauseBuys: context.pauseBuys,
    resumeBuys: context.resumeBuys,
    getLastBuyPrice: ({ symbol } = {}) => context.state.lastBuyPrices.get(symbol),
  })
}

function createConservativeTradingEngineDependencies({ options = {} } = {}) {
  const {
    getAdditionalTrackedBaseQuantity = () => [],
    getAdditionalTrackedQuoteCashFlow = () => [],
    hasUnownedOpenOrdersForSymbol = () => false,
    isMarketBookFresh = () => false,
    now = Date.now,
    logger,
    volatilityLogger = logger,
    initialState = {},
  } = options
  return {
    ...options,
    getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow,
    hasUnownedOpenOrdersForSymbol,
    isMarketBookFresh,
    now,
    volatilityLogger,
    logger: logger
      ? createStrategyLogger({
        logger,
        strategyId: StrategyId.COIN_GRABBER,
      })
      : logger,
    recoverySellerLogger: logger
      ? createStrategyLogger({
        logger,
        strategyId: StrategyId.RECOVERY_SELLER,
      })
      : logger,
    initialState,
  }
}


export function makeConservativeTradingEngine(options = {}) {
  const dependencies = createConservativeTradingEngineDependencies({ options })
  validateConservativeTradingEngineOptions(dependencies)
  const context = createConservativeEngineBaseContext({ dependencies })
  createConservativeEnginePublishingContext({ context })
  createConservativeEngineCancellationContext({ context })
  createConservativeEngineSubmissionContext({ context })
  createConservativeEngineRecoverySubmissionContext({ context })
  createConservativeEngineEvaluationContext({ context })
  createConservativeEngineMarketEventContext({ context })
  createConservativeEngineOrderEventContext({ context })
  createConservativeEngineProtectionContext({ context })
  createConservativeEngineRuntimeOperations({ context })
  return createConservativeEnginePublicApi({ context })
}


function inspectAcknowledgedFillHistory({ order, fills }) {
  const fillsById = new Map()
  for (const fill of fills) {
    const identityMatches = fill instanceof Fill &&
      fill.market.id === order.market.id &&
      fill.side === order.side &&
      fill.brokerOrderId === order.brokerOrderId &&
      (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
    if (!identityMatches) {
      return {
        ok: false,
        reason: "ACKNOWLEDGED_FILL_IDENTITY_MISMATCH",
        error: new Error("Execution history does not match the FILLED acknowledged order"),
      }
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return {
        ok: false,
        reason: "ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE",
        error: new Error("Execution history contains conflicting records for the same fill ID"),
      }
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  const uniqueFills = [...fillsById.values()].sort((...entries) => {
    const [left, right] = entries
    if (left.executedAt !== undefined && right.executedAt !== undefined &&
        left.executedAt !== right.executedAt) {
      return left.executedAt - right.executedAt
    }
    return left.tradeId.localeCompare(right.tradeId)
  })
  const reconciledQuantity = uniqueFills.reduce((...entries) => {
    const [total, fill] = entries
    return addDecimal({ left: total, 
      right: fill.quantity.amount })
  }, "0")
  const fillQuantityMatches = compareDecimal({
    left: reconciledQuantity,
    right: order.executedQuantity.amount,
  }) === 0
  const orderQuantityMatches = compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) === 0
  if (!fillQuantityMatches || !orderQuantityMatches) {
    return {
      ok: false,
      reason: "ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE",
      error: new Error("Execution history does not fully reconcile with the FILLED acknowledged order quantity"),
    }
  }
  return {
    ok: true,
    fills: uniqueFills,
  }
}

function createAcknowledgedExecutionOrder({ order, cumulativeQuantity, isFinalExecution }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: cumulativeQuantity,
      asset: order.market.baseAsset,
    }),
    status: isFinalExecution ? "FILLED" : "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: order.updatedAt,
    ...(isFinalExecution && order.completedAt !== undefined
      ? { completedAt: order.completedAt }
      : {}),
  })
}

async function applyAcknowledgedFillHistory({ order, fills, processUserDataEventTransition, pause }) {
  let cumulativeQuantity = "0"
  for (const fill of fills) {
    cumulativeQuantity = addDecimal({
      left: cumulativeQuantity,
      right: fill.quantity.amount,
    })
    const isFinalExecution = compareDecimal({
      left: cumulativeQuantity,
      right: order.executedQuantity.amount,
    }) === 0
    const executionOrder = createAcknowledgedExecutionOrder({
      order,
      cumulativeQuantity,
      isFinalExecution,
    })
    const processed = await processUserDataEventTransition({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: executionOrder,
        fill,
      },
    })
    if (!processed?.ok) {
      const error = processed?.errors?.[0] ?? new Error("Acknowledged order execution could not be applied")
      await pause({
        symbol: order.market.symbol,
        reason: "ACKNOWLEDGED_FILL_APPLICATION_FAILED",
        error,
      })
      return toResult({
        errors: processed?.errors ?? [error],
      })
    }
  }
  return toResult({
    data: {
      reconciled: true,
      fills: fills.length,
    },
  })
}

async function reconcileFilledAcknowledgementTransition({ order, broker, pause, processUserDataEventTransition }) {
  if (order.status !== "FILLED") {
    return toResult({
      data: {
        reconciled: false,
      },
    })
  }
  const fillsResult = await broker.getFills({
    symbol: order.market.symbol,
    orderId: order.brokerOrderId,
  })
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    const error = fillsResult?.errors?.[0] ?? new Error("Unable to retrieve executions for FILLED acknowledgement")
    await pause({
      symbol: order.market.symbol,
      reason: "ACKNOWLEDGED_BUY_FILL_RECONCILIATION_FAILED",
      error,
    })
    return toResult({
      error,
    })
  }
  const history = inspectAcknowledgedFillHistory({
    order,
    fills: fillsResult.data,
  })
  if (!history.ok) {
    await pause({
      symbol: order.market.symbol,
      reason: history.reason,
      error: history.error,
    })
    return toResult({
      error: history.error,
    })
  }
  return applyAcknowledgedFillHistory({
    order,
    fills: history.fills,
    processUserDataEventTransition,
    pause,
  })
}


async function persistCancellationIntent({ callback, order, reason }) {
  if (!callback) {
    return undefined
  }
  let intentResult
  try {
    intentResult = await callback({
      order,
      reason,
    })
  } catch (error) {
    return {
      ok: false,
      cancellationOutcome: "NOT_SENT",
      errors: [error],
    }
  }
  if (intentResult?.ok !== true || intentResult.data?.durable !== true) {
    return {
      ok: false,
      cancellationOutcome: "NOT_SENT",
      errors: intentResult?.errors?.length
        ? intentResult.errors
        : [new Error("Durable order-cancellation intent was not acknowledged")],
    }
  }
  return undefined
}

async function persistCancellationOutcome({ callback, order, canceledOrder, reason, outcome }) {
  if (!callback) {
    return undefined
  }
  try {
    const result = await callback({
      order,
      canceledOrder,
      reason,
      outcome,
    })
    if (result?.ok === true && result.data?.durable === true) {
      return undefined
    }
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: result?.errors?.length
        ? result.errors
        : [new Error("Durable cancellation outcome was not acknowledged")],
    }
  } catch (error) {
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: [error],
    }
  }
}

function classifyCancellationResponse({
    cancelResult,
    order,
  }) {
  let outcome
  let canceledOrder
  if (cancelResult?.ok === true && cancelResult.data instanceof CanonicalOrder) {
    canceledOrder = cancelResult.data
    const identityMatches = canceledOrder.clientOrderId === order.clientOrderId &&
      canceledOrder.brokerOrderId === order.brokerOrderId &&
      canceledOrder.market.id === order.market.id &&
      canceledOrder.side === order.side
    if (!identityMatches) {
      outcome = "UNKNOWN"
      canceledOrder = undefined
    } else if (["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(canceledOrder.status)) {
      outcome = canceledOrder.status
    } else if (["OPEN", "PARTIALLY_FILLED"].includes(canceledOrder.status)) {
      outcome = "NOT_CANCELED"
    } else {
      outcome = "UNCONFIRMED"
      canceledOrder = undefined
    }
  } else if (cancelResult?.cancellationOutcome === "NOT_SENT") {
    outcome = "NOT_SENT"
  } else if (cancelResult?.cancellationOutcome === "OUTCOME_UNKNOWN") {
    outcome = "OUTCOME_UNKNOWN"
  } else {
    outcome = "UNCONFIRMED"
  }
  return {
    outcome,
    canceledOrder,
  }
}

async function handleCancellationRpcException({ error, callback, order, reason }) {
  const recorded = await persistCancellationOutcome({
    callback,
    order,
    reason,
    outcome: "OUTCOME_UNKNOWN",
  })
  return recorded ?? {
    ok: false,
    cancellationOutcome: "OUTCOME_UNKNOWN",
    errors: [error],
  }
}

async function persistCancellationClassification({
  callback,
  order,
  reason,
  cancelResult,
}) {
  if (!callback) {
    return cancelResult
  }
  const classification = classifyCancellationResponse({
    cancelResult,
    order,
  })
  const outcomeFailure = await persistCancellationOutcome({
    callback,
    order,
    canceledOrder: classification.canceledOrder,
    reason,
    outcome: classification.outcome,
  })
  if (outcomeFailure) {
    return outcomeFailure
  }
  if (["UNKNOWN", "UNCONFIRMED"].includes(classification.outcome)) {
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: [new Error("Broker cancellation response did not confirm the owned order identity and terminal state")],
    }
  }
  return cancelResult
}

async function cancelOrderWithOperationalStateTransition({ dependencies, order, reason }) {
  const {
    broker,
    onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome,
    logger,
    state,
  } = dependencies
  const intentFailure = await persistCancellationIntent({
    callback: onOperationalStateCancellationIntent,
    order,
    reason,
  })
  if (intentFailure) {
    return intentFailure
  }
  logOrderLifecycle({
    logger,
    order,
    ownership: state?.registry?.getOwnership?.({ clientOrderId: order.clientOrderId }),
    status: "CANCEL_REQUESTED",
  })
  let cancelResult
  try {
    cancelResult = await broker.cancelOrder({ order })
  } catch (error) {
    return handleCancellationRpcException({
      error,
      callback: onOperationalStateCancellationOutcome,
      order,
      reason,
    })
  }
  return persistCancellationClassification({
    callback: onOperationalStateCancellationOutcome,
    order,
    reason,
    cancelResult,
  })
}


function recoverySellFailure({
  error,
  errors,
  category = "ORDER_TRANSITION",
  stage = "RECOVERY_SELL_CANCELLATION",
  retryable = true,
}) {
  return failureResult({
    ...(errors === undefined ? { error } : { errors }),
    category,
    stage,
    retryable,
  })
}

async function prepareRecoverySellCancellation({ context, order, symbol }) {
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: "RECOVERY_SELL_CANCELLATION_INELIGIBLE",
  })
  if (!eligibility.ok) {
    return withFailure(eligibility, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
    }),
  })
  if (intent.ok) {
    return undefined
  }
  const error = intent.errors?.[0] ?? new Error("Recovery SELL cancellation intent was not durably journaled")
  await context.pause({
    symbol,
    reason: "RECOVERY_SELL_CANCEL_INTENT_NOT_DURABLE",
    error,
  })
  return recoverySellFailure({
    error,
    errors: intent.errors ?? [error],
    category: "DURABILITY",
    stage: "RECOVERY_SELL_CANCEL_INTENT",
  })
}

async function executeRecoverySellCancellation({ context, order, symbol }) {
  let result
  try {
    result = await context.cancelOrderWithOperationalState({
      order,
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
    })
  } catch (error) {
    const failed = await context.markCancellationUnknown({
      symbol,
      order,
      reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
      error,
    })
    return withFailure(failed, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const errors = result?.errors ?? [new Error("Broker did not confirm a canonical canceled order")]
    const failed = await context.markCancellationFailure({
      symbol,
      order,
      reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
      error: errors[0],
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
    })
    return withFailure(failed, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  return {
    ok: true,
    data: result.data,
  }
}

async function requestRecoverySellCancellation({ context, order, symbol }) {
  const preparation = await prepareRecoverySellCancellation({
    context,
    order,
    symbol,
  })
  if (preparation) {
    return preparation
  }
  return executeRecoverySellCancellation({
    context,
    order,
    symbol,
  })
}

function getRecoveryCycleCompletionFailure({ completion }) {
  if (!completion?.ok) {
    return {
      reason: completion?.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED",
      errors: completion?.errors ?? [new Error("Recovery cycle completion evaluation failed")],
    }
  }
  const allowedContinuationReasons = [
    "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
  ]
  if (completion.data?.eligible || allowedContinuationReasons.includes(completion.data?.reason)) {
    return undefined
  }
  return {
    reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
    error: new Error("Recovery cycle completion was not eligible after terminal FILLED reconciliation"),
  }
}

async function completeFilledRecoverySellCycle({ context, order, symbol }) {
  const completion = await context.completeRecoveryCycle({
    marketId: order.market.id,
    keepQuantity: String(context.pairs[symbol].keepQuantity),
    minProfit: String(context.pairs[symbol].minProfit),
    sellOrder: order,
  })
  if (completion?.ok && !completion.data?.eligible) {
    context.publishRecoveryCycleNotCompleted({
      order,
      completion,
    })
  }
  const failure = getRecoveryCycleCompletionFailure({ completion })
  if (failure) {
    await context.pause({
      symbol,
      reason: failure.reason,
      error: failure.errors?.[0] ?? failure.error,
    })
    return failure.errors
      ? toResult({ errors: failure.errors })
      : toResult({ error: failure.error })
  }
  return {
    ok: true,
    data: completion.data,
  }
}


function publishCompletedRecoverySellCycle({ context, order, symbol, completion }) {
  if (!completion.eligible) {
    return
  }
  publishLifecycleEvent({
    eventPublisher: context.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
    dataResult: mapRecoveryCycleCompletedData({
      symbol,
      marketId: order.market.id,
      freeQuantity: completion.freeQuantity,
      keepQuantity: String(context.pairs[symbol].keepQuantity),
      minProfit: String(context.pairs[symbol].minProfit),
      realizedNetProfit: completion.realizedNetProfit,
      ...(completion.dust === undefined ? {} : { dust: completion.dust }),
    }),
  })
  context.state.completedRecoverySellSymbols.delete(symbol)
  context.state.completedRecoverySellOrdersBySymbol.delete(symbol)
  context.state.trailingBuy.set(symbol, true)
}

async function finishFilledRecoverySell({ context, order, symbol }) {
  if (compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_FILLED_QUANTITY_MISMATCH",
    })
    return toResult({
      error: new Error("FILLED recovery SELL does not reconcile to its original quantity"),
    })
  }
  try {
    context.assertReconciledSellExecution({
      order,
    })
  } catch (error) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_FILL_RECONCILIATION_FAILED",
      error,
    })
    return toResult({
      error,
    })
  }
  const result = await completeFilledRecoverySellCycle({
    context,
    order,
    symbol,
  })
  if (!result.ok) {
    return result
  }
  publishCompletedRecoverySellCycle({
    context,
    order,
    symbol,
    completion: result.data,
  })
  context.state.replacementIntents.delete(symbol)
  context.state.sellExecutionTotals.delete(order.brokerOrderId)
  return toResult({
    data: {
      completed: result.data.eligible === true,
    },
  })
}

function publishRecoverySellCancellationOutcome({ context, canceledOrder }) {
  if (canceledOrder.status === "CANCELED") {
    context.publishOrderCancelled({
      order: canceledOrder,
    })
    return
  }
  context.publishOrderCancelFailed({
    order: canceledOrder,
    outcome: canceledOrder.status === "FILLED" ? "ALREADY_FILLED" : "TERMINAL_STATE_CHANGED",
    error: new Error(`Recovery SELL reached terminal status ${  canceledOrder.status  } while cancellation was in flight`),
  })
}

async function resolveRecoverySellCancellationOrder({ context, order, canceledOrder, symbol }) {
  const update = context.state.registry.applyUpdate({
    order: canceledOrder,
  })
  if (update.unknown) {
    const error = new Error("Canceled recovery SELL is not registered by Harvester")
    context.publishOrderCancelFailed({
      order,
      outcome: "NOT_REGISTERED",
      error,
    })
    await context.pause({
      symbol,
      reason: "CANCELED_ORDER_NOT_REGISTERED",
    })
    return recoverySellFailure({
      error,
      category: "OWNERSHIP_INTEGRITY",
      stage: "CANCELED_ORDER_REGISTRY_MATCH",
      retryable: false,
    })
  }

  const terminalStatuses = new Set(["CANCELED", "FILLED", "EXPIRED", "REJECTED"])
  let effectiveCanceledOrder = canceledOrder
  if (update.stale) {
    const latestOrder = context.state.registry.getOrder({
      clientOrderId: canceledOrder.clientOrderId,
    })
    if (!terminalStatuses.has(latestOrder?.status)) {
      const error = new Error("Recovery SELL cancellation response was stale relative to a newer non-terminal order update")
      context.publishOrderCancelFailed({
        order,
        outcome: "CANCELLATION_RESPONSE_STALE",
        error,
      })
      await context.pause({
        symbol,
        reason: "RECOVERY_SELL_CANCELLATION_RESPONSE_STALE",
        error,
      })
      return recoverySellFailure({
        error,
        category: "ORDER_TRANSITION",
        stage: "RECOVERY_SELL_CANCELLATION_RESPONSE_STALE",
        retryable: true,
      })
    }
    effectiveCanceledOrder = latestOrder
  }
  context.state.registry = update.registry
  return toResult({
    data: {
      canceledOrder: effectiveCanceledOrder,
    },
  })
}

async function rejectUnconfirmedRecoverySellCancellation({ context, order, symbol }) {
  const error = new Error("Recovery SELL did not reach an authoritative terminal state")
  context.publishOrderCancelFailed({
    order,
    outcome: "CANCELLATION_UNCONFIRMED",
    error,
  })
  await context.pause({
    symbol,
    reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
    error,
  })
  return recoverySellFailure({
    error: new Error("Recovery SELL cancellation did not reach a terminal state"),
  })
}

async function rejectRecoverySellQuantityMismatch({ context, symbol }) {
  const error = new Error("Non-FILLED terminal recovery SELL reports its full original quantity as executed")
  await context.pause({
    symbol,
    reason: "RECOVERY_SELL_TERMINAL_STATUS_QUANTITY_MISMATCH",
  })
  return toResult({ error })
}

function hasFullRecoverySellExecution({ order }) {
  return compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) === 0
}

async function applyRecoverySellCancellation({ context, order, canceledOrder, symbol }) {
  const resolution = await resolveRecoverySellCancellationOrder({
    context,
    order,
    canceledOrder,
    symbol,
  })
  if (!resolution?.ok) {
    return resolution
  }
  const effectiveCanceledOrder = resolution.data.canceledOrder
  const terminalStatuses = new Set(["CANCELED", "FILLED", "EXPIRED", "REJECTED"])
  if (!terminalStatuses.has(effectiveCanceledOrder.status)) {
    return rejectUnconfirmedRecoverySellCancellation({
      context,
      order: effectiveCanceledOrder,
      symbol,
    })
  }
  publishRecoverySellCancellationOutcome({
    context,
    canceledOrder: effectiveCanceledOrder,
  })
  const terminalReconciliation = await context.reconcileTerminalOrderFills({
    order: effectiveCanceledOrder,
  })
  if (!terminalReconciliation?.ok) {
    return terminalReconciliation
  }
  context.state.reconciledTerminalOrderClientIds.add(effectiveCanceledOrder.clientOrderId)
  if (effectiveCanceledOrder.status === "FILLED") {
    context.state.completedOrderTransitions.add(effectiveCanceledOrder.clientOrderId)
    context.state.completedRecoverySellSymbols.add(symbol)
    context.state.completedRecoverySellOrdersBySymbol.set(symbol, effectiveCanceledOrder)
    return finishFilledRecoverySell({
      context,
      order: effectiveCanceledOrder,
      symbol,
    })
  }
  if (hasFullRecoverySellExecution({ order: effectiveCanceledOrder })) {
    return rejectRecoverySellQuantityMismatch({
      context,
      symbol,
    })
  }
  return toResult({
    data: {
      canceled: true,
    },
  })
}


async function processRecoverySellCancellation({ context, order, symbol }) {
  if (order.status === "PENDING") {
    context.state.replacementIntents.add(symbol)
    return toResult({
      data: {
        deferred: true,
        reason: "RECOVERY_SELL_PENDING_ACKNOWLEDGEMENT",
      },
    })
  }
  if (order.status === "UNKNOWN") {
    const error = new Error("Cannot safely cancel a recovery SELL with unknown status")
    context.publishOrderCancelFailed({
      order,
      outcome: "ORDER_STATE_UNKNOWN",
      error,
    })
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_ORDER_STATE_UNKNOWN",
    })
    return recoverySellFailure({
      error,
    })
  }
  const result = await requestRecoverySellCancellation({
    context,
    order,
    symbol,
  })
  if (!result?.ok) {
    return result
  }
  return applyRecoverySellCancellation({
    context,
    order,
    canceledOrder: result.data,
    symbol,
  })
}

async function cancelRecoverySells({ context, symbol, marketId }) {
  const activeSells = context.state.registry.getActiveOrders({
    marketId,
  }).filter((order) => order.side === "SELL")
  for (const order of activeSells) {
    context.logger?.info?.({
      message: "Harvester recovery SELL cancellation requested",
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      symbol,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    })
    const result = await processRecoverySellCancellation({
      context,
      order,
      symbol,
    })
    if (!result?.ok || result.data?.deferred === true) {
      return result
    }
  }
  return toResult({
    data: {
      canceled: activeSells.length,
    },
  })
}


function publishTrailingBuyCancellationOutcome({ context, canceledOrder }) {
  if (canceledOrder.status === "CANCELED") {
    context.publishOrderCancelled({
      order: canceledOrder,
    })
    return
  }
  context.publishOrderCancelFailed({
    order: canceledOrder,
    outcome: "NOT_CANCELED",
    error: new Error("Trailing BUY completed instead of being canceled"),
  })
}

async function applyTrailingBuyCancellationToRegistry({ context, symbol, order, canceledOrder }) {
  const update = context.state.registry.applyUpdate({
    order: canceledOrder,
  })
  if (update.unknown) {
    const error = new Error("Canceled trailing BUY is not registered by Harvester")
    context.publishOrderCancelFailed({
      order,
      outcome: "NOT_REGISTERED",
      error,
    })
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_CANCELLATION_NOT_REGISTERED",
    })
    return toResult({
      error,
    })
  }
  context.state.registry = update.registry
  publishTrailingBuyCancellationOutcome({
    context,
    canceledOrder,
  })
  return toResult({
    data: {
      canceledOrder,
    },
  })
}

async function cancelTrailingBuyOrder({ context, symbol, order }) {
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: "TRAILING_BUY_CANCELLATION_INELIGIBLE",
  })
  if (!eligibility.ok) {
    return eligibility
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason: "TRAILING_BUY_REPRICE",
    }),
  })
  if (!intent.ok) {
    const error = intent.errors?.[0] ?? new Error("Trailing BUY cancellation intent was not durably journaled")
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_CANCEL_INTENT_NOT_DURABLE",
      error,
    })
    return toResult({
      errors: intent.errors ?? [error],
    })
  }
  let result
  try {
    result = await context.cancelOrderWithOperationalState({
      order,
      reason: "TRAILING_BUY_REPRICE",
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
      error,
    })
  }
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const errors = result?.errors ?? [new Error("Broker did not confirm a canonical BUY cancellation")]
    return context.markCancellationFailure({
      symbol,
      order,
      reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
      error: errors[0],
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
    })
  }
  return applyTrailingBuyCancellationToRegistry({
    context,
    symbol,
    order,
    canceledOrder: result.data,
  })
}

function matchesOwnedBuyExecutionIdentity({
      fill,
      order,
    }) {
  return fill instanceof Fill &&
    fill.market.id === order.market.id &&
    fill.side === "BUY" &&
    fill.brokerOrderId === order.brokerOrderId &&
    (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
}

function matchesTrailingBuyFillIdentity({
      fill,
      order,
    }) {
  return matchesOwnedBuyExecutionIdentity({
    fill,
    order,
  })
}

async function applyTrailingBuyFillHistory({ context, symbol, order, fills }) {
  let reconciledQuantity = "0"
  const seenFillIds = new Set()
  for (const fill of fills) {
    if (!matchesTrailingBuyFillIdentity({
      fill,
      order,
    })) {
      await context.pause({
        symbol,
        reason: "TRAILING_BUY_FILL_IDENTITY_MISMATCH",
      })
      return toResult({
        error: new Error("Recovered BUY fill does not match the canceled order"),
      })
    }
    const accounting = await context.updateTradingAccounting({
      fill,
    })
    if (!accounting?.ok) {
      const errors = accounting?.errors ?? [new Error("Recovered BUY fill accounting failed")]
      await context.pause({
        symbol,
        reason: "TRAILING_BUY_FILL_ACCOUNTING_FAILED",
        error: errors[0],
      })
      return toResult({ errors })
    }
    if (!seenFillIds.has(fill.id)) {
      reconciledQuantity = addDecimal({
        left: reconciledQuantity,
        right: fill.quantity.amount,
      })
      seenFillIds.add(fill.id)
    }
  }
  return toResult({ data: { reconciledQuantity } })
}

async function reconcileTrailingBuyFills({ context, symbol, order, canceledOrder }) {
  const fillsResult = await context.broker.getFills({
    symbol,
    orderId: order.brokerOrderId,
  })
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    const errors = fillsResult?.errors ?? [new Error("Unable to reconcile trailing BUY fills after cancellation")]
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_FILL_RECONCILIATION_FAILED",
      error: errors[0],
    })
    return toResult({ errors })
  }
  const reconciliation = await applyTrailingBuyFillHistory({
    context,
    symbol,
    order,
    fills: fillsResult.data,
  })
  if (!reconciliation.ok) {
    return reconciliation
  }
  const { reconciledQuantity } = reconciliation.data
  if (compareDecimal({
    left: reconciledQuantity,
    right: canceledOrder.executedQuantity.amount,
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_EXECUTED_QUANTITY_MISMATCH",
    })
    return toResult({
      error: new Error("Canceled BUY cumulative execution does not match reconciled fills"),
    })
  }
  return reconciliation
}


async function cancelAndReconcileTrailingBuyTransition({ context, symbol, order }) {
  const cancellation = await cancelTrailingBuyOrder({
    context,
    symbol,
    order,
  })
  if (!cancellation.ok) {
    return cancellation
  }
  const { canceledOrder } = cancellation.data
  const fills = await reconcileTrailingBuyFills({
    context,
    symbol,
    order,
    canceledOrder,
  })
  if (!fills.ok) {
    return fills
  }
  if (canceledOrder.status !== "CANCELED" || compareDecimal({
    left: fills.data.reconciledQuantity,
    right: "0",
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_FILLED_DURING_CANCEL",
    })
    return toResult({
      error: new Error("Trailing BUY filled during cancellation; pair paused after fill reconciliation"),
    })
  }
  return toResult({
    data: {
      canceledOrder,
    },
  })
}


function getTrailingBuyContext({
    context,
    symbol,
  }) {
  const metadata = context.getCurrentMarketMetadata({
    symbol,
  })
  const pairConfig = context.pairs[symbol]
  const activeBuy = context.state.registry.getActiveOrders({
    marketId: metadata.market.id,
  }).find((order) => order.side === "BUY")
  return {
    metadata,
    pairConfig,
    activeBuy,
  }
}

function logTrailingBuyActivePosition({ context, symbol, metadata, position, activePositionQuantity }) {
  context.logger?.debug?.({
    message: "Harvester trailing BUY repricing skipped",
    symbol,
    reason: "ACTIVE_POSITION_EXISTS",
    marketId: metadata.market.id,
    activePositionQuantity,
    freeBaseQuantity: position?.freeBaseQuantity.amount ?? "0",
  })
}

function getTrailingBuyActivePositionSkip({
    context,
    symbol,
    metadata,
  }) {
  const position = context.getPortfolio().getPosition({ strategyId: StrategyId.COIN_GRABBER,
    marketId: metadata.market.id,
  })
  const activePositionQuantity = position?.baseQuantity.amount ?? "0"
  if (compareDecimal({
    left: activePositionQuantity,
    right: "0",
  }) <= 0) {
    return undefined
  }
  logTrailingBuyActivePosition({
    context,
    symbol,
    metadata,
    position,
    activePositionQuantity,
  })
  return toResult({
    data: {
      skipped: true,
      reason: "ACTIVE_POSITION_EXISTS",
    },
  })
}

function getTrailingBuyPreflightSkip({ preflight, activeBuy }) {
  if (preflight.data?.preflightValid === true) {
    return undefined
  }
  return toResult({
    data: {
      skipped: true,
      reason: preflight.data?.reason ?? "TRAILING_BUY_REPLACEMENT_NOT_ADMISSIBLE",
      previousOrderId: activeBuy.brokerOrderId,
    },
  })
}

function evaluateTrailingBuyTrigger({ context, symbol, marketPrice, pairConfig, activeBuy }) {
  const referencePrice = context.state.lastAdjustmentPrices.get(symbol) ?? marketPrice.price
  const trigger = context.strategyPolicy.evaluateTrailingBuyRepricing({
    marketPrice: marketPrice.price,
    referencePrice,
    priceStepPercent: String(pairConfig.priceStepPercent),
  })
  context.logger?.debug?.({
    message: "Harvester trailing BUY repricing evaluated",
    marketEventId: context.state.marketPriceEventIds.get(symbol) ?? null,
    symbol,
    activeBuy: activeBuy.value,
    marketPrice: marketPrice.price,
    referencePrice,
    lastBuyPrice: context.state.lastBuyPrices.get(symbol) ?? null,
    buyReferenceOverride: context.state.buyReferenceOverrides.get(symbol) ?? null,
    lastAdjustmentPrice: context.state.lastAdjustmentPrices.get(symbol) ?? null,
    priceStepPercent: String(pairConfig.priceStepPercent),
    trigger,
  })
  return trigger
}

function hasActiveRecoveryPosition({ portfolio, marketId } = {}) {
  const position = portfolio.getPosition({
    marketId,
    strategyId: StrategyId.COIN_GRABBER,
  })
  return position && compareDecimal({
    left: position.baseQuantity.amount,
    right: "0",
  }) > 0
}

function hasActiveRecoverySell({ state, marketId } = {}) {
  return state.registry.getActiveOrders({ marketId }).some((order) => {
    if (order.side !== "SELL") {
      return false
    }
    const ownership = state.registry.getOwnership({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      marketId,
    })
    return ownership?.strategyId === StrategyId.COIN_GRABBER
  })
}

async function refreshRecoverySellMarketMetadataForEvaluation({ context, symbol } = {}) {
  const metadata = context.getCurrentMarketMetadata({ symbol })
  const marketId = metadata.market.id
  const portfolio = context.dependencies.getPortfolio()
  const hasActivePosition = hasActiveRecoveryPosition({
    portfolio,
    marketId,
  })
  const hasActiveSell = hasActiveRecoverySell({
    state: context.state,
    marketId,
  })
  if (!hasActivePosition || hasActiveSell) {
    return toResult({ data: metadata })
  }
  const result = await context.refreshMarketMetadata({
    symbol,
    pairConfig: context.pairs[symbol],
    metadata,
  })
  if (!result.ok) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_FILTERS_UNAVAILABLE",
      error: result.errors?.[0],
    })
  }
  return result
}

function createRecoverySellMetadataRefreshOperation({ context } = {}) {
  return (options = {}) => refreshRecoverySellMarketMetadataForEvaluation({
    context,
    ...options,
  })
}

async function refreshTrailingBuyMarketMetadata({ context, symbol, pairConfig, metadata }) {
  const result = await context.refreshMarketMetadata({
    symbol,
    pairConfig,
    metadata,
    force: true,
  })
  if (!result.ok) {
    const refreshError = result.errors?.[0]
    const error = refreshError instanceof MarketMetadataRefreshError && refreshError.cause !== undefined
      ? refreshError.cause
      : refreshError
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_REPLACEMENT_RULES_UNAVAILABLE",
      error,
    })
    return toResult({ error })
  }
  return result
}

async function preflightTrailingBuyReplacement({ context, symbol, activeBuy, marketPrice }) {
  const result = await context.evaluateLatestTransition({
    symbol,
    preflightOnly: true,
    excludedActiveOrderClientId: activeBuy.clientOrderId,
    referencePriceOverride: marketPrice.price,
  })
  if (!result.ok) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_REPLACEMENT_VALIDATION_FAILED",
      error: result.errors?.[0],
    })
  }
  return result
}

async function replaceTrailingBuy({ context, symbol, activeBuy, marketPrice, trigger }) {
  const cancellation = await context.cancelAndReconcileTrailingBuy({
    symbol,
    order: activeBuy,
  })
  if (!cancellation.ok) {
    return cancellation
  }
  context.state.buyReferenceOverrides.set(symbol, marketPrice.price)
  if (!context.canTrade({
    symbol,
  }) || context.isStopping?.()) {
    return toResult({
      data: {
        canceled: true,
        waitingForTradingReadiness: true,
      },
    })
  }
  const result = await context.evaluateLatestTransition({
    symbol,
  })
  if (!result.ok) {
    return result
  }
  return toResult({
    data: {
      ...result.data,
      trailingBuyReplaced: result.data.submittedOrders?.some((order) => order.side === "BUY") ?? false,
      previousOrderId: activeBuy.brokerOrderId,
      adjustmentThreshold: trigger.adjustmentThreshold,
    },
  })
}

async function prepareTrailingBuyReplacement({ context, symbol, pairConfig, metadata, activeBuy, marketPrice } = {}) {
  const refreshed = await refreshTrailingBuyMarketMetadata({
    context,
    symbol,
    pairConfig,
    metadata,
  })
  if (!refreshed.ok) {
    return refreshed
  }
  const preflight = await preflightTrailingBuyReplacement({
    context,
    symbol,
    activeBuy,
    marketPrice,
  })
  if (!preflight.ok) {
    return preflight
  }
  return getTrailingBuyPreflightSkip({
    preflight,
    activeBuy,
  })
}

async function getTrailingBuyReplacementCandidate({ context, symbol, marketPrice }) {
  if (context.state.shutdownBuyGate === true) {
    return {
      result: toResult({
        data: {
          skipped: true,
          reason: "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE",
        },
      }),
    }
  }
  if (isOperatorBuyPauseActive({
    state: context.state,
    symbol,
  })) {
    return { result: await context.evaluateLatestTransition({ symbol }) }
  }
  const { metadata, pairConfig, activeBuy } = getTrailingBuyContext({
    context,
    symbol,
  })
  if (!activeBuy || context.state.trailingBuy.get(symbol) === false) {
    return { result: await context.evaluateLatestTransition({ symbol }) }
  }
  const positionSkip = getTrailingBuyActivePositionSkip({
    context,
    symbol,
    metadata,
  })
  if (positionSkip) {
    // Skip only trailing-BUY replacement; recovery SELL evaluation must continue.
    return { result: await context.evaluateLatestTransition({ symbol }) }
  }
  const trigger = evaluateTrailingBuyTrigger({
    context,
    symbol,
    marketPrice,
    pairConfig,
    activeBuy,
  })
  if (!trigger.shouldReplace) {
    return { result: await context.evaluateLatestTransition({ symbol }) }
  }
  if (context.isStopping?.()) {
    return {
      result: toResult({
        data: {
          skipped: true,
          reason: "STOPPING",
        },
      }),
    }
  }
  return {
    metadata,
    pairConfig,
    activeBuy,
    trigger,
  }
}

async function maybeReplaceTrailingBuyTransition({ context, symbol, marketPrice }) {
  const candidate = await getTrailingBuyReplacementCandidate({
    context,
    symbol,
    marketPrice,
  })
  if (Object.hasOwn(candidate, "result")) {
    return candidate.result
  }
  const preparationFailure = await prepareTrailingBuyReplacement({
    context,
    symbol,
    pairConfig: candidate.pairConfig,
    metadata: candidate.metadata,
    activeBuy: candidate.activeBuy,
    marketPrice,
  })
  if (preparationFailure) {
    return preparationFailure
  }
  return replaceTrailingBuy({
    context,
    symbol,
    activeBuy: candidate.activeBuy,
    marketPrice,
    trigger: candidate.trigger,
  })
}


function validateOwnedOrderSnapshotParity({ context, snapshots, requestedSymbols = null }) {
  const snapshotOrderIds = new Set(snapshots.map(({ ownedOrder }) => ownedOrder.brokerOrderId))
  const currentOrders = context.state.registry.orders.filter((order) =>
    requestedSymbols === null || requestedSymbols.has(order.market.symbol))
  for (const currentOrder of currentOrders) {
    context.affectedSymbol = currentOrder.market.symbol
    if (!currentOrder.brokerOrderId || !snapshotOrderIds.has(currentOrder.brokerOrderId)) {
      throw recoveryFailureError(
        new Error("Order registry changed while REST reconciliation was in progress"),
        "ORDER_TRANSITION",
        "REST_STREAM_REGISTRY_RACE",
        true,
      )
    }
  }
  for (const snapshot of snapshots) {
    const {
      ownedOrder,
      historyOrder,
      fillIds,
    } = snapshot
    context.affectedSymbol = ownedOrder.market.symbol
    const currentOrder = context.state.registry.orders.find(
      (order) => order.brokerOrderId === ownedOrder.brokerOrderId,
    )
    if (!currentOrder) {
      throw recoveryFailureError(
        new Error(`Owned order disappeared from the registry during REST reconciliation: ${  ownedOrder.brokerOrderId}`),
        "OWNERSHIP_INTEGRITY",
        "REST_STREAM_ORDER_OWNERSHIP",
        false,
      )
    }
    if (compareDecimal({
      left: historyOrder.executedQuantity.amount,
      right: currentOrder.executedQuantity.amount,
    }) < 0) {
      throw recoveryFailureError(
        new Error(`REST order history is behind the registered cumulative execution quantity for ${  ownedOrder.brokerOrderId}`),
        "REST_RECONCILIATION",
        "REST_STREAM_EXECUTION_LAG",
        true,
      )
    }
    const processedFillIds = context.state.processedFillIdsByOrder.get(ownedOrder.brokerOrderId) ?? new Set()
    for (const fillId of processedFillIds) {
      if (!fillIds.has(fillId)) {
        throw recoveryFailureError(
          new Error(`REST fill history is missing previously processed execution ID ${  fillId}`),
          "ACCOUNTING_INTEGRITY",
          "REST_STREAM_JOURNAL_FILL_PARITY",
          false,
        )
      }
    }
  }
}

async function applyOwnedOrderSnapshotFills({ context, ownedOrder, currentOrder, fills }) {
  for (const fill of fills) {
    const processed = await context.processExecutionFillTransition({
      order: currentOrder,
      fill,
    })
    if (!processed.ok) {
      const error = processed.errors?.[0] ?? new Error("Recovered fill could not be applied")
      await context.pause({
        symbol: ownedOrder.market.symbol,
        reason: "REST_FILL_RECONCILIATION_FAILED",
        error,
      })
      return withFailure(
        toResult({ errors: processed.errors ?? [error] }),
        processed.failure ?? {
          category: "ACCOUNTING_INTEGRITY",
          stage: "REST_FILL_ACCOUNTING",
          retryable: false,
        },
      )
    }
  }
  return undefined
}

async function applyOwnedOrderSnapshotState({ context, ownedOrder, historyOrder, recoveryMode }) {
  const processedOrder = await context.processUserDataEventTransition({
    event: { executedOrder: historyOrder },
    recoveryMode,
    terminalFillsReconciled: true,
  })
  if (processedOrder.ok) {
    return undefined
  }
  const error = processedOrder.errors?.[0] ?? new Error("Recovered order state could not be applied")
  await context.pause({
    symbol: ownedOrder.market.symbol,
    reason: "REST_ORDER_RECONCILIATION_FAILED",
    error,
  })
  return withFailure(
    toResult({ errors: processedOrder.errors ?? [error] }),
    processedOrder.failure ?? {
      category: "ACCOUNTING_INTEGRITY",
      stage: "REST_ORDER_STATE_APPLICATION",
      retryable: false,
    },
  )
}

async function applyOwnedOrderSnapshotTransition({ context, snapshot, recoveryMode }) {
  const { ownedOrder, historyOrder, fills } = snapshot
  context.affectedSymbol = ownedOrder.market.symbol
  const currentOrder = context.state.registry.getOrder({
    clientOrderId: ownedOrder.clientOrderId,
  })
  if (!currentOrder) {
    throw recoveryFailureError(
      new Error(`Owned order disappeared before REST fill accounting: ${  ownedOrder.brokerOrderId}`),
      "OWNERSHIP_INTEGRITY",
      "REST_FILL_ORDER_OWNERSHIP",
      false,
    )
  }
  const fillResult = await applyOwnedOrderSnapshotFills({
    context,
    ownedOrder,
    currentOrder,
    fills,
  })
  if (fillResult) {
    return fillResult
  }
  return applyOwnedOrderSnapshotState({
    context,
    ownedOrder,
    historyOrder,
    recoveryMode,
  })
}

async function applyOwnedOrderSnapshotTransitions({ context, snapshots, recoveryMode }) {
  for (const snapshot of snapshots) {
    const result = await applyOwnedOrderSnapshotTransition({
      context,
      snapshot,
      recoveryMode,
    })
    if (result) {
      return result
    }
  }
  return undefined
}


async function applyOwnedOrderSnapshots({ context, snapshots, symbols, recoveryMode, requestedSymbols = null }) {
  const [firstSymbol] = symbols
  context.affectedSymbol = firstSymbol
  try {
    validateOwnedOrderSnapshotParity({
      context,
      snapshots,
      requestedSymbols,
    })
    const result = await applyOwnedOrderSnapshotTransitions({
      context,
      snapshots,
      recoveryMode,
    })
    if (result) {
      return result
    }
    return toResult({
      data: {
        reconciled: snapshots.length,
        symbols,
      },
    })
  } catch (error) {
    await context.pause({
      symbol: context.affectedSymbol,
      reason: "REST_STREAM_RECONCILIATION_FAILED",
      error,
    })
    return failureResult({
      error,
      category: error?.recoveryFailure?.category ?? "ACCOUNTING_INTEGRITY",
      stage: error?.recoveryFailure?.stage ?? "UNCLASSIFIED_REST_STREAM_PARITY",
      retryable: error?.recoveryFailure?.retryable ?? false,
    })
  }
}


function getBuyCancellationReasonPrefix({ reason }) {
  if (reason === "STRATEGY_SAFETY_PAUSE") {
    return "STRATEGY_SAFETY_PAUSE"
  }
  if (reason === "PROCESS_SHUTDOWN") {
    return "SHUTDOWN"
  }
  if (reason === "HIGH_VOLATILITY_PROTECTION") {
    return "VOLATILITY_PROTECTION"
  }
  if (reason === "OPERATOR_BUY_PAUSE") {
    return "OPERATOR_BUY_PAUSE"
  }
  return "ACCOUNT_INTEGRITY_HALT"
}

function getActiveBuyOrdersToCancel({ state, onlySymbol }) {
  return state.registry.getActiveOrders().filter((order) =>
    order.side === "BUY" &&
    (!onlySymbol || order.market.symbol === onlySymbol) &&
    ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
}

function createBuyCancellationFailure({ error, errors }) {
  return toResult({
    errors: errors ?? [error],
  })
}

async function prepareOwnedBuyCancellation({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  const { market: { symbol } } = order
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: `${reasonPrefix  }_BUY_CANCELLATION_INELIGIBLE`,
    pauseOnFailure,
  })
  if (!eligibility.ok) {
    return eligibility
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason,
    }),
  })
  if (intent.ok) {
    return undefined
  }
  const error = intent.errors?.[0] ?? new Error(`BUY cancellation intent was not durably journaled during ${  reasonPrefix}`)
  if (pauseOnFailure) {
    await context.pause({
      symbol,
      reason: `${reasonPrefix  }_BUY_CANCEL_INTENT_NOT_DURABLE`,
      error,
    })
  }
  return createBuyCancellationFailure({
    error,
    errors: intent.errors?.length ? intent.errors : [error],
  })
}

async function invokeOwnedBuyCancellation({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  try {
    return await context.cancelOrderWithOperationalState({
      order,
      reason,
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_UNCONFIRMED`,
      error,
      pauseOnFailure,
    })
  }
}

async function validateOwnedBuyCancellationResponse({ context, order, result, reasonPrefix, pauseOnFailure }) {
  const { market: { symbol } } = order
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const error = result?.errors?.[0] ?? new Error(`Broker did not confirm a canonical BUY cancellation during ${  reasonPrefix}`)
    return context.markCancellationFailure({
      symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_UNCONFIRMED`,
      error,
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
      pauseOnFailure,
    })
  }
  const cancellation = result.data
  const identityMatches = cancellation.clientOrderId === order.clientOrderId &&
    cancellation.brokerOrderId === order.brokerOrderId &&
    cancellation.market.id === order.market.id &&
    cancellation.side === "BUY"
  if (!identityMatches) {
    const error = new Error(`BUY cancellation response does not match the owned order during ${  reasonPrefix}`)
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_IDENTITY_MISMATCH`,
      error,
      pauseOnFailure,
    })
  }
  if (!["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(cancellation.status)) {
    const error = new Error(`BUY cancellation did not return a terminal order state during ${  reasonPrefix}`)
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_UNCONFIRMED`,
      error,
      pauseOnFailure,
    })
  }
  return {
    ok: true,
    data: cancellation,
  }
}

async function applyOwnedBuyCancellationToRegistry({ context, order, cancellation, reasonPrefix, pauseOnFailure }) {
  let update
  try {
    const currentOrder = context.state.registry.getOrder({
      clientOrderId: order.clientOrderId,
    })
    if (currentOrder?.status === "FILLED" && cancellation.status === "CANCELED") {
      return {
        ok: true,
        data: {
          reconciledOrder: currentOrder,
        },
      }
    }
    update = context.state.registry.applyUpdate({
      order: cancellation,
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_RECONCILIATION_FAILED`,
      error,
      pauseOnFailure,
    })
  }
  if (update.unknown) {
    const error = new Error("BUY cancellation response is not registered as a Harvester-owned order")
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_NOT_REGISTERED`,
      error,
      pauseOnFailure,
    })
  }
  context.state.registry = update.registry
  const reconciledOrder = context.state.registry.getOrder({
    clientOrderId: order.clientOrderId,
  })
  if (update.stale && !["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(reconciledOrder.status)) {
    const error = new Error("BUY cancellation response is stale and the owned order remains open")
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order: reconciledOrder,
      reason: `${reasonPrefix  }_BUY_CANCELLATION_UNCONFIRMED`,
      error,
    })
  }
  return {
    ok: true,
    data: {
      reconciledOrder,
    },
  }
}

async function readOwnedBuyExecutionHistory({ context, order }) {
  try {
    return await context.broker.getFills({
      symbol: order.market.symbol,
      orderId: order.brokerOrderId,
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}

function validateOwnedBuyExecutionHistory({ order, fillsResult, reasonPrefix }) {
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    return {
      ok: false,
      error: fillsResult?.errors?.[0] ?? new Error(`Unable to reconcile BUY execution history during ${  reasonPrefix}`),
    }
  }
  const fillsById = new Map()
  for (const fill of fillsResult.data) {
    if (!matchesOwnedBuyExecutionIdentity({
      fill,
      order,
    })) {
      return {
        ok: false,
        error: new Error(`BUY execution history contains a fill for a different order during ${  reasonPrefix}`),
        reason: `${reasonPrefix  }_BUY_FILL_IDENTITY_MISMATCH`,
      }
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return {
        ok: false,
        error: new Error(`BUY execution history contains conflicting duplicate fill facts during ${  reasonPrefix}`),
        reason: `${reasonPrefix  }_BUY_FILL_IDENTITY_MISMATCH`,
      }
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  const fills = [...fillsById.values()].sort((...entries) => {
    const [left, right] = entries
    if (left.executedAt !== undefined && right.executedAt !== undefined &&
        left.executedAt !== right.executedAt) {
      return left.executedAt - right.executedAt
    }
    return left.tradeId.localeCompare(right.tradeId)
  })
  return {
    ok: true,
    fills,
  }
}


function getOwnedBuyReconciledQuantity({ fills }) {
  return fills.reduce((...entries) => {
    const [total, fill] = entries
    return addDecimal({ left: total, 
      right: fill.quantity.amount })
  }, "0")
}

async function applyOwnedBuyExecutionFills({ context, order, fills, reasonPrefix }) {
  let reconciled = 0
  for (const fill of fills) {
    const currentOrder = context.state.registry.getOrder({
      clientOrderId: order.clientOrderId,
    }) ?? order
    const processed = await context.processExecutionFillTransition({
      order: currentOrder,
      fill,
    })
    if (!processed.ok) {
      const errors = processed.errors ?? [new Error(`BUY fill accounting failed during ${  reasonPrefix}`)]
      return {
        ok: false,
        errors,
      }
    }
    reconciled += 1
  }
  return {
    ok: true,
    data: {
      reconciled,
    },
  }
}

async function reconcileOwnedBuyCancellationFills({ context, order, cancellation, reasonPrefix }) {
  const fillsResult = await readOwnedBuyExecutionHistory({
    context,
    order,
    reasonPrefix,
  })
  const validation = validateOwnedBuyExecutionHistory({
    order,
    fillsResult,
    reasonPrefix,
  })
  if (!validation.ok) {
    await context.pause({
      symbol: order.market.symbol,
      reason: validation.reason ?? `${reasonPrefix  }_BUY_FILL_RECONCILIATION_FAILED`,
      error: validation.error,
    })
    return createBuyCancellationFailure({
      error: validation.error,
    })
  }
  const reconciledQuantity = getOwnedBuyReconciledQuantity({
    fills: validation.fills,
  })
  if (compareDecimal({
    left: reconciledQuantity,
    right: cancellation.executedQuantity.amount,
  }) !== 0) {
    const error = new Error(`BUY execution history does not match the terminal order executed quantity during ${  reasonPrefix}`)
    await context.pause({
      symbol: order.market.symbol,
      reason: `${reasonPrefix  }_BUY_EXECUTED_QUANTITY_MISMATCH`,
      error,
    })
    return createBuyCancellationFailure({
      error,
    })
  }
  return applyOwnedBuyExecutionFills({
    context,
    order,
    fills: validation.fills,
    reasonPrefix,
  })
}

function publishOwnedBuyCancellationResult({ context, reconciledOrder, fills, reasonPrefix }) {
  if (reconciledOrder.status === "CANCELED") {
    context.publishOrderCancelled({ order: reconciledOrder })
    return toResult({
      data: {
        canceled: 1,
        reconciled: fills.data?.reconciled ?? 0,
      },
    })
  }
  context.publishOrderCancelFailed({
    order: reconciledOrder,
    outcome: `${reconciledOrder.status  }_DURING_${  reasonPrefix}`,
    error: new Error(`The BUY order reached ${  reconciledOrder.status  } before ${  reasonPrefix  } cancellation completed`),
  })
  return toResult({
    data: {
      canceled: 0,
      reconciled: fills.data?.reconciled ?? 0,
    },
  })
}

async function cancelSingleOwnedBuyOrder({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  const prepared = await prepareOwnedBuyCancellation({
    context,
    order,
    reason,
    reasonPrefix,
    pauseOnFailure,
  })
  if (prepared) {
    return prepared
  }
  const result = await invokeOwnedBuyCancellation({
    context,
    order,
    reason,
    reasonPrefix,
    pauseOnFailure,
  })
  const validated = await validateOwnedBuyCancellationResponse({
    context,
    order,
    result,
    reasonPrefix,
    pauseOnFailure,
  })
  if (!validated?.ok) {
    return validated
  }
  const fills = await reconcileOwnedBuyCancellationFills({
    context,
    order,
    cancellation: validated.data,
    reasonPrefix,
  })
  const registryResult = await applyOwnedBuyCancellationToRegistry({
    context,
    order,
    cancellation: validated.data,
    reasonPrefix,
    pauseOnFailure,
  })
  if (!registryResult?.ok) {
    return registryResult
  }
  const { reconciledOrder } = registryResult.data
  if (!fills.ok) {
    return fills
  }
  return publishOwnedBuyCancellationResult({
    context,
    reconciledOrder,
    fills,
    reasonPrefix,
  })
}


async function cancelOwnedBuyOrdersTransition({ context, options }) {
  const reason = options.reason === undefined ? "PROCESS_SHUTDOWN" : options.reason
  const reasonPrefix = getBuyCancellationReasonPrefix({
    reason,
  })
  const activeBuyOrders = getActiveBuyOrdersToCancel({
    state: context.state,
    onlySymbol: options.symbol,
  })
  const errors = []
  let canceled = 0
  let reconciled = 0
  for (const order of activeBuyOrders) {
    const result = await cancelSingleOwnedBuyOrder({
      context,
      order,
      reason,
      reasonPrefix,
      pauseOnFailure: options.pauseOnFailure === undefined ? true : options.pauseOnFailure,
    })
    if (!result?.ok) {
      errors.push(...(result.errors ?? [new Error("Owned BUY cancellation failed")]))
      continue
    }
    canceled += result.data?.canceled ?? 0
    reconciled += result.data?.reconciled ?? 0
  }
  if (errors.length > 0) {
    return toResult({
      errors,
    })
  }
  return toResult({
    data: {
      canceled,
      reconciled,
    },
  })
}



function readAcknowledgedPendingOrder({ lookupResult }) {
  if (lookupResult?.ok !== false && lookupResult?.ok !== true) {
    throw recoveryFailureError(
      new Error("Canonical order lookup response is missing an explicit success flag"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_RESPONSE",
      false,
    )
  }
  if (lookupResult.ok === false) {
    throw recoveryFailureError(
      lookupResult.errors?.[0] ?? new Error("Unable to resolve order by clientOrderId"),
      "REST_RECONCILIATION",
      "PENDING_ORDER_LOOKUP",
      true,
    )
  }
  const acknowledgedOrder = lookupResult.data
  if (!(acknowledgedOrder instanceof CanonicalOrder)) {
    throw recoveryFailureError(
      new Error("Canonical order lookup did not return a CanonicalOrder"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_SHAPE",
      false,
    )
  }
  if (typeof acknowledgedOrder.brokerOrderId !== "string" || !acknowledgedOrder.brokerOrderId.trim()) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned an order without a brokerOrderId"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_SHAPE",
      false,
    )
  }
  return acknowledgedOrder
}

function validatePendingOrderIdentity({ pendingOrder, acknowledgedOrder }) {
  const identityMatches = acknowledgedOrder.clientOrderId === pendingOrder.clientOrderId &&
    acknowledgedOrder.market?.id === pendingOrder.market.id &&
    acknowledgedOrder.market?.symbol === pendingOrder.market.symbol &&
    acknowledgedOrder.side === pendingOrder.side &&
    acknowledgedOrder.type === pendingOrder.type
  if (!identityMatches) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned an order that does not match the pending order identity"),
      "OWNERSHIP_INTEGRITY",
      "PENDING_ORDER_LOOKUP_IDENTITY",
      false,
    )
  }
}

function validatePendingOrderImmutableFacts({ pendingOrder, acknowledgedOrder }) {
  const quantityMatches = compareDecimal({
    left: acknowledgedOrder.originalQuantity.amount,
    right: pendingOrder.originalQuantity.amount,
  }) === 0
  const limitPriceMatches = acknowledgedOrder.limitPrice === undefined
    ? pendingOrder.limitPrice === undefined
    : pendingOrder.limitPrice !== undefined &&
      compareDecimal({
        left: acknowledgedOrder.limitPrice.amount,
        right: pendingOrder.limitPrice.amount,
      }) === 0
  if (!quantityMatches || !limitPriceMatches) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned immutable order facts that conflict with the pending submission"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_PARITY",
      false,
    )
  }
}

function validatePendingOrderLookup({ pendingOrder, lookupResult }) {
  const acknowledgedOrder = readAcknowledgedPendingOrder({
    lookupResult,
  })
  validatePendingOrderIdentity({
    pendingOrder,
    acknowledgedOrder,
  })
  validatePendingOrderImmutableFacts({
    pendingOrder,
    acknowledgedOrder,
  })
  return acknowledgedOrder
}

async function lookupPendingOwnedOrder({ broker, pendingOrder }) {
  let lookupResult
  try {
    lookupResult = await broker.getCanonicalOrder({
      symbol: pendingOrder.market.symbol,
      clientOrderId: pendingOrder.clientOrderId,
    })
  } catch (error) {
    throw recoveryFailureError(
      error,
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_EXCEPTION",
      false,
    )
  }
  return validatePendingOrderLookup({
    pendingOrder,
    lookupResult,
  })
}

async function attachPendingOwnedOrder({ context, pendingOrder, acknowledgedOrder }) {
  const attachmentResult = await context.runTransition({
    task: async () => {
      const currentOrder = context.state.registry.getOrder({
        clientOrderId: pendingOrder.clientOrderId,
      })
      if (!currentOrder) {
        throw recoveryFailureError(
          new Error("Pending order disappeared before clientOrderId reconciliation"),
          "OWNERSHIP_INTEGRITY",
          "PENDING_ORDER_ATTACHMENT",
          false,
        )
      }
      if (currentOrder.brokerOrderId !== undefined) {
        if (currentOrder.brokerOrderId !== acknowledgedOrder.brokerOrderId) {
          throw recoveryFailureError(
            new Error("Client-order-ID lookup conflicts with the brokerOrderId already attached to the order"),
            "OWNERSHIP_INTEGRITY",
            "PENDING_ORDER_ATTACHMENT",
            false,
          )
        }
        return toResult({
          data: {
            order: currentOrder,
          },
        })
      }
      const attached = context.state.registry.attachAcknowledgedBrokerOrderId({
        order: acknowledgedOrder,
      })
      context.state.registry = attached.registry
      return toResult({
        data: {
          order: context.state.registry.getOrder({
            clientOrderId: pendingOrder.clientOrderId,
          }),
        },
      })
    },
  })
  if (!attachmentResult?.ok) {
    throw recoveryFailureError(
      attachmentResult?.errors?.[0] ?? new Error("Unable to attach the resolved brokerOrderId"),
      "OWNERSHIP_INTEGRITY",
      "PENDING_ORDER_ATTACHMENT",
      false,
    )
  }
}

async function reconcilePendingOwnedOrders({ context, pendingOrders }) {
  for (const pendingOrder of pendingOrders) {
    try {
      const acknowledgedOrder = await lookupPendingOwnedOrder({
        broker: context.broker,
        pendingOrder,
      })
      await attachPendingOwnedOrder({
        context,
        pendingOrder,
        acknowledgedOrder,
      })
    } catch (error) {
      return context.runTransition({
        task: async () => {
          await context.pause({
            symbol: pendingOrder.market.symbol,
            reason: "RECONCILIATION_PENDING_ORDER_OUTCOME",
            error,
          })
          const failure = error?.recoveryFailure ?? {
            category: "ACCOUNTING_INTEGRITY",
            stage: "UNCLASSIFIED_PENDING_ORDER_RECONCILIATION",
            retryable: false,
          }
          return failureResult({
            error,
            ...failure,
          })
        },
      })
    }
  }
  return undefined
}

async function collectAndApplyOwnedOrderSnapshots({ context, ownedOrders, symbols, recoveryMode, beforeApply, requestedSymbols }) {
  let snapshots
  try {
    snapshots = await context.collectOwnedOrderSnapshots({
      ownedOrders,
    })
    if (typeof beforeApply === "function") {
      await beforeApply()
    }
  } catch (error) {
    return context.runTransition({
      task: async () => {
        await context.pause({
          symbol: error.reconciliationSymbol ?? symbols[0],
          reason: "REST_STREAM_RECONCILIATION_FAILED",
          error,
        })
        return failureResult({
          error,
          category: error.recoveryFailure?.category ?? "ACCOUNTING_INTEGRITY",
          stage: error.recoveryFailure?.stage ?? "UNCLASSIFIED_OWNED_ORDER_RECONCILIATION",
          retryable: error.recoveryFailure?.retryable ?? false,
        })
      },
    })
  }
  return context.runTransition({
    task: () => context.applyOwnedOrderSnapshotsTransition({
      ...snapshots,
      recoveryMode,
      requestedSymbols,
    }),
  })
}

function matchesRequestedReconciliationMarket({ order, requestedSymbols } = {}) {
  return requestedSymbols === null || requestedSymbols.has(order.market.symbol)
}

async function reconcileOwnedOrdersTransition({ context, options }) {
  let requestedSymbols = null
  if (Array.isArray(options.symbols)) {
    requestedSymbols = new Set(options.symbols)
  } else if (typeof options.symbol === "string") {
    requestedSymbols = new Set([options.symbol])
  }
  const initialOrdersResult = await context.runTransition({
    task: async () => toResult({
      data: {
        ownedOrders: context.state.registry.orders.filter((order) =>
          matchesRequestedReconciliationMarket({ order,
            requestedSymbols })),
      },
    }),
  })
  if (!initialOrdersResult?.ok) {
    return initialOrdersResult
  }
  const pendingOrders = initialOrdersResult.data.ownedOrders.filter((order) => !order.brokerOrderId)
  const pendingResult = await reconcilePendingOwnedOrders({
    context,
    pendingOrders,
  })
  if (pendingResult) {
    return pendingResult
  }
  const ownedOrdersResult = await context.runTransition({
    task: async () => toResult({
      data: {
        ownedOrders: context.state.registry.orders.filter((order) =>
          matchesRequestedReconciliationMarket({ order,
            requestedSymbols })),
      },
    }),
  })
  if (!ownedOrdersResult?.ok) {
    return ownedOrdersResult
  }
  const { ownedOrders } = ownedOrdersResult.data
  const symbols = [...new Set(ownedOrders.map((order) => order.market.symbol))]
  if (ownedOrders.length === 0) {
    return toResult({
      data: {
        reconciled: 0,
        symbols: [],
      },
    })
  }
  return collectAndApplyOwnedOrderSnapshots({
    context,
    ownedOrders,
    symbols,
    requestedSymbols,
    recoveryMode: options.recoveryMode === undefined ? false : options.recoveryMode,
    beforeApply: options.beforeApply,
  })
}

/** Coordinate an injected strategy policy, in-process order ownership, and actual fills. */


function publishSubmissionDeferral({ eventPublisher, order, reason, purpose, registered } = {}) {
  const dataResult = mapOrderSubmissionDeferredData({
    order,
    reason,
    purpose,
    registered,
  })
  if (dataResult?.ok !== true) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_DEFERRED,
      dataResult,
    })
    throw dataResult?.errors?.[0] ?? new TypeError("Local submission deferral evidence is invalid")
  }
  return publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_DEFERRED,
    dataResult,
  })
}
