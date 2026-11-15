import { addDecimal, assertDecimalString, compareDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"

function assertNonNegativeDecimal({ value, field } = {}) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(field + " must be non-negative")
  }
}

/**
 * Allocate a strategy decision against the remaining account and pair budgets.
 * Exchange free balances are point-in-time values, so only current-minus-snapshot
 * deltas for Portfolio inventory and active-order commitments adjust them. This
 * prevents pre-snapshot locks from being subtracted twice while reserving orders
 * created after the snapshot. `portfolioBaseBalance` is total tracked base (active
 * plus retained free); `additionalTrackedBaseBalance` is separately verified
 * Harvester-owned Spot inventory outside Portfolio. Both balances and their
 * snapshot baselines contribute to account-wide free-base reconciliation;
 * `activeBaseQuantity` is the pair-level combined SELLable amount.
 * Each accepted action consumes the remaining budget.
 * SELL overcommitment rejects the whole decision before any broker submission.
 */
function createAllocationContext({
  actions,
  quoteFreeBalance,
  baseFreeBalance,
  quoteCashFlow,
  activeBaseQuantity,
  portfolioBaseBalance,
  portfolioBaseBalanceBaseline = "0",
  additionalTrackedBaseBalance = "0",
  additionalTrackedBaseBalanceBaseline = "0",
  outstandingRecoveryAmount,
  committedQuote,
  committedQuoteBalance,
  committedQuoteBalanceBaseline = "0",
  committedBase,
  committedBaseBalance,
  committedBaseBalanceBaseline = "0",
  investmentLimit,
} = {}) {
  if (!Array.isArray(actions)) {
    throw new TypeError("actions must be an array")
  }
  const accountCommittedQuote = committedQuoteBalance ?? committedQuote
  const accountCommittedBase = committedBaseBalance ?? committedBase
  const values = {
    quoteFreeBalance,
    baseFreeBalance,
    activeBaseQuantity,
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    outstandingRecoveryAmount,
    committedQuote,
    committedQuoteBalance: accountCommittedQuote,
    committedQuoteBalanceBaseline,
    committedBase,
    committedBaseBalance: accountCommittedBase,
    committedBaseBalanceBaseline,
    investmentLimit,
  }
  for (const [field, value] of Object.entries(values)) {
    assertNonNegativeDecimal({ value, field })
  }
  assertDecimalString({ value: quoteCashFlow, field: "quoteCashFlow" })

  const accountTrackedBaseBalance = addDecimal({
    left: portfolioBaseBalance,
    right: additionalTrackedBaseBalance,
  })
  if (compareDecimal({ left: activeBaseQuantity, right: accountTrackedBaseBalance }) > 0) {
    throw new RangeError("activeBaseQuantity cannot exceed total tracked base balance")
  }
  if (compareDecimal({ left: accountCommittedBase, right: accountTrackedBaseBalance }) > 0) {
    throw new RangeError("committedBaseBalance cannot exceed total tracked base balance")
  }
  if (compareDecimal({ left: committedBase, right: activeBaseQuantity }) > 0) {
    throw new RangeError("committedBase cannot exceed activeBaseQuantity")
  }
  if (compareDecimal({ left: committedQuote, right: accountCommittedQuote }) > 0) {
    throw new RangeError("committedQuote cannot exceed committedQuoteBalance")
  }
  if (compareDecimal({ left: committedBase, right: accountCommittedBase }) > 0) {
    throw new RangeError("committedBase cannot exceed committedBaseBalance")
  }

  return {
    actions,
    quoteFreeBalance,
    baseFreeBalance,
    quoteCashFlow,
    activeBaseQuantity,
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    outstandingRecoveryAmount,
    committedQuote,
    accountCommittedQuote,
    committedQuoteBalanceBaseline,
    committedBase,
    accountCommittedBase,
    committedBaseBalanceBaseline,
    investmentLimit,
  }
}

