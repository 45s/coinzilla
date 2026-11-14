# One-market recovery reconciliation (ADR-0001 Step 7)

## Purpose

This workflow verifies one previously active market against canonical exchange evidence before an operator confirms its historical fill-coverage baseline. It is a prerequisite for later startup restoration, not a runtime startup path.

The implementation is split into three application boundaries:

- `reconcileRecoveredMarketState()` composes canonical owned-order reconciliation, a fresh account snapshot, account-wide open orders, target-market trade-history exhaustion and the production `auditRecoveredAccountState()`.
- `confirmMarketHistoryCoverage()` verifies the existing ADR-0001 fact ledger, invokes reconciliation, appends the per-market coverage fact only after a READY result, then reads the committed fact back.
- `runOfflineMarketRecovery()` adapts a supplied evidence bundle into canonical entities and the production use cases. The CLI never creates a broker, reads a live exchange, starts Harvester, or invokes an order-placement/cancellation port.

See [ADR-0001](../architecture/decisions/0001-application-owned-recovery-facts.md), [Journal operations](../JOURNAL_OPERATIONS.md) and [the recovery roadmap](../../ROADMAP.md#process-restart-recovery--small-step-delivery-plan-654).

## Offline CLI

The command accepts an operator-prepared JSON evidence bundle. It does not discover or read Journal files itself; the bundle must contain the validated Journal projection input and the independently collected exchange evidence. The audit result is deterministic for a fixed bundle and has no network dependency; a successful confirmation still records the durable store's actual commit timestamp.

From `apps/harvester`:

```sh
pnpm run recovery:market -- --context ./recovery-evidence/linkusdt.json
```

The default mode is audit-only and never writes to the Operational State Store. It reports `READY`, `BLOCKED` or `SKIPPED`; exit code `0` means READY in audit-only mode or confirmed in explicit confirmation mode, `2` means the audit did not establish readiness, and `1` means invalid input or an execution/evidence failure.

Only an explicit confirmation flag can append a coverage fact:

```sh
OPERATIONAL_STATE_DIRECTORY=/absolute/path/to/existing/operational-state \
  pnpm run recovery:market -- --context ./recovery-evidence/linkusdt.json --confirm
```

On Windows PowerShell:

```powershell
$env:OPERATIONAL_STATE_DIRECTORY = "C:\coinzilla-data\operational-state"
pnpm run recovery:market -- --context .\recovery-evidence\linkusdt.json --confirm
```

Confirmation uses `OPERATIONAL_STATE_DIRECTORY` when set; otherwise it resolves the same package-local `apps/harvester/recovery-facts/` directory as the runtime. It requires an already initialized and verifiable ADR-0001 store. The CLI never initializes, repairs or replaces a missing store. Do not initialize a production ledger for this Step 7 command; the ADR reserves production genesis for the later runtime-integration gate. The context's `runtimeSessionId` identifies the explicit offline confirmation process.

### Evidence bundle contract

All timestamps in this bundle are Unix milliseconds. The JSON root has these fields:

- `symbol`: the one uppercase target market.
- `runtimeSessionId`: required for `--confirm`; a non-empty identifier for this offline confirmation process.
- `journalRecords`: normalized records accepted by `projectHarvesterJournalRecovery()`; each record has `position.fileName` and `payload.source/name/data`.
- `assets`: optional additional canonical asset identities, required for third-asset commissions not already described by a market.
- `markets`: canonical market metadata for the target and every market referenced by Journal orders/fills, owned-order evidence or account-wide open orders. Each market has `venue`, `symbol`, `baseAsset` and `quoteAsset`; each asset has `id` and `code`.
- `coverage`: `coveredFromTime`, `verifiedAt`, 64-character lowercase SHA-256 `evidenceDigest`, and canonical non-empty `verifiedBy`.
- `exchange.currentAccountSnapshot`: `sourceTime` and all relevant balances as `{ assetId, asset, free, locked }`; amounts are exact non-negative decimal strings.
- `exchange.ownedOrderHistory`: one canonical exchange status record for every non-rejected order retained in the restored OrderRegistry, keyed by its exact `clientOrderId`. Each record contains the acknowledged `brokerOrderId`, `symbol`, `side`, `type`, canonical `status` (`NEW` is normalized to `OPEN`), `price` for limit orders, `originalQuantity` and `executedQuantity`. Missing, duplicate or extra records fail closed; rejected local submissions are not exchange-owned orders and must not be included.
- `exchange.openOrders`: the complete account-wide open-order snapshot in the normalized order shape consumed by the production audit. Unowned orders remain unowned and are never adopted or mutated.
- `exchange.tradeHistory`: target-market fills plus `historyPagesComplete`, `marketHistoryPagesComplete`, `historyScope: "MARKET"`, `marketsQueried: [symbol]` and `historyStartTime`. The start time must equal `coverage.coveredFromTime`; a later start cannot certify the omitted interval.

Each trade-history fill contains `tradeId`, `brokerOrderId`, optional `clientOrderId`, `symbol`, `side`, `price`, `quantity` and `quoteQuantity`. `liquidityRole` and `commissionStatus` are optional and default to `UNKNOWN`; `executedAt` and `commissions` are optional. A `PARTIAL` commission status must include at least one known commission, while `UNKNOWN` must not include commission entries. Commission records contain `assetId`, `asset`, `amount`, and optional historical `quoteValue: { assetId, asset, amount }`. Every amount is an exact decimal string.

The adapter verifies that the history is scoped to exactly the target market and begins exactly at the reviewed coverage boundary. It restores the Journal projection into canonical Portfolio/OrderRegistry values, reconciles only those owned orders against the supplied canonical order history, and passes canonical account/fill evidence to the production audit. Extra order-history entries are rejected rather than adopted. Account-wide external open orders are audited as reservations and blockers but are never changed.

The bundle is evidence, not a trust shortcut: an operator must verify its provenance, exchange export completeness, account snapshot timestamp, market metadata, fee-asset valuations, and digest before confirmation. The CLI cannot independently prove that the supplied offline export came from Binance or that an operator reviewed it correctly.

### Minimal complete example

This fixture represents a trading-enabled Journal session with a complete PREFLIGHT snapshot, no recovered orders/fills, and a complete target-market history export. Real evidence must replace every timestamp, balance, identity and digest; never copy these sample values into an actual baseline.

```json
{
  "symbol": "LINKUSDT",
  "runtimeSessionId": "offline-review-2026-11-12",
  "journalRecords": [
    {
      "position": { "fileName": "session-001" },
      "payload": {
        "source": "harvester",
        "name": "account.snapshot_captured",
        "data": {
          "phase": "PREFLIGHT",
          "sourceTime": 100,
          "auditStatus": "COMPLETE",
          "auditReasons": [],
          "balances": [
            { "asset": "LINK", "free": "0", "locked": "0", "total": "0" },
            { "asset": "USDT", "free": "100", "locked": "0", "total": "100" }
          ]
        }
      }
    },
    {
      "position": { "fileName": "session-001" },
      "payload": {
        "source": "harvester",
        "name": "harvester.started",
        "data": { "tradingEnabled": true }
      }
    }
  ],
  "markets": [
    {
      "venue": "BINANCE",
      "symbol": "LINKUSDT",
      "baseAsset": { "id": "binance:LINK", "code": "LINK" },
      "quoteAsset": { "id": "binance:USDT", "code": "USDT" }
    }
  ],
  "coverage": {
    "coveredFromTime": 100,
    "verifiedAt": 200,
    "evidenceDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "verifiedBy": "operator-review"
  },
  "exchange": {
    "currentAccountSnapshot": {
      "sourceTime": 300,
      "balances": [
        { "assetId": "binance:LINK", "asset": "LINK", "free": "0", "locked": "0" },
        { "assetId": "binance:USDT", "asset": "USDT", "free": "100", "locked": "0" }
      ]
    },
    "ownedOrderHistory": [],
    "openOrders": [],
    "tradeHistory": {
      "fills": [],
      "historyPagesComplete": true,
      "marketHistoryPagesComplete": true,
      "historyScope": "MARKET",
      "marketsQueried": ["LINKUSDT"],
      "historyStartTime": 100,
      "marketUniverseComplete": false
    }
  }
}
```

## Required sequence

1. Discover and validate the complete Journal session history; project and restore only a candidate state.
2. Reconcile every Harvester-owned order by canonical client/broker identity and exchange status. Offline mode uses only the operator-supplied canonical order-history evidence.
3. Obtain a fresh canonical account snapshot and the complete account-wide open-order set.
4. Exhaust target-market trade history from the operator-reviewed `coveredFromTime`.
5. Run the production account audit with `tradeHistoryScope: "MARKET"`, complete-history enforcement, the exact target Market and candidate retention evidence.
6. Require a non-skipped audit, no target-market blocker, complete history and matching baseline fact identity.
7. Only with explicit `--confirm`, append `MARKET_HISTORY_COVERAGE_CONFIRMED` through the existing ADR-0001 Operational State Store port and verify the readback.

## Fail-closed behavior

- A failed/ambiguous owned-order reconciliation stops before account/history evidence is trusted.
- A target-market unowned order blocks that market's confirmation. It is never adopted, canceled or modified.
- An unowned order in another market remains a symbol-scoped blocker; it does not automatically invalidate the selected market.
- Missing assets/market metadata, incomplete history pagination, a history start later than the reviewed boundary, an account-balance mismatch, mismatched retention evidence, a skipped audit or an unreadable Operational State Store cannot create a coverage fact.
- The baseline fact identity is deterministic per symbol. An identical retry is idempotent; a conflicting baseline is rejected rather than silently replacing or narrowing existing coverage.
- The Journal remains an operational evidence observer. The coverage fact is written only to the Operational State Store.

## Current implementation status

**Status: IMPLEMENTED AND MERGED — offline CLI/context composition and the production-audit evidence matrix merged in [PR #1053](https://github.com/45s/coinzilla/pull/1053). All required core CI workflows passed on exact code head `2c3a48442f893521403d53e4816631a9de4b0878`; optional read-only TESTNET integration was skipped. Step 7 implementation is complete.**

PR #1047 delivered the read-only orchestration and guarded confirmation use cases. PR #1053 adds the offline JSON context adapter, explicit audit-only/confirmation CLI modes, canonical entity construction, and end-to-end tests using the production account audit and filesystem Operational State Store. No exchange write, broker connection, startup replay, Telegram command or runtime readiness wiring is introduced.

Steps 8 and 9 remain separate gates: candidate-state restoration behind closed readiness, then crash/restart and restart-twice verification. Unattended restart readiness remains disabled.
