---
title: Pure module template
status: active
type: engineering-guide
owner: repository engineering
created: 2026-11-21
---

# Pure module template

Use this optional starting point for a deterministic calculation, mapper, normalizer, or validation function. It is not a required file layout or a generator. Follow the owning package's existing structure and public API.

## When to use it

Use a standalone pure module when the operation:

- has a clear input/output contract;
- does not need filesystem, network, database, broker, event-bus, process, clock, or mutable runtime state;
- can be tested directly without infrastructure mocks; and
- is cohesive enough to deserve a named module rather than another private function in an unrelated file.

Keep a short calculation inside its owning domain module when extraction would only add indirection. Keep domain-specific rules in their owning domain; do not move them into `@coinzilla/utils` merely because they are pure.

## Starting shape

The following example shows a decimal calculation inside the Utilities package. Replace the operation and validation with the owning domain's actual contract. A consumer package must import shared behavior through the supported public package API, never another package's private `src/` path.

```js
import { assertDecimalString, multiplyDecimal } from "./decimal.js"

/**
 * Calculate an amount using an exact decimal rate.
 *
 * @param {{ value: string, rate: string }} options
 * @returns {string}
 */
export function calculateAmount({ value, rate } = {}) {
  assertDecimalString({
    value,
    field: "value",
  })
  assertDecimalString({
    value: rate,
    field: "rate",
  })

  return multiplyDecimal({
    left: value,
    right: rate,
  })
}
```

Keep the function's input as one named options object. Make time, randomness, environment, and external state explicit inputs when a decision genuinely depends on them; otherwise keep them out of the module. Do not catch an error merely to return a plausible fallback.

## Direct test shape

Place the test beside the module using the package's established `.test.js` or `.spec.js` convention. The repository currently uses native Node.js `node:test`.

```js
import assert from "node:assert/strict"
import test from "node:test"

import { calculateAmount } from "./calculate-amount.js"

test("calculates the expected exact amount", () => {
  assert.equal(
    calculateAmount({
      value: "12",
      rate: "0.1",
    }),
    "1.2",
    "The calculation must preserve the exact decimal result.",
  )
})

test("rejects malformed decimal input", () => {
  assert.throws(
    () => calculateAmount({
      value: "not-a-number",
      rate: "0.1",
    }),
    /decimal string/,
    "Malformed decimal input must fail at the module boundary.",
  )
})
```

Adapt the cases to the actual contract. Cover meaningful normal, boundary, invalid-input, and failure behavior; assert observable results rather than implementation calls. Include detailed assertion messages. Do not add boilerplate cases that prove no distinct contract.

## Repository example

The Utilities package's [`percentage.js`](../../packages/utils/src/percentage.js) and its [colocated test](../../packages/utils/src/percentage.test.js) are a real example:

- Each exported operation accepts one named input object.
- Decimal strings are validated before arithmetic.
- Arithmetic is delegated to the package's exact decimal operations.
- The tests cover exact values, tiny/high-precision values, increases and decreases, zero-start division, invalid rounding, and scale boundaries.

This example is a reference, not a mandate to put every pure calculation in Utilities. The [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md) defines when functionality is genuinely domain-neutral.

## Before adding a module

- Search the owning package and shared utilities for existing behavior before creating a duplicate.
- Check the package's `AGENTS.md`, `ROADMAP.md`, public exports, consumers, and nearby tests.
- Keep the module responsibility and filename self-descriptive; follow the [Modularity Standard](MODULARITY_STANDARD.md).
- Follow [JavaScript and JSDoc](JAVASCRIPT_JSDOC_STANDARD.md) and the effective root ESLint configuration.
- Follow strict RED → GREEN → REFACTOR for behavior changes.
- Update the owning package documentation and roadmap when the public contract or domain guidance changes.

This template complements, and does not replace, [Engineering Standards](../../ENGINEERING_STANDARDS.md), [Task Workflows](TASK_WORKFLOWS.md), and the owning domain's instructions.
