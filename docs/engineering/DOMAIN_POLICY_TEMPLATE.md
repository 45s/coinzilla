---
title: Domain policy template
status: active
type: engineering-guide
owner: repository engineering
created: 2026-11-21
---

# Domain policy template

Use this optional pattern when a domain invariant or eligibility rule must be evaluated from an explicit snapshot. A policy decides what is allowed; it does not perform the action.

## When to use it

Use a domain policy when:

- the rule belongs to one domain and is independent of a concrete provider or transport;
- the decision can be made from explicit input values/snapshots;
- the same rule should be testable without opening connections or mutating state; and
- the caller needs a stable answer before choosing an application action.

Keep orchestration, retries, timers, persistence, broker calls and event publication in the Application or Infrastructure layer. Do not move domain-specific policy into shared utilities merely because it is pure.

## Starting shape

This example shows a boolean eligibility policy. Use a boolean only when the contract truly has two outcomes and the caller does not need a reason. If the caller needs to distinguish WAIT, BLOCK, RECONCILE or multiple failure reasons, return a structured decision with stable outcome/reason fields instead.

```js
/**
 * Decide whether a recovery operation is complete.
 *
 * @param {{ recoveryRequired: boolean, subscriptionActive: boolean, acknowledgements: boolean[] }} options
 * @returns {boolean}
 */
export function canCompleteRecovery({
  recoveryRequired,
  subscriptionActive,
  acknowledgements,
} = {}) {
  if (
    recoveryRequired !== true ||
    subscriptionActive !== true ||
    !Array.isArray(acknowledgements) ||
    acknowledgements.length === 0
  ) {
    return false
  }

  return acknowledgements.every((acknowledged) => acknowledged === true)
}
```

Keep the policy free of I/O and ambient state. Pass the facts it needs; do not let it fetch them. Validate or normalize untrusted boundary data before it reaches the policy, while preserving explicit checks for domain invariants and boolean semantics.

## Decision-matrix test shape

Write tests for each meaningful prerequisite, the positive case, and values that must not be accepted by coercion. Keep the expected business result in the test itself.

```js
import assert from "node:assert/strict"
import test from "node:test"

import { canCompleteRecovery } from "./can-complete-recovery.js"

test("does not complete when recovery is not required", () => {
  assert.equal(
    canCompleteRecovery({
      recoveryRequired: false,
      subscriptionActive: true,
      acknowledgements: [true],
    }),
    false,
    "A recovery cycle that was not required must not be marked complete.",
  )
})

test("waits until every subscriber acknowledges", () => {
  assert.equal(
    canCompleteRecovery({
      recoveryRequired: true,
      subscriptionActive: true,
      acknowledgements: [true, false],
    }),
    false,
    "One missing acknowledgement must keep recovery incomplete.",
  )
})

test("completes only when every prerequisite is satisfied", () => {
  assert.equal(
    canCompleteRecovery({
      recoveryRequired: true,
      subscriptionActive: true,
      acknowledgements: [true, true],
    }),
    true,
    "Recovery completes only after the active subscription and every acknowledgement are confirmed.",
  )
})
```

Extend the matrix for each independent prerequisite, empty collections, invalid values and relevant combinations. Avoid a Cartesian-product test explosion when individual cases already prove independent rules.

## Repository example

The Brokers package's [`canCompleteUserDataRecovery`](../../packages/brokers/src/domain/user-data-recovery-policy.js) is a source-backed example. Its [direct tests](../../packages/brokers/src/domain/user-data-recovery-policy.test.js) cover recovery not required, inactive remote subscription, no active subscribers, incomplete acknowledgements, all acknowledgements complete, and truthy non-boolean values. The Application [`UserDataSession`](../../packages/brokers/src/application/user-data-session.js) consumes this policy; subscription lifecycle and external effects remain outside the pure decision.

This is a Brokers domain policy example, not a mandate to create a policy module for every boolean condition. A one-off condition may remain private in its cohesive owning module.

## Before adding a policy

- Identify the domain owner and the invariant the policy protects.
- Search for existing decisions before creating a differently named duplicate.
- Keep the policy's input facts explicit and its result stable.
- Add direct tests for positive, negative, boundary and non-coercive behavior.
- Keep external effects and action execution in the caller.
- Follow the [Modularity Standard](MODULARITY_STANDARD.md), [Engineering Standards](../../ENGINEERING_STANDARDS.md), and the owning domain's instructions.
