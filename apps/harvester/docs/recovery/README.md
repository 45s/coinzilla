# One-market recovery reconciliation (ADR-0001 Step 7)

## Purpose

This workflow verifies one previously active market against canonical exchange evidence before an operator confirms its historical fill-coverage baseline. It is a prerequisite for later startup restoration, not a runtime startup path.

The implementation is split into three application boundaries:

- `reconcileRecoveredMarketState()` composes canonical owned-order reconciliation, a fresh account snapshot, account-wide open orders, target-market trade-history exhaustion and the production `auditRecoveredAccountState()`.
- `confirmMarketHistoryCoverage()` verifies the existing ADR-0001 fact ledger, invokes reconciliation, appends the per-market coverage fact only after a READY result, then reads the committed fact back.
- `runOfflineMarketRecovery()` adapts a supplied evidence bundle into canonical entities and the production use cases. The CLI never creates a broker, reads a live exchange, starts Harvester, or invokes an order-placement/cancellation port.

See [ADR-0001](../architecture/decisions/0001-application-owned-recovery-facts.md), [Journal operations](../JOURNAL_OPERATIONS.md) and [the recovery roadmap](../domain/recovery-seller-implementation-roadmap.md#rs-5--offline-lifecycle-verification-and-delivery).

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

## Offline user-data ACCOUNT blocker resolution

This is the explicit operator workflow for a user-data ACCOUNT safety blocker. It is separate from one-market coverage confirmation and is only available after the Harvester process has been cleanly stopped.

Producer provenance determines resolver ownership. `RECOVERY_SELLER_STOP_WORKFLOW` facts remain exclusively owned by the existing Recovery Seller resolver; legacy untagged Recovery Seller facts retain that resolver through the reserved reason code. If a fact explicitly identifies `USER_DATA_EVENT_HANDLER` but uses the reserved Recovery Seller STOP reason, projection fails closed and neither resolver may clear it.

From `apps/harvester`, run:

```sh
OPERATIONAL_STATE_DIRECTORY=/absolute/path/to/existing/operational-state \\
  pnpm run recovery:account-blockers -- \\
    --context ./recovery-evidence/account-wide.json \\
    --operator-id <current-os-user> \\
    --action-id account-resolution-2026-11-26-001 \\
    --resolution-reason "Reviewed complete account evidence and confirmed the underlying cause is fixed." \\
    --cause-fixed
```

Replace `<current-os-user>` with the exact username returned by the operating system for the account running the command. The utility also supports `--version` to print its build identity. The command requires an existing, durable Operational State Store and the `runtimeSessionId` of the latest process session. The latest matching `PROCESS_STOPPED` fact must be clean; a later unclean stop invalidates an earlier clean-stop fact. The supplied `--operator-id` must exactly match the authenticated operating-system account running the command; a caller-supplied name alone is not trusted. The required `--resolution-reason` is persisted with every per-blocker resolution fact alongside the operator ID, `OS_ACCOUNT` authentication method, unique action ID, full original blocker set, and canonical evidence digest.

The action ID is globally unique across operator-resolution facts. An exact retry using the same authenticated operator, action ID, reason, original blocker set, and evidence digest is idempotent. If a multi-blocker append partially commits, retry the same command with the same action ID and unchanged evidence bundle: the workflow verifies the previously committed facts and appends only the remaining blockers. A completed exact duplicate returns an idempotent success without appending new facts. Reusing the action ID with a different operator, reason, blocker set, or evidence is rejected. Legacy operator-resolution facts without structured action metadata cannot be safely replayed; choose a new action ID for a new operation.

The offline adapter also rejects missing configured-market evidence, session/configuration mismatches, non-user-data ACCOUNT provenance, incomplete history, unresolved fills/orders, blocked markets, stale account snapshots, and incomplete balance/order coverage before any resolution append. The offline regression suite exercises append failure, partial multi-blocker append/retry, exact duplicate replay, conflicting action-ID reuse, non-durable append, and failed readback; successful resolution must still report BLOCKED readiness. It derives the configured market universe from that session's durable configuration baseline; the evidence bundle cannot narrow the market list. It refuses legacy/unknown-producer ACCOUNT blockers and Recovery Seller STOP. Recovery Seller STOP is raised with the dedicated RECOVERY_SELLER_STOP_WORKFLOW producer; the verified projector accepts only its dedicated legacy operator-action resolution, while user-data ACCOUNT blockers require structured OS-authenticated operator metadata. Mixed active ACCOUNT blocker sets remain fail-closed.

The local OS-account authentication binds the CLI action to the process account; it is not enterprise SSO or cryptographic proof of the human at the keyboard. The supplied offline evidence bundle remains operator-reviewed evidence: the CLI cannot independently prove that an exchange export came from Binance or that its provenance is genuine.

The account-wide evidence bundle reuses the one-market contract above, with these root fields:

- `configuredMarkets`: exact configured symbols from the durable configuration baseline.
- `journalRecords`, `markets`, `assets`: one shared canonical Journal/account/market identity set.
- `exchange.currentAccountSnapshot`, `exchange.openOrders`, `exchange.ownedOrderHistory`: one shared account snapshot and complete account-wide order evidence.
- `marketsEvidence`: an object keyed by every configured symbol. Each entry contains its own reviewed `coverage` and `tradeHistory` bundle; the trade-history scope must be exactly that market.

The command runs the existing production `reconcileRecoveredMarketState()` / `auditRecoveredAccountState()` audit for every configured market against the same account snapshot and order evidence. It appends resolution facts only when every market is READY, every configured market's history is complete from its reviewed coverage boundary, and the account-wide balance/order/reservation audit has no unresolved owned or external orders, fills, or discrepancies. Any missing market, incomplete history, unknown ownership, inconsistent accounting, or non-durable store leaves all blockers active.

This command is offline: it does not connect to an exchange, place/cancel/replace orders, restart Harvester, clear live process flags, or enable trading. A successful result means only that durable resolution facts were committed and read back. **Trading remains blocked until a controlled restart and a fresh authoritative account snapshot pass startup admission.** Recovery Seller STOP is never cleared by this path. A mixed active ACCOUNT blocker set that includes Recovery Seller provenance is rejected without appending any resolution facts. The regression suite also verifies that a balance mismatch against the Journal blocks resolution before append. The balance test keeps the Journal baseline at USDT 100 while the supplied authoritative snapshot reports USDT 99; the mixed-producer test verifies that a Recovery Seller ACCOUNT blocker prevents any user-data resolution append.
