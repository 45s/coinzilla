---
title: Startup open orders are external to the current process
status: accepted
type: architecture
owner: harvester
created: 2026-11-15
---

# ADR-0004: Startup open orders are external to the current process

## Status

**Accepted — implementation tracked by [#1157](https://github.com/45s/coinzilla/issues/1157).** This decision defines the ownership boundary for orders observed in the account-wide startup snapshot. The runtime implementation and regression coverage are pending.

**Related:** [ADR-0001](0001-application-owned-recovery-facts.md), [Journal Operations](../JOURNAL_OPERATIONS.md), [#654](https://github.com/45s/coinzilla/issues/654), [#1157](https://github.com/45s/coinzilla/issues/1157).

## Context

Harvester starts with a new process-local `OrderRegistry`. It already reads all exchange open orders and durably records the PREFLIGHT account snapshot and open-order observation before market subscriptions.

The account snapshot manager currently makes an extra distinction based on client-order-ID shape:

- Manual-looking unmatched orders are classified as external and passed through the configured per-pair `externalOrdersPolicy`.
- Unmatched orders with a Harvester-looking client ID are classified as unresolved prior-process Harvester orders.
- The Conservative engine blocks a market containing one of those unresolved orders regardless of the configured external-order policy.

An order's client-order-ID prefix is not proof that the current process owns it. A previous process may have created it, but that process no longer owns its lifecycle. Treating it as a special recovery case introduces a hidden blocker and makes restart behavior differ from the explicitly configured external-order policy.

## Decision

### 1. Startup snapshot is observation, not adoption

Every exchange order returned by the account-wide open-orders query at startup is external to the current process.

- Record the complete authoritative snapshot through the existing account-audit / Journal durability boundary.
- Do not restore a snapshot order into the current process's `OrderRegistry`.
- Do not adopt, cancel, replace, reprice, or otherwise manage a startup-snapshot order.
- Do not infer current-process ownership from a client-order-ID prefix, symbol, side, price, quantity, or any other shape.
- The current process owns only orders it submits and registers during its own lifetime.

### 2. Apply the configured external-order policy uniformly

Startup-snapshot orders use exactly the same per-pair `externalOrdersPolicy` as other external orders:

- `IGNORE`: the order does not block market-data subscriptions or strategy evaluation.
- `BLOCK`: preserve the existing same-market block behavior. Unrelated markets remain available.
- No separate unresolved-prior-process-Harvester policy or unconditional prefix-based blocker exists.

This ADR does not change the meaning or defaults of `EXTERNAL_ORDERS_POLICIES`.

### 3. Keep audit evidence separate from trading readiness

The open-order snapshot's audit classification (including the existing `readiness` / `blockReasons` fields) is evidence about the snapshot and ownership classification. It is not the user-data readiness flag and must not independently close the trading gate.

A failed, malformed, incomplete, or non-durable required account-wide snapshot remains a real startup failure. This decision removes only the order-ownership/recovery blocker; it does not weaken the requirement to obtain and durably record the snapshot.

### 4. Preserve current-process ownership and external execution safety

- Current-process orders continue through the existing OrderRegistry, lifecycle reconciliation, fill accounting, cancellation and shutdown behavior.
- An execution report for an order not owned by the current process must not be silently attributed to a current-process strategy order or fill.
- Preserve the existing external-execution/accounting-integrity safety behavior. This ADR does not authorize unsafe adoption or fabricated accounting.
- Use authoritative exchange free/locked balances as already provided by the broker snapshot. Never count assets locked in external orders as free inventory.

### 5. Keep Journal as operational evidence

Journal continues to record startup account and open-order snapshots and the existing required durability barriers. It is not made a source of restored order ownership by this decision.

This ADR does not wire historical Journal replay, the retained offline projection/restoration helpers, or historical trade scans into startup. It does not remove existing order-intent, cancellation-intent, snapshot, or shutdown durability requirements.

## Consequences

**Positive:**

- Restart behavior is predictable and follows explicit pair configuration.
- A prior-process `h-` order no longer creates an unconditional hidden market blocker.
- Startup remains simple: snapshot, persist, then run configured strategies.
- Orders already resting on the exchange remain untouched and may fill while Harvester is stopped.

**Trade-off:**

- Harvester deliberately does not manage or reconstruct an order that was open before the current process started. If `IGNORE` is configured, a strategy may submit another order on the same market when its own current-process state and available balances permit it. This is the explicit consequence of treating startup orders as external; the exchange remains authoritative for locked/free balances.
- Any broader decision about restoring historical Portfolio/Position/fill accounting is separate from this open-order ownership contract and must not be smuggled into this implementation.

## Implementation requirements

Tracked in [#1157](https://github.com/45s/coinzilla/issues/1157):

1. Remove the prefix-based unresolved-prior-process classification and unconditional engine gate.
2. Route all unmatched startup orders through the existing external-order classification and configured per-pair policy.
3. Remove obsolete state, callbacks and tests once all consumers are migrated.
4. Add deterministic tests for Harvester-prefixed startup orders under both `IGNORE` and `BLOCK`, including unrelated-market isolation.
5. Preserve durable snapshot ordering, fail-closed snapshot errors, current-run order ownership, and external execution safety.
6. Update the source, tests, this ADR, Journal operations and roadmaps together.

No TESTNET or LIVE exchange operation is required or authorized by this decision.
