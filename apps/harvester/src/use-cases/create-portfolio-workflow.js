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
export const createPortfolioWorkflow = ({ evaluateStrategy, logger, initialPortfolio, initialRecoveryLedgers, onCommissionAsset, onOperationalStateExecutionFill, onOperationalStateRecoveryCycleCompleted, onOperationalStateRecoveryCycleNotCompleted } = {}) => {
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
  let portfolio = initialPortfolio ?? new Portfolio()
  let recoveryLedgers = new Map(initialRecoveryLedgers ?? [])
  let updateQueue = Promise.resolve()
  const enqueueAccountingTransition = (transition) => {
    const task = updateQueue.then(transition)
    updateQueue = task.then(() => undefined, () => undefined)
    return task
  }

  const tracedEvaluateStrategy = (input = {}) => {
    const marketId = input.marketMetadata?.market?.id
    const recoveryLedger = marketId ? recoveryLedgers.get(marketId) : undefined
    logger.debug?.({
      message: "Strategy evaluation input",
      symbol: input.marketPrice?.symbol,
      marketPrice: input.marketPrice,
      lastBuyPrice: input.lastBuyPrice,
      activeOrders: input.activeOrders,
      pairConfig: input.pairConfig,
      settings: input.settings,
      portfolio: createPortfolioLogSummary({ portfolio, marketId, strategyId: StrategyId.COIN_GRABBER }),
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
  const processMarketPrice = makeProcessMarketPrice({ evaluateStrategy: tracedEvaluateStrategy })

  const updateTradingAccounting = ({ fill } = {}) => enqueueAccountingTransition(async () => {
    if (!(fill instanceof Fill)) {
      logger.error?.({
        message: "accounting rejected non-canonical fill",
        fillType: fill?.constructor?.name ?? typeof fill,
      })
      return toResult({ error: new TypeError("updateTradingAccounting requires a canonical Fill") })
    }

    const thirdAssetCommissions = new Map()
    for (const commission of fill.commissions ?? []) {
      const amount = commission.amount
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
    const previousPortfolio = portfolio
    const currentLedger = recoveryLedgers.get(fill.market.id) ??
      RecoveryLedger.empty({ market: fill.market })
    const previousPosition = previousPortfolio.getPosition({ marketId: fill.market.id, strategyId: StrategyId.COIN_GRABBER })
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

    const result = applyTradingAccounting({
      portfolio,
      recoveryLedger: currentLedger,
      fill,
    })
    // A targeted fee-asset baseline must precede EXECUTION_FILL_APPLIED in the
    // durable sequence. Its failure remains non-blocking here; account audit fails closed.
    if (result.ok && result.data.applied === true && thirdAssetCommissions.size > 0) {
      try {
        if (typeof onCommissionAsset !== "function") {
          throw new Error("Third-asset commission baseline capture is unavailable")
        }
        for (const [assetId, assetCode] of thirdAssetCommissions) {
          const baselineResult = await onCommissionAsset({ assetId, assetCode })
          if (baselineResult?.ok !== true) {
            throw baselineResult?.errors?.[0] ?? new Error("Unable to persist the third-asset commission baseline for " + assetCode)
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
    if (result.ok && result.data.applied === true && onOperationalStateExecutionFill) {
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
    }
    if (result.ok) {
      portfolio = result.data.portfolio
      recoveryLedgers.set(fill.market.id, result.data.recoveryLedger)
      const nextPosition = portfolio.getPosition({ marketId: fill.market.id, strategyId: StrategyId.COIN_GRABBER })
      const nextLedger = result.data.recoveryLedger
      const portfolioStatsChanged = [
        [previousPosition?.baseQuantity.amount, nextPosition?.baseQuantity.amount],
        [previousPosition?.freeBaseQuantity.amount, nextPosition?.freeBaseQuantity.amount],
        [previousPosition?.totalBaseQuantity.amount, nextPosition?.totalBaseQuantity.amount],
        [previousPosition?.spent.amount, nextPosition?.spent.amount],
        [previousPosition?.quoteNetCashFlow.amount, nextPosition?.quoteNetCashFlow.amount],
      ].some(([previous, next]) => compareDecimal({
        left: previous ?? "0",
        right: next ?? "0",
      }) !== 0)
      if (result.data.applied === true && portfolioStatsChanged) {
        const portfolioStats = createPortfolioStatsLogSummary({ position: nextPosition })
        if (portfolioStats) { logger.info?.(portfolioStats) }
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
        accountingDelta: {
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
        },
      })
    } else {
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
        unchangedPortfolio: createPortfolioLogSummary({ portfolio: previousPortfolio, marketId: fill.market.id }),
        unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: currentLedger }),
      })
    }
    return result
  })

  return {
    updatePortfolio: updateTradingAccounting,
    updateTradingAccounting,
    processMarketPrice: (input = {}) => processMarketPrice({ ...input, portfolio }),
    getPortfolio: () => portfolio,
    getRecoveryLedger: ({ marketId } = {}) => recoveryLedgers.get(marketId),
    completeRecoveryCycle: ({ marketId, keepQuantity, minProfit, inventoryDisposition, sellOrder } = {}) =>
      enqueueAccountingTransition(async () => {
        const recoveryLedger = recoveryLedgers.get(marketId)
        const position = portfolio.getPosition({ marketId, strategyId: StrategyId.COIN_GRABBER })
        if (!recoveryLedger || !position) {
          return toResult({ error: new Error("Cannot complete a recovery cycle without an active Position and RecoveryLedger") })
        }
        try {
          assertTerminalRecoverySellOrder({ sellOrder, marketId })
          const completionInput = {
            sellOrderFullyFilled: true,
            spent: position.spent.amount,
            netSellProceeds: recoveryLedger.netSellProceeds,
            activeQuantity: position.baseQuantity.amount,
            keepQuantity,
            minProfit,
            ...(inventoryDisposition === undefined ? {} : { inventoryDisposition }),
          }
          logger.debug?.({
            message: "recovery completion evaluation input",
            marketId,
            symbol: recoveryLedger.market.symbol,
            completionInput,
            position: createPositionLogSummary({ position }),
            recoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
          })
          const evaluatedCompletion = evaluateRecoveryCompletion(completionInput)
          const completion = Object.freeze({
            ...evaluatedCompletion,
            activeQuantity: completionInput.activeQuantity,
            keepQuantity: completionInput.keepQuantity,
            minProfit: completionInput.minProfit,
          })
          if (completion.eligible) {
            const previousPortfolio = portfolio
            const previousLedger = recoveryLedger

            // Stage both immutable accounting projections before committing either reference.
            let nextPortfolio = previousPortfolio
            if (compareDecimal({ left: completion.freeQuantity, right: "0" }) > 0) {
              nextPortfolio = nextPortfolio.allocateFreeQuantity({ marketId, strategyId: StrategyId.COIN_GRABBER, quantity: completion.freeQuantity })
            }
            nextPortfolio = nextPortfolio.resetRecoveryBasis({ marketId, strategyId: StrategyId.COIN_GRABBER })
            const resetLedger = previousLedger.resetCycle({ minProfit, spent: position.spent })
            const nextRecoveryLedgers = new Map(recoveryLedgers)
            nextRecoveryLedgers.set(marketId, resetLedger)
            const nextPosition = nextPortfolio.getPosition({ marketId, strategyId: StrategyId.COIN_GRABBER })

            if (onOperationalStateRecoveryCycleCompleted) {
              const durableResult = await onOperationalStateRecoveryCycleCompleted({
                marketId,
                recoveryLedger: previousLedger,
                position,
                sellOrder,
                completion,
                minProfit,
                inventoryDisposition: completion.dust ?? null,
              })
              if (durableResult?.ok !== true || durableResult.data?.durable !== true) {
                return toResult({
                  errors: durableResult?.errors?.length
                    ? durableResult.errors
                    : [new Error("Recovery-cycle completion fact did not confirm durable commitment")],
                })
              }
            }

            logger.debug?.({
              message: "Recovery cycle completed",
              marketId,
              symbol: recoveryLedger.market.symbol,
              completion,
              previousPosition: createPositionLogSummary({ position: previousPortfolio.getPosition({ marketId, strategyId: StrategyId.COIN_GRABBER }) }),
              nextPosition: createPositionLogSummary({ position: nextPosition }),
              previousRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: previousLedger }),
              nextRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger: resetLedger }),
            })

            portfolio = nextPortfolio
            recoveryLedgers = nextRecoveryLedgers

            const portfolioStatsChanged = [
              [position.baseQuantity.amount, nextPosition.baseQuantity.amount],
              [position.freeBaseQuantity.amount, nextPosition.freeBaseQuantity.amount],
              [position.totalBaseQuantity.amount, nextPosition.totalBaseQuantity.amount],
              [position.spent.amount, nextPosition.spent.amount],
              [position.quoteNetCashFlow.amount, nextPosition.quoteNetCashFlow.amount],
            ].some(([previous, next]) => compareDecimal({ left: previous, right: next }) !== 0)
            if (portfolioStatsChanged) {
              const portfolioStats = createPortfolioStatsLogSummary({ position: nextPosition })
              if (portfolioStats) { logger.info?.(portfolioStats) }
            }
          } else {
            if (onOperationalStateRecoveryCycleNotCompleted) {
              const durableResult = await onOperationalStateRecoveryCycleNotCompleted({
                marketId,
                recoveryLedger,
                position,
                sellOrder,
                completion,
                minProfit,
              })
              if (durableResult?.ok !== true || durableResult.data?.durable !== true) {
                return toResult({
                  errors: durableResult?.errors?.length
                    ? durableResult.errors
                    : [new Error("Recovery-cycle non-completion fact did not confirm durable commitment")],
                })
              }
            }
            logger.debug?.({
              message: "recovery cycle not completed",
              marketId,
              symbol: recoveryLedger.market.symbol,
              completion,
              unchangedPosition: createPositionLogSummary({ position }),
              unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
            })
          }
          return toResult({ data: completion })
        } catch (error) {
          logger.error?.({
            message: "recovery completion evaluation failed",
            marketId,
            errorName: error?.name,
            errorMessage: error?.message ?? String(error),
            errorStack: error?.stack,
            unchangedPortfolio: createPortfolioLogSummary({ portfolio, marketId }),
            unchangedRecoveryLedger: createRecoveryLedgerLogSummary({ recoveryLedger }),
          })
          return toResult({ error })
        }
      }),
  }
}
