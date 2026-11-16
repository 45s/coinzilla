import { Fill } from "@coinzilla/entities"
import { compareDecimal, maxDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { assertTerminalRecoverySellOrder } from "../domain/orders/assert-terminal-recovery-sell-order.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { makeProcessMarketPrice } from "./process-market-price.js"
import { updateTradingAccounting as applyTradingAccounting } from "./update-trading-accounting.js"
import {
  createPortfolioLogSummary,
  createPortfolioStatsLogSummary,
  createPositionLogSummary,
  createRecoveryLedgerLogSummary,
} from "../application/logging/trading-state-log-summary.js"

function enqueueAccountingTransition({ state, transition }) {
  const task = state.updateQueue.then(transition)
  state.updateQueue = task.then(() => undefined, () => undefined)
  return task
}

function evaluateStrategyWithPortfolioState({ state, evaluateStrategy, logger, input = {} }) {
  const marketId = input.marketMetadata?.market?.id
  const recoveryLedger = marketId ? state.recoveryLedgers.get(marketId) : undefined
  logger.debug?.({
    message: "Strategy evaluation input",
    symbol: input.marketPrice?.symbol,
    marketPrice: input.marketPrice,
    lastBuyPrice: input.lastBuyPrice,
    activeOrders: input.activeOrders,
    pairConfig: input.pairConfig,
    settings: input.settings,
    portfolio: createPortfolioLogSummary({
      portfolio: state.portfolio,
      marketId,
      strategyId: StrategyId.COIN_GRABBER,
    }),
    recoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
  })
  const decision = evaluateStrategy(input)
  logger.debug?.({
    message: "Strategy evaluation result",
    symbol: input.marketPrice?.symbol,
    action: decision?.action,
    reason: decision?.reason,
    actions: decision?.actions,
    position: decision?.position,
    recoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
  })
  return decision
}

function collectThirdAssetCommissions({ fill }) {
  const thirdAssetCommissions = new Map()
  for (const commission of fill.commissions ?? []) {
    const { amount } = commission
    if (amount.asset.id === fill.market.baseAsset.id ||
        amount.asset.id === fill.market.quoteAsset.id ||
        compareDecimal({ left: amount.amount, right: "0" }) <= 0) {
      continue
    }
    const existingCode = thirdAssetCommissions.get(amount.asset.id)
    if (existingCode !== undefined && existingCode !== amount.asset.code) {
      return toResult({ error: new Error("Third-asset commission ID maps to contradictory asset codes") })
    }
    thirdAssetCommissions.set(amount.asset.id, amount.asset.code)
  }
  return thirdAssetCommissions
}

function logExecutionReceived({ logger, fill, previousPosition, currentLedger }) {
  const commissionFacts = (fill.commissions ?? []).map(({ amount } = {}) => ({
    amount: amount?.amount,
    asset: amount?.asset?.code,
    assetId: amount?.asset?.id,
  }))
  logger.debug?.({
    message: "Execution received",
    executionId: fill.id,
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId,
    marketId: fill.market.id,
    symbol: fill.market.symbol,
    side: fill.side,
    liquidityRole: fill.liquidityRole,
    executedAt: fill.executedAt,
    price: fill.price?.amount,
    quantity: fill.quantity?.amount,
    quoteQuantity: fill.quoteQuantity?.amount,
    commissionStatus: fill.commissionStatus,
    commissions: commissionFacts,
    thirdAssetCommissionQuoteValues: (fill.commissions ?? [])
      .filter(({ amount } = {}) => amount?.asset?.id !== fill.market.baseAsset.id &&
        amount?.asset?.id !== fill.market.quoteAsset.id)
      .map(({ quoteValue } = {}) => quoteValue?.amount ?? null),
    previousPosition: createPositionLogSummary({ position: previousPosition }),
    previousRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: currentLedger }),
  })
}

