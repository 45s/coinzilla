---
title: Application handler template
status: active
type: engineering-guide
owner: repository engineering
created: 2026-11-21
---

# Application handler template

Use this optional pattern when one application operation must coordinate domain decisions and one or more external ports. The handler owns the order of work; it does not own domain policy or infrastructure protocol details.

## When to use it

Use an application handler/use case when a request or event requires a meaningful sequence, such as:

- loading the current domain facts;
- evaluating a domain policy or state transition;
- coordinating one or more repository/provider ports;
- handling the result, failure or compensation boundary; or
- publishing an application event after the required work succeeds.

It is overkill for a one-line pass-through or a function that only transforms input. Keep simple orchestration inside its cohesive owner instead of creating a handler folder for every function.

## Starting shape

Inject the dependencies through one named options object. Keep the returned operation's input explicit. The handler coordinates the workflow; policy and infrastructure behavior remain behind their own contracts.

```js
/**
 * @param {{ repository: { load: (input: object) => Promise<object>, save: (input: object) => Promise<void> }, decide: (input: object) => { allowed: boolean, reason?: string } }} dependencies
 * @returns {(input: { id: string }) => Promise<object>}
 */
export function createExampleHandler({ repository, decide } = {}) {
  if (typeof repository?.load !== "function" ||
      typeof repository?.save !== "function" ||
      typeof decide !== "function") {
    throw new TypeError("Example handler requires repository and decision dependencies")
  }

  return async function execute({ id } = {}) {
    const record = await repository.load({ id })
    const decision = decide({ record })

    if (decision.allowed !== true) {
      return {
        outcome: "rejected",
        reason: decision.reason ?? "policy-rejected",
      }
    }

    await repository.save({ record })
    return {
      outcome: "completed",
    }
  }
}
```

Adapt the result envelope and error contract to the owning application. Do not catch an error just to turn it into a success-shaped fallback. Translate an error only when the application boundary owns a stable result/error contract and preserves the original cause.

## Interaction-test shape

Use fakes at the handler's ports. Assert the observable result, exact arguments, ordering and that later effects do not happen after an earlier rejection/failure.

```js
import assert from "node:assert/strict"
import test from "node:test"

import { createExampleHandler } from "./create-example-handler.js"

test("loads, decides and saves in order when the policy allows the operation", async () => {
  const calls = []
  const handler = createExampleHandler({
    repository: {
      async load(input) {
        calls.push(["load", input])
        return { id: input.id }
      },
      async save(input) {
        calls.push(["save", input])
      },
    },
    decide: ({ record }) => ({
      allowed: record.id === "record-1",
    }),
  })

  assert.deepEqual(
    await handler({ id: "record-1" }),
    { outcome: "completed" },
    "An allowed operation must return its documented completion result.",
  )
  assert.deepEqual(
    calls,
    [
      ["load", { id: "record-1" }],
      ["save", { record: { id: "record-1" } }],
    ],
    "The handler must load facts, evaluate the policy, and save only after approval.",
  )
})
```

Add separate tests proving that a rejected policy prevents writes, port failures propagate with their cause/contract, and compensation or idempotency behavior is correct where the use case requires it. Avoid testing private helper calls or mocking the policy's internal implementation.

## Repository example

The Database package's [`createDatabase` use case](../../packages/db/src/application/use-cases/create-database.js) is a source-backed composition/orchestration example. It validates the injected provider contract, creates the domain lifecycle entity, snapshots provider capabilities, and exposes a provider-neutral facade. Its direct tests are split by concern:

- [Lifecycle and provider interaction](../../packages/db/src/application/use-cases/create-database.test.js)
- [Capability validation and snapshot behavior](../../packages/db/src/application/use-cases/create-database-capabilities.test.js)
- [CRUD behavior through the facade](../../packages/db/src/application/use-cases/create-database-crud.test.js)
- [Transaction contract](../../packages/db/src/application/use-cases/create-database-transaction.test.js)

The concrete SQLite provider is not constructed inside the use case; composition supplies it through the provider contract. This keeps orchestration provider-neutral.

## Before adding a handler

- Confirm there is a multi-step application workflow to own.
- Identify the owning application, domain policies/entities, and narrow external ports.
- Define input, result, error, ordering, idempotency and compensation contracts.
- Test interactions at the port boundary with deterministic fakes.
- Keep provider protocol, SQL, transport and serialization in Infrastructure.
- Follow the [Modularity Standard](MODULARITY_STANDARD.md), [Engineering Standards](../../ENGINEERING_STANDARDS.md), and the owning domain's instructions.
