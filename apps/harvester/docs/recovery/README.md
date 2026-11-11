# One-market recovery reconciliation (ADR-0001 Step 7)

## Purpose

This workflow verifies one previously active market against canonical exchange evidence before an operator confirms its historical fill-coverage baseline. It is a prerequisite for later startup restoration, not a runtime startup path.

The implementation is split into two application use cases:

- `reconcileRecoveredMarketState()` composes owned-order reconciliation, a fresh account snapshot, account-wide open orders, target-market trade-history exhaustion and `auditRecoveredAccountState()`.
- `confirmMarketHistoryCoverage()` verifies the existing ADR-0001 fact ledger, invokes the reconciliation workflow, appends the per-market coverage fact only after a READY result, then reads the committed fact back.

See [ADR-0001](../architecture/decisions/0001-application-owned-recovery-facts.md), [Journal operations](../JOURNAL_OPERATIONS.md) and [the recovery roadmap](../../ROADMAP.md#process-restart-recovery--small-step-delivery-plan-654).

## Required sequence

1. Discover and validate the complete Journal session history; project and restore only a candidate state.
2. Reconcile every Harvester-owned order through the engine's serialized canonical order reconciliation boundary. This must use canonical client/broker identity and exchange status; shape matching is not ownership.
3. Obtain a fresh canonical account snapshot and the account-wide open-order set.
4. Exhaust target-market trade history from the operator-reviewed `coveredFromTime`.
5. Run the account audit with `tradeHistoryScope: "MARKET"`, `requireCompleteTradeHistory: true`, the exact target Market and the candidate retention evidence.
6. Require a non-skipped audit, no target-market blocker, complete history and matching baseline fact identity.
7. Append `MARKET_HISTORY_COVERAGE_CONFIRMED` through the ADR-0001 durable-facts port and verify the readback.

## Fail-closed behavior

- A failed/ambiguous owned-order reconciliation stops before account/history evidence is trusted.
- A target-market unowned order blocks that market's confirmation. It is never adopted, canceled or modified.
- An unowned order in another market remains a symbol-scoped blocker; it does not automatically invalidate the selected market.
- Missing assets/market metadata, incomplete history pagination, an account-balance mismatch, mismatched retention evidence, a skipped audit or an unreadable durable-fact ledger cannot create a coverage fact.
- The baseline fact identity is deterministic per symbol. An identical retry is idempotent; a conflicting baseline is rejected rather than silently replacing or narrowing existing coverage.
- The Journal remains an operational evidence observer. The coverage fact is written only to the ADR-0001 durable-facts stream.

## Current implementation status

**Status: IN PROGRESS — implementation in [PR #1047](https://github.com/45s/coinzilla/pull/1047).**

The orchestration and confirmation use cases and their deterministic tests are implemented in [PR #1047](https://github.com/45s/coinzilla/pull/1047). The PR does not connect the workflow to runtime startup, start Telegram polling, or expose a command.

A concrete offline CLI/context adapter and the complete end-to-end evidence matrix remain pending. The injected dependencies must be backed only by read-only exchange queries and the existing local recovery/Journaling boundaries. No exchange write is part of this workflow, and no exchange call was performed during implementation.

Steps 8 and 9 remain separate gates: candidate-state restoration behind closed readiness, then crash/restart and restart-twice verification. Unattended restart readiness remains disabled.