async function captureThirdAssetCommissionBaselines({ onCommissionAsset, logger, fill, commissions }) {
  if (commissions.size === 0) {
    return
  }
  try {
    if (typeof onCommissionAsset !== "function") {
      throw new Error("Third-asset commission baseline capture is unavailable")
    }
    for (const [assetId, assetCode] of commissions) {
      const baselineResult = await onCommissionAsset({ assetId, assetCode })
      if (baselineResult?.ok !== true) {
        throw baselineResult?.errors?.[0] ?? new Error(`Unable to persist the third-asset commission baseline for ${assetCode}`)
      }
    }
  } catch (error) {
    logger.warning?.({
      message: "third-asset commission baseline was not persisted; account reconciliation will fail closed",
      executionId: fill.id,
      tradeId: fill.tradeId,
      symbol: fill.market.symbol,
      errors: [{ name: error?.name, message: error?.message ?? String(error) }],
    })
  }
}

async function persistExecutionFill({ onOperationalStateExecutionFill, fill }) {
  if (!onOperationalStateExecutionFill) {
    return undefined
  }
  let durableResult
  try {
    durableResult = await onOperationalStateExecutionFill({ fill })
  } catch (error) {
    return toResult({ error })
  }
  if (durableResult?.ok !== true || durableResult.data?.durable !== true) {
    return toResult({
      errors: durableResult?.errors?.length
        ? durableResult.errors
        : [new Error("Execution-fill fact append did not confirm durable commitment")],
    })
  }
  return undefined
}

function hasPortfolioStatsChanged({ previousPosition, nextPosition }) {
  return [
    [previousPosition?.baseQuantity.amount, nextPosition?.baseQuantity.amount],
    [previousPosition?.freeBaseQuantity.amount, nextPosition?.freeBaseQuantity.amount],
    [previousPosition?.totalBaseQuantity.amount, nextPosition?.totalBaseQuantity.amount],
    [previousPosition?.spent.amount, nextPosition?.spent.amount],
    [previousPosition?.quoteNetCashFlow.amount, nextPosition?.quoteNetCashFlow.amount],
  ].some(([previous, next]) => compareDecimal({
    left: previous ?? "0",
    right: next ?? "0",
  }) !== 0)
}

function createExecutionAccountingDelta({ nextPosition, previousPosition, nextLedger, currentLedger }) {
  return {
    portfolioActiveBase: subtractDecimal({
      left: nextPosition?.baseQuantity.amount ?? "0",
      right: previousPosition?.baseQuantity.amount ?? "0",
    }),
    portfolioFreeBase: subtractDecimal({
      left: nextPosition?.freeBaseQuantity.amount ?? "0",
      right: previousPosition?.freeBaseQuantity.amount ?? "0",
    }),
    portfolioQuoteCashFlow: subtractDecimal({
      left: nextPosition?.quoteNetCashFlow.amount ?? "0",
      right: previousPosition?.quoteNetCashFlow.amount ?? "0",
    }),
    positionSpent: subtractDecimal({
      left: nextPosition?.spent.amount ?? "0",
      right: previousPosition?.spent.amount ?? "0",
    }),
    netSellProceeds: subtractDecimal({
      left: nextLedger.netSellProceeds,
      right: currentLedger.netSellProceeds,
    }),
    outstandingRecoveryAmount: subtractDecimal({
      left: maxDecimal({
        left: "0",
        right: subtractDecimal({
          left: nextPosition?.spent.amount ?? "0",
          right: nextLedger.netSellProceeds,
        }),
      }),
      right: maxDecimal({
        left: "0",
        right: subtractDecimal({
          left: previousPosition?.spent.amount ?? "0",
          right: currentLedger.netSellProceeds,
        }),
      }),
    }),
    realizedNetProfit: subtractDecimal({
      left: subtractDecimal({
        left: nextLedger.netSellProceeds,
        right: nextPosition?.spent.amount ?? "0",
      }),
      right: subtractDecimal({
        left: currentLedger.netSellProceeds,
        right: previousPosition?.spent.amount ?? "0",
      }),
    }),
  }
}

