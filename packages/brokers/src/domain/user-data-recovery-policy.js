/**
 * Decide whether a user-data recovery cycle may be marked complete.
 *
 * Recovery is complete only after a remote subscription is active and every
 * current subscriber has explicitly acknowledged reconciliation.
 *
 * @param {object} input
 * @param {boolean} input.recoveryRequired
 * @param {boolean} input.hasActiveSubscription
 * @param {boolean[]} input.subscriberAcknowledgements
 * @returns {boolean}
 */
export function canCompleteUserDataRecovery({
  recoveryRequired,
  hasActiveSubscription,
  subscriberAcknowledgements,
}) {
  if (
    recoveryRequired !== true ||
    hasActiveSubscription !== true ||
    !Array.isArray(subscriberAcknowledgements) ||
    subscriberAcknowledgements.length === 0
  ) {
    return false
  }

  return subscriberAcknowledgements.every((acknowledged) => acknowledged === true)
}
