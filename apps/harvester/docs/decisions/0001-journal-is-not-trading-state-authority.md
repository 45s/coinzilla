---
title: "ADR-0001: Journal is evidence, not trading-state authority"
status: accepted
type: architecture-decision
owner: harvester
date: 2026-11-09
---

# ADR-0001: Journal is evidence, not trading-state authority

## Context

Harvester's Journal records operational lifecycle events, order/fill evidence and account-level PREFLIGHT/CLOSING snapshots. That does not make it a crash-consistent trading ledger or a proven Portfolio restoration source:

- Applied-fill events are published asynchronously and are not synchronously flushed/fsynced for every fill.
- The startup composition does not replay prior Journal sessions into Portfolio, RecoveryLedger or OrderRegistry.
- PREFLIGHT/CLOSING account snapshots describe exchange-account balances; they do not establish strategy-owned inventory or order ownership.
- Existing exchange orders are recorded as unowned. Harvester does not adopt them automatically.
- Complete restart recovery requires proven event-history completeness, idempotent replay, durable order ownership, accounting invariants and broker reconciliation. Those guarantees are not currently implemented as one verified recovery workflow.

The current restart-reconciliation investigation is tracked by [#654](https://github.com/45s/coinzilla/issues/654).

## Decision

Treat the Journal as operational evidence and audit history, **not** as authority for restoring trading state.

Until a separately verified recovery design is implemented:

1. Startup begins with fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state; it does not replay a previous process session.
2. Broker-connected startup requires an enabled, ready Journal and a durable PREFLIGHT account audit before market subscriptions or trading-engine activation.
3. Account snapshots do not seed strategy-owned Portfolio inventory.
4. Existing external/unowned orders are not adopted or canceled automatically.
5. A restart after trading must not be treated as reconciled or safe based on Journal presence or PREFLIGHT success alone.
6. Any future replay/adoption/reconciliation behavior requires a new ADR and source-backed tests before it can be considered an accepted recovery contract.

## Alternatives considered

### Replay the existing Journal into trading state immediately

Rejected. The current event stream's durability, completeness, ordering and replay semantics are not sufficient to prove crash-consistent restoration of all trading aggregates and order ownership.

### Adopt current exchange balances and open orders on startup

Rejected. Account-wide balances and exchange open orders can include activity not owned by this Harvester process or strategy. Blind adoption could attribute external inventory or orders to the wrong strategy.

### Treat PREFLIGHT snapshots as a Portfolio seed

Rejected. PREFLIGHT is an account-level observation for audit and comparison, not a strategy inventory ledger.

### Disable Journal requirements for broker-connected startup

Rejected. The mandatory PREFLIGHT account audit is a safety/evidence requirement for every broker-connected startup.

## Consequences

- A Journal file is evidence, not proof that a previous trading session can be restored.
- Process restart after trading remains a known recovery boundary tracked by #654.
- Operators and agents must not infer ownership or safe restart from balances, open orders or Journal presence alone.
- Future recovery work must define and test replay, idempotency, ownership, retention/completeness and exchange reconciliation before changing this decision.

## Verification and references

- [Journal Operations](../JOURNAL_OPERATIONS.md)
- [Journal evidence contract](../JOURNAL_EVIDENCE_CONTRACT.md)
- [Harvester audit index](../audits/README.md)
- [Current Harvester roadmap](../../ROADMAP.md)
- Source: `apps/harvester/src/index.js` and `apps/harvester/src/bootstrap/start-harvester.js`
- Tracking: [#654](https://github.com/45s/coinzilla/issues/654)