function logExecutionAccounted({ logger, fill, result, previousPosition, currentLedger, nextPosition, nextLedger }) {
  if (result.data.applied === true && hasPortfolioStatsChanged({ previousPosition, nextPosition })) {
    const portfolioStats = createPortfolioStatsLogSummary({ position: nextPosition })
    if (portfolioStats) {
      logger.info?.(portfolioStats)
    }
  }
  logger.debug?.({
    message: "Execution accounted",
    executionId: fill.id,
    tradeId: fill.tradeId,
    symbol: fill.market.symbol,
    applied: result.data.applied,
    duplicate: result.data.duplicate,
    nextPosition: createPositionLogSummary({ position: nextPosition }),
    nextRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: nextLedger }),
    accountingDelta: createExecutionAccountingDelta({
      nextPosition,
      previousPosition,
      nextLedger,
      currentLedger,
    }),
  })
}

function logExecutionRejected({ logger, fill, result, previousPortfolio, previousPosition, currentLedger }) {
  logger.error?.({
    message: "accounting execution rejected",
    executionId: fill.id,
    tradeId: fill.tradeId,
    symbol: fill.market.symbol,
    errors: (result.errors ?? []).map((error) => ({
      name: error?.name,
      message: error?.message ?? String(error),
      stack: error?.stack,
    })),
    unchangedPortfolio: createPortfolioLogSummary({
      portfolio: previousPortfolio,
      marketId: fill.market.id,
    }),
    unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: currentLedger }),
  })
}

async function runUpdateTradingAccounting({
  state,
  fill,
  logger,
  onCommissionAsset,
  onOperationalStateExecutionFill,
}) {
  return enqueueAccountingTransition({
    state,
    transition: async () => {
      if (!(fill instanceof Fill)) {
        logger.error?.({
          message: "accounting rejected non-canonical fill",
          fillType: fill?.constructor?.name ?? typeof fill,
        })
        return toResult({ error: new TypeError("updateTradingAccounting requires a canonical Fill") })
      }

      const thirdAssetCommissions = collectThirdAssetCommissions({ fill })
      if (thirdAssetCommissions?.ok === false) {
        return thirdAssetCommissions
      }
      const previousPortfolio = state.portfolio
      const currentLedger = state.recoveryLedgers.get(fill.market.id) ??
        RecoveryLedger.empty({ market: fill.market })
      const previousPosition = previousPortfolio.getPosition({
        marketId: fill.market.id,
        strategyId: StrategyId.COIN_GRABBER,
      })
      logExecutionReceived({ logger, fill, previousPosition, currentLedger })

      const result = applyTradingAccounting({
        portfolio: state.portfolio,
        recoveryLedger: currentLedger,
        fill,
      })
      if (result.ok && result.data.applied === true && thirdAssetCommissions.size > 0) {
        await captureThirdAssetCommissionBaselines({
          onCommissionAsset,
          logger,
          fill,
          commissions: thirdAssetCommissions,
        })
      }
      if (result.ok && result.data.applied === true && onOperationalStateExecutionFill) {
        const durableFailure = await persistExecutionFill({ onOperationalStateExecutionFill, fill })
        if (durableFailure) {
          return durableFailure
        }
      }
      if (result.ok) {
        state.portfolio = result.data.portfolio
        state.recoveryLedgers.set(fill.market.id, result.data.recoveryLedger)
        const nextPosition = state.portfolio.getPosition({
          marketId: fill.market.id,
          strategyId: StrategyId.COIN_GRABBER,
        })
        logExecutionAccounted({
          logger,
          fill,
          result,
          previousPosition,
          currentLedger,
          nextPosition,
          nextLedger: result.data.recoveryLedger,
        })
      } else {
        logExecutionRejected({
          logger,
          fill,
          result,
          previousPortfolio,
          previousPosition,
          currentLedger,
        })
      }
      return result
    },
  })
}

function createRecoveryCompletionInput({ position, recoveryLedger, keepQuantity, minProfit, inventoryDisposition }) {
  return {
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity,
    minProfit,
    ...(inventoryDisposition === undefined ? {} : { inventoryDisposition }),
  }
}

