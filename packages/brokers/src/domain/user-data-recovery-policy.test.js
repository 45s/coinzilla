import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canCompleteUserDataRecovery } from "./user-data-recovery-policy.js"

describe("user-data recovery domain policy", () => {
  it("does not complete when recovery is not required", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: false,
      hasActiveSubscription: true,
      subscriberAcknowledgements: [true],
    }), false, "Recovery cannot complete when no recovery is required.")
  })

  it("does not complete before a remote subscription is established", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: true,
      hasActiveSubscription: false,
      subscriberAcknowledgements: [true],
    }), false, "Recovery cannot complete before a remote subscription is active.")
  })

  it("does not complete without active subscribers", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: true,
      hasActiveSubscription: true,
      subscriberAcknowledgements: [],
    }), false, "Recovery cannot complete without active subscribers.")
  })

  it("waits until every active subscriber acknowledges reconciliation", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: true,
      hasActiveSubscription: true,
      subscriberAcknowledgements: [true, false],
    }), false, "Every active subscriber must acknowledge before recovery completes.")
  })

  it("completes only when every active subscriber explicitly acknowledges", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: true,
      hasActiveSubscription: true,
      subscriberAcknowledgements: [true, true],
    }), true, "Recovery completes only after every active subscriber acknowledges.")
  })

  it("does not treat truthy non-boolean values as acknowledgements", () => {
    assert.equal(canCompleteUserDataRecovery({
      recoveryRequired: true,
      hasActiveSubscription: true,
      subscriberAcknowledgements: [true, "yes"],
    }), false, "Truthy non-boolean values must not count as acknowledgements.")
  })
})
