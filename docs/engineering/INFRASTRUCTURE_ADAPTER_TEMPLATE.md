---
title: Infrastructure adapter template
status: active
type: engineering-guide
owner: repository engineering
created: 2026-11-21
---

# Infrastructure adapter template

Use this optional pattern when an external provider, SDK, protocol or storage engine must implement an application-owned port. The adapter translates between the external contract and the stable application contract.

## When to use it

Use an infrastructure adapter when the integration has provider-specific:

- transport, client/session or connection lifecycle;
- credentials, endpoint or runtime configuration;
- request/response or event-envelope mapping;
- provider-specific errors, retry semantics or capabilities; or
- resource cleanup and transaction behavior.

It is overkill for a pure mapper with no provider lifecycle or external dependency; keep a small DTO mapper as a focused pure module. Do not add an adapter layer just to rename a function or mirror a package tree.

## Ownership boundary

- **Application port:** defines the operations and data the application needs, without importing provider SDK types or protocol names.
- **Infrastructure adapter:** owns the concrete client, protocol calls, DTO translation, provider error classification, capability declaration and cleanup.
- **Domain:** owns business invariants and decisions. Do not move eligibility, pricing, accounting or workflow policy into an adapter.
- **Composition root:** constructs the adapter with validated configuration and injects it through the application port.

Preserve exact values and identifiers across the boundary. Do not silently coerce financial values, discard unknown outcomes, or replace a provider failure with a success-shaped fallback. When translating errors, retain the original cause and a stable operation classification.

## Starting shape

The following is a structural example. Replace the port methods, mapping functions and error type with the owning package's actual contracts.

```js
export function createExampleAdapter({
  client,
  mapProviderRecord,
  toProviderError,
} = {}) {
  if (typeof client?.read !== "function" ||
      typeof mapProviderRecord !== "function" ||
      typeof toProviderError !== "function") {
    throw new TypeError("Example adapter requires a client, mapper and error translator")
  }

  return Object.freeze({
    async read({ id } = {}) {
      try {
        const providerRecord = await client.read({ id })
        return mapProviderRecord({ providerRecord })
      } catch (error) {
        throw toProviderError({
          operation: "read",
          cause: error,
        })
      }
    },
  })
}
```

Keep mapping functions separate when they have their own validation/invariants and can be tested directly. Keep the adapter focused on implementing the port; do not turn it into a second application service.

## Adapter and contract-test shape

For every adapter, prove two things:

1. **Provider-neutral conformance:** the adapter satisfies the complete application port contract and every capability it declares.
2. **Provider-specific behavior:** protocol mapping, error translation, configuration, lifecycle, cleanup and unsupported capabilities behave as documented.

Prefer one reusable conformance suite per stable port and run it against each implementation. Use isolated temporary resources and deterministic fakes. Explicitly test cleanup in `finally`; a test must not leave files, sockets, timers or provider sessions behind.

The contract suite should cover all required operations, error/result semantics, lifecycle, concurrency and each declared capability. Provider-specific tests should cover edge cases that the shared contract cannot express. Do not claim support for a capability merely because the adapter has a method with the right name.

## Repository example

The Database package demonstrates the complete boundary:

- The [provider port and JSDoc contract](../../packages/db/src/application/ports/database-provider.js) define provider-neutral transactions, CRUD operations and declared capabilities.
- The [SQLite provider](../../packages/db/src/infrastructure/sqlite/provider.js) owns SQLite statements, connection handling, exact record serialization and translation into stable database errors.
- The [SQLite conformance suite](../../packages/db/src/infrastructure/sqlite/provider-conformance.test.js) runs the reusable [provider contract tests](../../packages/db/test-support/provider-conformance.js) and verifies both declared storage modes plus isolated cleanup.
- The [provider-neutral use case](../../packages/db/src/application/use-cases/create-database.js) composes the provider without importing SQLite internals.

This is a working example of one adapter implementing one explicit port. A new provider should run the same conformance suite rather than invent a parallel test vocabulary.

## Before adding an adapter

- Identify the application-owned port and confirm it is stable enough to implement.
- Keep provider SDKs, DTOs, transport and credentials inside Infrastructure.
- Declare capabilities explicitly and validate them at composition.
- Preserve identifiers, exact values, error causes, unknown outcomes and lifecycle semantics.
- Run reusable contract tests plus provider-specific mapping/failure/cleanup tests.
- Verify unsupported capabilities fail explicitly; never silently fall back to another provider.
- Follow the [Modularity Standard](MODULARITY_STANDARD.md), [Engineering Standards](../../ENGINEERING_STANDARDS.md), and the owning package's instructions.