function stageRecoveryCycleState({ state, marketId, position, recoveryLedger, completion, minProfit }) {
  let nextPortfolio = state.portfolio
  if (compareDecimal({ left: completion.freeQuantity, right: "0" }) > 0) {
    nextPortfolio = nextPortfolio.allocateFreeQuantity({
      marketId,
      strategyId: StrategyId.COIN_GRABBER,
      quantity: completion.freeQuantity,
    })
  }
  nextPortfolio = nextPortfolio.resetRecoveryBasis({ marketId, strategyId: StrategyId.COIN_GRABBER })
  const resetLedger = recoveryLedger.resetCycle({ minProfit, spent: position.spent })
  const nextRecoveryLedgers = new Map(state.recoveryLedgers)
  nextRecoveryLedgers.set(marketId, resetLedger)
  const nextPosition = nextPortfolio.getPosition({
    marketId,
    strategyId: StrategyId.COIN_GRABBER,
  })
  return {
    previousPortfolio: state.portfolio,
    previousLedger: recoveryLedger,
    nextPortfolio,
    nextRecoveryLedgers,
    nextPosition,
  }
}

async function persistRecoveryCycleOutcome({
  callback,
  marketId,
  recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit,
}) {
  if (!callback) {
    return undefined
  }
  const durableResult = await callback({
    marketId,
    recoveryLedger,
    position,
    sellOrder,
    completion,
    minProfit,
    ...(completion.eligible ? { inventoryDisposition: completion.dust ?? null } : {}),
  })
  if (durableResult?.ok !== true || durableResult.data?.durable !== true) {
    return toResult({
      errors: durableResult?.errors?.length
        ? durableResult.errors
        : [new Error(completion.eligible
          ? "Recovery-cycle completion fact did not confirm durable commitment"
          : "Recovery-cycle non-completion fact did not confirm durable commitment")],
    })
  }
  return undefined
}

function logRecoveryCycleCompleted({ logger, marketId, recoveryLedger, completion, staged }) {
  logger.debug?.({
    message: "Recovery cycle completed",
    marketId,
    symbol: recoveryLedger.market.symbol,
    completion,
    previousPosition: createPositionLogSummary({
      position: staged.previousPortfolio.getPosition({
        marketId,
        strategyId: StrategyId.COIN_GRABBER,
      }),
    }),
    nextPosition: createPositionLogSummary({ position: staged.nextPosition }),
    previousRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: staged.previousLedger }),
    nextRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: staged.nextRecoveryLedgers.get(marketId) }),
  })

}

function logRecoveryCycleStats({ logger, position, nextPosition }) {
  const portfolioStatsChanged = [
    [position.baseQuantity.amount, nextPosition.baseQuantity.amount],
    [position.freeBaseQuantity.amount, nextPosition.freeBaseQuantity.amount],
    [position.totalBaseQuantity.amount, nextPosition.totalBaseQuantity.amount],
    [position.spent.amount, nextPosition.spent.amount],
    [position.quoteNetCashFlow.amount, nextPosition.quoteNetCashFlow.amount],
  ].some(([previous, next]) => compareDecimal({ left: previous, right: next }) !== 0)
  if (portfolioStatsChanged) {
    const portfolioStats = createPortfolioStatsLogSummary({ position: nextPosition })
    if (portfolioStats) {
      logger.info?.(portfolioStats)
    }
  }
}

function logRecoveryCycleNotCompleted({ logger, marketId, recoveryLedger, position, completion }) {
  logger.debug?.({
    message: "recovery cycle not completed",
    marketId,
    symbol: recoveryLedger.market.symbol,
    completion,
    unchangedPosition: createPositionLogSummary({ position }),
    unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
  })
}

