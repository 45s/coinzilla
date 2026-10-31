/**
 * Decide whether an entire event fan-out fits within the pending-delivery cap.
 * Reject before scheduling any delivery when this returns false.
 *
 * @param {{ pendingCount: number, deliveryCount: number, maxPending: number }} counts
 * @returns {boolean}
 */
export function canAcceptDeliveries({ pendingCount, deliveryCount, maxPending }) {
  return pendingCount + deliveryCount <= maxPending
}
