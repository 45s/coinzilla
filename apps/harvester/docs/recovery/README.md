# One-market recovery reconciliation (ADR-0001 Step 7)

## Purpose

This workflow verifies one previously active market against canonical exchange evidence before an operator confirms its historical fill-coverage baseline. It is a prerequisite for later startup restoration, not a runtime startup path.

The implementation is split into three application boundaries:

- `reconcileRecoveredMarketState()` composes canonical owned-order reconciliation, a fresh account snapshot, account-wide open orders, target-market trade-history exhaustion and the production `auditRecoveredAccountState()`.
- `confirmMarketHistoryCoverage()` verifies the existing ADR-0001 fact ledger, invokes reconciliation, appends the per-market coverage fact only after a READY result, then reads the committed fact back.
- `runOfflineMarketRecovery()` adapts a supplied evidence bundle into canonical entities and the production use cases. The CLI never creates a broker, reads a live exchange, starts Harvester, or invokes an order-placement/cancellation port.

See [ADR-0001](../architecture/decisions/0001-application-owned-recovery-facts.md), [Journal operations](../JOURNAL_OPERATIONS.md) and [the recovery roadmap](../../ROADMAP.md#process-restart-recovery--small-step-delivery-plan-654).

## Offline CLI

The command accepts an operator-prepared JSON evidence bundle. It does not discover or read Journal files itself; the bundle must contain the validated Journal projection input and the independently collected exchange evidence. It is deterministic for a fixed bundle and has no network dependency.

From `apps/harvester`:

```sh
pnpm run recovery:market -- --context ./recovery-evidence/linkusdt.json
```

The default mode is audit-only and never writes the durable-fact ledger. It reports `READY`, `BLOCKED` or `SKIPPED`; exit code `0` means READY, `2` means the audit did not establish readiness, and `1` means invalid input or an execution/evidence failure.

Only an explicit confirmation flag can append a coverage fact:

```sh
DURABLE_FACTS_DIRECTORY=/absolute/path/to/existing/durable-facts \
  pnpm run recovery:market -- --context ./recovery-evidence/linkusdt.json --confirm
```

On Windows PowerShell:

```powershell
$env:DURABLE_FACTS_DIRECTORY = "C:\coinzilla-data\durable-facts"
pnpm run recovery:market -- --context .\recovery-evidence\linkusdt.json --confirm
```

Confirmation requires an already initialized and verifiable ADR-0001 ledger. The CLI never initializes, repairs or replaces a missing ledger. Do not initialize a production ledger for this Step 7 command; the ADR reserves production genesis for the later runtime-integration gate. The context's `runtimeSessionId` identifies the explicit offline confirmation process.

### Evidence bundle contract

The JSON root has these fields:

- `symbol`: the one uppercase target market.
- `runtimeSessionId`: required for `--confirm`; a non-empty identifier for this offline confirmation process.
- `journalRecords`: normalized records accepted by `projectHarvesterJournalRecovery()`; each record has `position.fileName` and `payload.source/name/data`.
- `assets`: optional additional canonical asset identities, required for third-asset commissions not already described by a market.
- `markets`: canonical market metadata for the target and every market referenced by Journal orders/fills, owned-order evidence or account-wide open orders. Each market has `venue`, `symbol`, `baseAsset` and `quoteAsset`; each asset has `id` and `code`.
- `coverage`: `coveredFromTime`, `verifiedAt`, 64-character lowercase SHA-256 `evidenceDigest`, and canonical non-empty `verifiedBy`.
- `exchange.currentAccountSnapshot`: `sourceTime` and all relevant balances as `{ assetId, asset, free, locked }`; amounts are exact non-negative decimal strings.
- `exchange.ownedOrderHistory`: one canonical exchange status record for every recovered Harvester-owned order, keyed by its exact `clientOrderId`. Each record contains `brokerOrderId`, `symbol`, `side`, `type`, `status`, `price` for limit orders, `originalQuantity` and `executedQuantity`. Missing, duplicate or extra records fail closed.
- `exchange.openOrders`: the complete account-wide open-order snapshot in the normalized order shape consumed by the production audit. Unowned orders remain unowned and are never adopted or mutated.
- `exchange.tradeHistory`: target-market fills plus `historyPagesComplete`, `marketHistoryPagesComplete`, `historyScope: "MARKET"`, `marketsQueried: [symbol]` and `historyStartTime`. The start time must equal `coverage.coveredFromTime`; a later start cannot certify the omitted interval.

Each trade-history fill contains `tradeId`, `brokerOrderId`, optional `clientOrderId`, `symbol`, `side`, `price`, `quantity`, `quoteQuantity`, `liquidityRole`, optional `executedAt`, `commissionStatus` and a `commissions` array. Commission records contain `assetId`, `asset`, `amount`, and optional historical `quoteValue: { assetId, asset, amount }`. Every amount is an exact decimal string.

The adapter verifies that the history is scoped to exactly the target market and begins exactly at the reviewed coverage boundary. It restores the Journal projection into canonical Portfolio/OrderRegistry values, reconciles only those owned orders against the supplied canonical order history, and passes canonical account/fill evidence to the production audit. Extra order-history entries are rejected rather than adopted. Account-wide external open orders are audited as reservations and blockers but are never changed.

The bundle is evidence, not a trust shortcut: an operator must verify its provenance, exchange export completeness, account snapshot timestamp, market metadata, fee-asset valuations, and digest before confirmation. The CLI cannot independently prove that the supplied offline export came from Binance or that an operator reviewed it correctly.

## Required sequence

1. Discover and validate the complete Journal session history; project and restore only a candidate state.
2. Reconcile every Harvester-owned order by canonical client/broker identity and exchange status. Offline mode uses only the operator-supplied canonical order-history evidence.
3. Obtain a fresh canonical account snapshot and the complete account-wide open-order set.
4. Exhaust target-market trade history from the operator-reviewed `coveredFromTime`.
5. Run the production account audit with `tradeHistoryScope: "MARKET"`, complete-history enforcement, the exact target Market and candidate retention evidence.
6. Require a non-skipped audit, no target-market blocker, complete history and matching baseline fact identity.
7. Only with explicit `--confirm`, append `MARKET_HISTORY_COVERAGE_CONFIRMED` through the existing ADR-0001 durable-facts port and verify the readback.

## Fail-closed behavior

- A failed/ambiguous owned-order reconciliation stops before account/history evidence is trusted.
- A target-market unowned order blocks that market's confirmation. It is never adopted, canceled or modified.
- An unowned order in another market remains a symbol-scoped blocker; it does not automatically invalidate the selected market.
- Missing assets/market metadata, incomplete history pagination, a history start later than the reviewed boundary, an account-balance mismatch, mismatched retention evidence, a skipped audit or an unreadable durable-fact ledger cannot create a coverage fact.
- The baseline fact identity is deterministic per symbol. An identical retry is idempotent; a conflicting baseline is rejected rather than silently replacing or narrowing existing coverage.
- The Journal remains an operational evidence observer. The coverage fact is written only to the ADR-0001 durable-facts stream.

## Current implementation status

**Status: IN PROGRESS — offline CLI/context composition and production-audit evidence matrix are in [PR #1053](https://github.com/45s/coinzilla/pull/1053); exact-head CI is pending.**

PR #1047 delivered the read-only orchestration and guarded confirmation use cases. PR #1053 adds the offline JSON context adapter, explicit audit-only/confirmation CLI modes, canonical entity construction, and end-to-end tests using the production account audit and filesystem durable-fact store. No exchange write, broker connection, startup replay, Telegram command or runtime readiness wiring is introduced.

Steps 8 and 9 remain separate gates: candidate-state restoration behind closed readiness, then crash/restart and restart-twice verification. Unattended restart readiness remains disabled.
