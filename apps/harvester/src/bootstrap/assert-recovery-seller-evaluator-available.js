/**
 * Reject configured RS routes before startup unless the production evaluator is registered.
 *
 * @param {object} input Resolved RS execution routes and their production evaluator.
 * @returns {true} Confirmation that the RS runtime registration boundary is valid.
 */
export function assertRecoverySellerEvaluatorAvailable({
  recoverySellerPairs = {},
  evaluateRecoverySellerTransition,
} = {}) {
  if (recoverySellerPairs === null ||
      typeof recoverySellerPairs !== "object" ||
      Array.isArray(recoverySellerPairs)) {
    throw new TypeError("recoverySellerPairs must be an object")
  }
  if (Object.keys(recoverySellerPairs).length > 0 &&
      typeof evaluateRecoverySellerTransition !== "function") {
    throw new Error("Recovery Seller execution routes require a production transition evaluator")
  }
  return true
}
