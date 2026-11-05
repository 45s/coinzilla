import { addDecimal, assertDecimalString, compareDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"

function assertNonNegativeDecimal({ value, field } = {}) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(field + " must be non-negative")
  }
}

/**
 * Allocate a strategy decision against the remaining account and pair budgets.
 * Existing active orders are supplied as commitments; each accepted action
 * immediately consumes the remaining budget before the next action is checked.
 * SELL overcommitment rejects the whole decision before any broker submission.
 */
export function allocateOrderCommitments({
  actions,
  quoteFreeBalance,
  baseFreeBalance,
  quoteCashFlow,
  activeBaseQuantity,
  activeBaseBalance,
  outstandingRecoveryAmount,
  committedQuote,
  committedQuoteBalance,
  committedBase,
  committedBaseBalance,
  investmentLimit,
} = {}) {
  try {
    if (!Array.isArray(actions)) throw new TypeError("actions must be an array")
    const accountActiveBaseQuantity = activeBaseBalance ?? activeBaseQuantity
    const accountCommittedQuote = committedQuoteBalance ?? committedQuote
    const accountCommittedBase = committedBaseBalance ?? committedBase
    for (const [field, value] of Object.entries({
      quoteFreeBalance,
      baseFreeBalance,
      activeBaseQuantity,
      activeBaseBalance: accountActiveBaseQuantity,
      outstandingRecoveryAmount,
      committedQuote,
      committedQuoteBalance: accountCommittedQuote,
      committedBase,
      committedBaseBalance: accountCommittedBase,
      investmentLimit,
    })) {
      assertNonNegativeDecimal({ value, field })
    }
    assertDecimalString({ value: quoteCashFlow, field: "quoteCashFlow" })

    let remainingQuoteBalance = subtractDecimal({
      left: addDecimal({ left: quoteFreeBalance, right: quoteCashFlow }),
      right: accountCommittedQuote,
    })
    let remainingBaseBalance = subtractDecimal({
      left: addDecimal({ left: baseFreeBalance, right: accountActiveBaseQuantity }),
      right: accountCommittedBase,
    })
    let remainingActiveBase = subtractDecimal({
      left: activeBaseQuantity,
      right: committedBase,
    })
    let remainingInvestment = subtractDecimal({
      left: investmentLimit,
      right: addDecimal({ left: outstandingRecoveryAmount, right: committedQuote }),
    })
    const executableActions = []
    const deferredActions = []

    for (const action of actions) {
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
        const requiredQuote = multiplyDecimal({ left: action.price, right: action.quantity })
        if (compareDecimal({ left: requiredQuote, right: remainingQuoteBalance }) > 0) {
          deferredActions.push(Object.freeze({ action, reason: "INSUFFICIENT_QUOTE_BALANCE" }))
          continue
        }
        if (compareDecimal({ left: requiredQuote, right: remainingInvestment }) > 0) {
          deferredActions.push(Object.freeze({ action, reason: "PAIR_INVESTMENT_LIMIT" }))
          continue
        }
        remainingQuoteBalance = subtractDecimal({ left: remainingQuoteBalance, right: requiredQuote })
        remainingInvestment = subtractDecimal({ left: remainingInvestment, right: requiredQuote })
        executableActions.push(action)
        continue
      }

      if (action.side !== "SELL") throw new TypeError("Strategy action side must be BUY or SELL")
      if (compareDecimal({ left: action.quantity, right: remainingBaseBalance }) > 0) {
        throw new RangeError("Strategy SELL quantity exceeds available free base balance after commitments")
      }
      if (compareDecimal({ left: action.quantity, right: remainingActiveBase }) > 0) {
        throw new RangeError("Strategy SELL quantity exceeds Harvester-owned active inventory after commitments")
      }
      remainingBaseBalance = subtractDecimal({ left: remainingBaseBalance, right: action.quantity })
      remainingActiveBase = subtractDecimal({ left: remainingActiveBase, right: action.quantity })
      executableActions.push(action)
    }

    return toResult({
      data: Object.freeze({
        executableActions: Object.freeze(executableActions),
        deferredActions: Object.freeze(deferredActions),
        remainingQuoteBalance,
        remainingBaseBalance,
        remainingActiveBase,
        remainingInvestment,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