function createInitialAllocationState(context) {
  return {
    remainingQuoteBalance: subtractDecimal({
      left: addDecimal({
        left: context.quoteFreeBalance,
        right: context.quoteCashFlow,
      }),
      right: subtractDecimal({
        left: context.accountCommittedQuote,
        right: context.committedQuoteBalanceBaseline,
      }),
    }),
    remainingBaseBalance: subtractDecimal({
      left: addDecimal({
        left: context.baseFreeBalance,
        right: addDecimal({
          left: subtractDecimal({
            left: context.portfolioBaseBalance,
            right: context.portfolioBaseBalanceBaseline,
          }),
          right: subtractDecimal({
            left: context.additionalTrackedBaseBalance,
            right: context.additionalTrackedBaseBalanceBaseline,
          }),
        }),
      }),
      right: subtractDecimal({
        left: context.accountCommittedBase,
        right: context.committedBaseBalanceBaseline,
      }),
    }),
    remainingActiveBase: subtractDecimal({
      left: context.activeBaseQuantity,
      right: context.committedBase,
    }),
    remainingInvestment: subtractDecimal({
      left: context.investmentLimit,
      right: addDecimal({
        left: context.outstandingRecoveryAmount,
        right: context.committedQuote,
      }),
    }),
  }
}

function applyAllocationAction({ action, state } = {}) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new TypeError("Each strategy action must be an object")
  }
  assertDecimalString({ value: action.quantity, field: "action.quantity" })
  if (compareDecimal({ left: action.quantity, right: "0" }) <= 0) {
    throw new RangeError("Strategy action quantity must be positive")
  }

  if (action.side === "BUY") {
    assertDecimalString({ value: action.price, field: "action.price" })
    if (compareDecimal({ left: action.price, right: "0" }) <= 0) {
      throw new RangeError("Strategy BUY price must be positive")
    }
    const requiredQuote = multiplyDecimal({
      left: action.price,
      right: action.quantity,
    })
    if (compareDecimal({ left: requiredQuote, right: state.remainingQuoteBalance }) > 0) {
      return "INSUFFICIENT_QUOTE_BALANCE"
    }
    if (compareDecimal({ left: requiredQuote, right: state.remainingInvestment }) > 0) {
      return "PAIR_INVESTMENT_LIMIT"
    }
    state.remainingQuoteBalance = subtractDecimal({
      left: state.remainingQuoteBalance,
      right: requiredQuote,
    })
    state.remainingInvestment = subtractDecimal({
      left: state.remainingInvestment,
      right: requiredQuote,
    })
    return undefined
  }

  if (action.side !== "SELL") {
    throw new TypeError("Strategy action side must be BUY or SELL")
  }
  if (compareDecimal({ left: action.quantity, right: state.remainingBaseBalance }) > 0) {
    throw new RangeError("Strategy SELL quantity exceeds available free base balance after commitments")
  }
  if (compareDecimal({ left: action.quantity, right: state.remainingActiveBase }) > 0) {
    throw new RangeError("Strategy SELL quantity exceeds Harvester-owned active inventory after commitments")
  }
  state.remainingBaseBalance = subtractDecimal({
    left: state.remainingBaseBalance,
    right: action.quantity,
  })
  state.remainingActiveBase = subtractDecimal({
    left: state.remainingActiveBase,
    right: action.quantity,
  })
  return undefined
}

function allocateActions({ actions, state } = {}) {
  const executableActions = []
  const deferredActions = []
  for (const action of actions) {
    const deferredReason = applyAllocationAction({ action, state })
    if (deferredReason) {
      deferredActions.push(Object.freeze({ action, reason: deferredReason }))
    } else {
      executableActions.push(action)
    }
  }
  return { executableActions, deferredActions }
}

/**
 * Allocate a strategy decision against the remaining account and pair budgets.
 * Exchange free balances are point-in-time values, so only current-minus-snapshot
 * deltas for Portfolio inventory, separately tracked Spot inventory, and active
 * order commitments adjust them. This prevents pre-snapshot locks from being
 * subtracted twice while reserving orders created after the snapshot.
 *
 * @param {object} options Account, Portfolio, additional Spot allocation and reservation inputs.
 * @returns {object} Executable/deferred actions and remaining account/pair budgets.
 */
export function allocateOrderCommitments(options = {}) {
  try {
    const context = createAllocationContext(options)
    const state = createInitialAllocationState(context)
    const { executableActions, deferredActions } = allocateActions({
      actions: context.actions,
      state,
    })
    return toResult({
      data: Object.freeze({
        executableActions: Object.freeze(executableActions),
        deferredActions: Object.freeze(deferredActions),
        remainingQuoteBalance: state.remainingQuoteBalance,
        remainingBaseBalance: state.remainingBaseBalance,
        remainingActiveBase: state.remainingActiveBase,
        remainingInvestment: state.remainingInvestment,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
