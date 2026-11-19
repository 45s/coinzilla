import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapStrategyDecisionData } from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

/**
 * Publish one strategy decision using the balances and allocation used by the
 * current serialized evaluation.
 *
 * @param {object} input Evaluation dependencies, context, balances and allocation.
 */
export function publishStrategyDecision({ dependencies, context, balances, allocation } = {}) {
  const { eventPublisher, pairs } = dependencies
  const { decision, symbol, marketPrice, activeOrdersBefore } = context
  const { position, portfolioBaseBalance, quoteBalance, baseBalance, quoteCashFlow, committedQuote, committedQuoteBalance, committedBase, committedBaseBalance } = balances
  const { executableActions } = allocation
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STRATEGY_DECISION,
    dataResult: mapStrategyDecisionData({
      strategy: decision.strategy,
      symbol,
      referencePrice: marketPrice.price,
      reason: decision.reason ?? executableActions[0]?.reason,
      inputs: {
        lastBuyPrice: context.lastBuyPrice ?? null,
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
        outstandingRecoveryAmount: context.recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
        investmentLimit: String(pairs[symbol].investment),
        orderQuantity: String(pairs[symbol].orderQuantity),
        keepQuantity: String(pairs[symbol].keepQuantity),
        priceStepPercent: String(pairs[symbol].priceStepPercent),
        makerPercent: String(pairs[symbol].makerPercent),
        takerPercent: String(pairs[symbol].takerPercent),
        minProfit: String(pairs[symbol].minProfit),
      },
      actions: executableActions,
    }),
  })
}

