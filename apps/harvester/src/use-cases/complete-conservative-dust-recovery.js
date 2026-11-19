import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapRecoveryCycleCompletedData } from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

function isDustRecoveryCompletionRequired({ state, symbol, decision } = {}) {
  return decision.inventoryDisposition?.status === "EXCHANGE_CONSTRAINED_DUST" &&
    state.completedRecoverySellSymbols.has(symbol)
}

async function pauseForDustCompletionFailure({ pause, symbol, reason, error } = {}) {
  await pause({
    symbol,
    reason,
    error,
  })
}

function publishDustRecoveryCompleted({ eventPublisher, symbol, metadata, pairs, completion } = {}) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
    dataResult: mapRecoveryCycleCompletedData({
      symbol,
      marketId: metadata.market.id,
      freeQuantity: completion.data.freeQuantity,
      keepQuantity: String(pairs[symbol].keepQuantity),
      minProfit: String(pairs[symbol].minProfit),
      realizedNetProfit: completion.data.realizedNetProfit,
      dust: completion.data.dust,
    }),
  })
}

async function handleDustCompletionFailure({ pause, symbol, completion } = {}) {
  await pauseForDustCompletionFailure({
    pause,
    symbol,
    reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
    error: completion?.errors?.[0],
  })
  return toResult({ errors: completion?.errors ?? [new Error("Dust recovery completion failed")] })
}

async function handleIncompleteDustCompletion({ dependencies, context, completedSellOrder, completion } = {}) {
  const { pause, publishRecoveryCycleNotCompleted } = dependencies
  const { symbol } = context
  publishRecoveryCycleNotCompleted({
    order: completedSellOrder,
    completion,
  })
  if (completion.data?.pause === false) {
    return null
  }
  await pauseForDustCompletionFailure({
    pause,
    symbol,
    reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
  })
  return toResult({ error: new Error("Dust recovery cycle completion did not satisfy the Conservative contract") })
}

export async function completeDustRecoveryIfNeeded({ dependencies, context } = {}) {
  const {
    state,
    pause,
    completeRecoveryCycle,
    eventPublisher,
    evaluateLatestTransition,
    pairs,
  } = dependencies
  const { symbol, metadata, decision, effectiveActions } = context
  if (!isDustRecoveryCompletionRequired({
    state,
    symbol,
    decision,
  })) {
    return null
  }
  const completedSellOrder = state.completedRecoverySellOrdersBySymbol.get(symbol)
  if (!completedSellOrder) {
    await pauseForDustCompletionFailure({
      pause,
      symbol,
      reason: "RECOVERY_CYCLE_SELL_IDENTITY_MISSING",
    })
    return toResult({ error: new Error("Completed recovery SELL identity is unavailable for dust completion") })
  }
  const completion = await completeRecoveryCycle({
    marketId: metadata.market.id,
    keepQuantity: String(pairs[symbol].keepQuantity),
    minProfit: String(pairs[symbol].minProfit),
    inventoryDisposition: decision.inventoryDisposition,
    sellOrder: completedSellOrder,
  })
  if (!completion?.ok) {
    return handleDustCompletionFailure({
      pause,
      symbol,
      completion,
    })
  }
  if (!completion.data?.eligible) {
    return handleIncompleteDustCompletion({
      dependencies,
      context,
      completedSellOrder,
      completion,
    })
  }
  publishDustRecoveryCompleted({
    eventPublisher,
    symbol,
    metadata,
    pairs,
    completion,
  })
  state.completedRecoverySellSymbols.delete(symbol)
  state.completedRecoverySellOrdersBySymbol.delete(symbol)
  state.trailingBuy.set(symbol, true)
  return effectiveActions.length > 0 ? evaluateLatestTransition({ symbol }) : null
}