function logRecoveryCompletionFailure({ logger, state, marketId, error, recoveryLedger }) {
  logger.error?.({
    message: "recovery completion evaluation failed",
    marketId,
    errorName: error?.name,
    errorMessage: error?.message ?? String(error),
    errorStack: error?.stack,
    unchangedPortfolio: createPortfolioLogSummary({ portfolio: state.portfolio, marketId }),
    unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
  })
}

function evaluatePortfolioRecoveryCompletion({
  logger,
  marketId,
  position,
  recoveryLedger,
  keepQuantity,
  minProfit,
  inventoryDisposition,
}) {
  const completionInput = createRecoveryCompletionInput({
    position,
    recoveryLedger,
    keepQuantity,
    minProfit,
    inventoryDisposition,
  })
  logger.debug?.({
    message: "recovery completion evaluation input",
    marketId,
    symbol: recoveryLedger.market.symbol,
    completionInput,
    position: createPositionLogSummary({ position }),
    recoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
  })
  const evaluatedCompletion = evaluateRecoveryCompletion(completionInput)
  return Object.freeze({
    ...evaluatedCompletion,
    activeQuantity: completionInput.activeQuantity,
    keepQuantity: completionInput.keepQuantity,
    minProfit: completionInput.minProfit,
  })
}

async function completeEligibleRecoveryCycle({
  state,
  marketId,
  position,
  recoveryLedger,
  sellOrder,
  completion,
  minProfit,
  logger,
  onOperationalStateRecoveryCycleCompleted,
}) {
  const staged = stageRecoveryCycleState({
    state,
    marketId,
    position,
    recoveryLedger,
    completion,
    minProfit,
  })
  const durableFailure = await persistRecoveryCycleOutcome({
    callback: onOperationalStateRecoveryCycleCompleted,
    marketId,
    recoveryLedger,
    position,
    sellOrder,
    completion,
    minProfit,
  })
  if (durableFailure) {
    return durableFailure
  }
  logRecoveryCycleCompleted({ logger, marketId, recoveryLedger, completion, staged })
  state.portfolio = staged.nextPortfolio
  state.recoveryLedgers = staged.nextRecoveryLedgers
  logRecoveryCycleStats({ logger, position, nextPosition: staged.nextPosition })
  return undefined
}

async function recordIneligibleRecoveryCycle({
  marketId,
  position,
  recoveryLedger,
  sellOrder,
  completion,
  minProfit,
  logger,
  onOperationalStateRecoveryCycleNotCompleted,
}) {
  const durableFailure = await persistRecoveryCycleOutcome({
    callback: onOperationalStateRecoveryCycleNotCompleted,
    marketId,
    recoveryLedger,
    position,
    sellOrder,
    completion,
    minProfit,
  })
  if (durableFailure) {
    return durableFailure
  }
  logRecoveryCycleNotCompleted({ logger, marketId, recoveryLedger, position, completion })
  return undefined
}

async function runCompleteRecoveryCycle({
  state,
  marketId,
  keepQuantity,
  minProfit,
  inventoryDisposition,
  sellOrder,
  logger,
  onOperationalStateRecoveryCycleCompleted,
  onOperationalStateRecoveryCycleNotCompleted,
}) {
  const recoveryLedger = state.recoveryLedgers.get(marketId)
  const position = state.portfolio.getPosition({
    marketId,
    strategyId: StrategyId.COIN_GRABBER,
  })
  if (!recoveryLedger || !position) {
    return toResult({ error: new Error("Cannot complete a recovery cycle without an active Position and RecoveryLedger") })
  }
  try {
    assertTerminalRecoverySellOrder({ sellOrder, marketId })
    const completion = evaluatePortfolioRecoveryCompletion({
      logger,
      marketId,
      position,
      recoveryLedger,
      keepQuantity,
      minProfit,
      inventoryDisposition,
    })
    let failure
    if (completion.eligible) {
      failure = await completeEligibleRecoveryCycle({
        state,
        marketId,
        position,
        recoveryLedger,
        sellOrder,
        completion,
        minProfit,
        logger,
        onOperationalStateRecoveryCycleCompleted,
      })
    } else {
      failure = await recordIneligibleRecoveryCycle({
        marketId,
        position,
        recoveryLedger,
        sellOrder,
        completion,
        minProfit,
        logger,
        onOperationalStateRecoveryCycleNotCompleted,
      })
    }
    if (failure) {
      return failure
    }
    return toResult({ data: completion })
  } catch (error) {
    logRecoveryCompletionFailure({ logger, state, marketId, error, recoveryLedger })
    return toResult({ error })
  }
}

/**
 * Create the in-memory Portfolio and RecoveryLedger workflow used by Harvester.
 *
 * Owns serialized canonical-fill accounting and atomic recovery-cycle completion.
 * Bootstrap composes this stateful workflow with broker and process lifecycle
 * resources; the domain transitions remain in Portfolio and RecoveryLedger.
 *
 * @param {object} options
 * @param {Function} options.evaluateStrategy Strategy evaluator used by market-price processing.
 * @param {object} options.logger Structured logger used for workflow diagnostics.
 * @param {Portfolio} [options.initialPortfolio] Initial immutable portfolio.
 * @param {Map<string, RecoveryLedger>} [options.initialRecoveryLedgers] Initial market recovery ledgers.
 * @returns {object} Portfolio, accounting, recovery completion, and market-price workflow operations.
 */
export const createPortfolioWorkflow = ({
  evaluateStrategy,
  logger,
  initialPortfolio,
  initialRecoveryLedgers,
  onCommissionAsset,
  onOperationalStateExecutionFill,
  onOperationalStateRecoveryCycleCompleted,
  onOperationalStateRecoveryCycleNotCompleted,
} = {}) => {
  if (initialPortfolio !== undefined && !(initialPortfolio instanceof Portfolio)) {
    throw new TypeError("initialPortfolio must be a Portfolio")
  }
  if (initialRecoveryLedgers !== undefined && !(initialRecoveryLedgers instanceof Map)) {
    throw new TypeError("initialRecoveryLedgers must be a Map")
  }
  if (onOperationalStateExecutionFill !== undefined && typeof onOperationalStateExecutionFill !== "function") {
    throw new TypeError("onOperationalStateExecutionFill must be a function")
  }
  if (onOperationalStateRecoveryCycleCompleted !== undefined && typeof onOperationalStateRecoveryCycleCompleted !== "function") {
    throw new TypeError("onOperationalStateRecoveryCycleCompleted must be a function")
  }

  const state = {
    portfolio: initialPortfolio ?? new Portfolio(),
    recoveryLedgers: new Map(initialRecoveryLedgers ?? []),
    updateQueue: Promise.resolve(),
  }
  const tracedEvaluateStrategy = (input = {}) => evaluateStrategyWithPortfolioState({
    state,
    evaluateStrategy,
    logger,
    input,
  })
  const processMarketPrice = makeProcessMarketPrice({ evaluateStrategy: tracedEvaluateStrategy })
  const updateTradingAccounting = ({ fill } = {}) => runUpdateTradingAccounting({
    state,
    fill,
    logger,
    onCommissionAsset,
    onOperationalStateExecutionFill,
  })
  const completeRecoveryCycle = ({
    marketId,
    keepQuantity,
    minProfit,
    inventoryDisposition,
    sellOrder,
  } = {}) => enqueueAccountingTransition({
    state,
    transition: () => runCompleteRecoveryCycle({
      state,
      marketId,
      keepQuantity,
      minProfit,
      inventoryDisposition,
      sellOrder,
      logger,
      onOperationalStateRecoveryCycleCompleted,
      onOperationalStateRecoveryCycleNotCompleted,
    }),
  })

  return {
    updatePortfolio: updateTradingAccounting,
    updateTradingAccounting,
    processMarketPrice: (input = {}) => processMarketPrice({ ...input, portfolio: state.portfolio }),
    getPortfolio: () => state.portfolio,
    getRecoveryLedger: ({ marketId } = {}) => state.recoveryLedgers.get(marketId),
    completeRecoveryCycle,
  }
}
