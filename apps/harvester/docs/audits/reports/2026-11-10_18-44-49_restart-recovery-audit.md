# Harvester process-restart recovery audit — 2026-11-10

> **Status:** forensic findings recorded; implementation not authorized or performed.
> **Observed at:** 2026-11-10 18:44:49 UTC.
> **Repository:** `45s/coinzilla`, branch `develop`.
> **Exact source baseline:** `71624bcabf1c37ae643dde23d448b8753266024b`.
> **Parent:** [issue #654](https://github.com/45s/coinzilla/issues/654), including [the original audit comment](https://github.com/45s/coinzilla/issues/654#issuecomment-6775656952).

## Scope and safety boundary

This is a read-only source, test, issue and documentation audit. No application source, tests, runtime configuration or exchange state were changed. No Harvester process was started or restarted. No Binance account query, TESTNET/LIVE connection, order submission, cancellation or modification was performed. Tests and CI were inspected but not executed in this audit.

The purpose is to establish what recovery foundations exist, identify unsafe gaps and requirements conflicts, and define the smallest safe sequence for a later, separately authorized implementation.

## Executive result

Process-restart restoration is not implemented in the current startup composition. The retained PR #606 helper stack is useful but cannot safely be re-enabled as-is. At least four independent gates must be resolved first:

1. Previous Journal sessions must be discoverable across the current nested per-process log layout and legacy flat files.
2. A durable execution-fact contract must be chosen without silently violating the current rule that optional Journal evidence must not block fill accounting.
3. Account-wide unowned open orders must have an explicit readiness policy; the current `BLOCKED` audit result does not block trading readiness.
4. Historical order/trade completeness must be provable for every relevant market, or recovery must remain blocked for operator intervention.

**Safety rule:** unknown, incomplete, contradictory or unprovable trading state must never be converted into READY.

## Existing foundations

- PR #606 is merged. The repository retains `projectHarvesterJournalRecovery()`, `restoreHarvesterJournalState()`, `fetchAccountTradeHistory()`, `auditRecoveredTradeHistory()` and `auditRecoveredAccountState()` with focused offline tests.
- The projection/restore helpers cover order intents and acknowledgements, fill identities/fingerprints, Portfolio and RecoveryLedger reconstruction, order registry state, pauses/recovery intents, recovery-cycle events and account snapshots.
- The broker exposes canonical order lookup and symbol-scoped trade/fill history. Existing order-intent and cancellation-intent paths have durable Journal flush barriers before broker side effects.
- Same-process reconnect recovery is substantially more complete than process-death recovery. It must not be mistaken for restart recovery.
- Journal's lossless JSONL serialization and failure-propagation gap was fixed by PR #920 (issue #889); Harvester DTO compatibility was fixed by PR #925 (issue #923). These completed fixes should be reused, not reimplemented.

## Findings

### F-035 — Journal reader path does not discover previous per-process sessions

**Status:** CONFIRMED — integration blocker.

`prepareOptionalJournal()` calls `createHarvesterLogSessionPaths()` when a process identity is supplied and passes the new process's `sessionDirectory` to `Journal`. The current layout is `logs/sessions/<timestamp>-<runtime-session-id>/<journal-session>.jsonl`.

`Journal.read()` delegates to `readJournalRecords()` using only its configured directory. `FileSystemJournalStore.listSessions()` enumerates immediate entries in that directory; `readJournalRecords()` accepts direct `.jsonl` files and does not recurse into child directories. A new process receives a new session directory, so reading from its configured directory cannot discover the previous process's sibling session directories. Reading the `logs/sessions` parent also does not recurse into those directories. The older PR #606 integration predates the PR #874/#880 per-process layout.

This is not a defect in Journal's documented flat-directory reader contract. It is a mismatch between Harvester's current nested session layout and the reader path recovery would need. Recovery must explicitly enumerate every prior process-session directory, retain legacy flat root-level sessions, impose deterministic ordering and resource bounds, and fail closed on missing, malformed, truncated or ambiguous history.

### F-036 — BLOCKED open-order audit does not block trading readiness

**Status:** CONFIRMED readiness gap; duplicate-order consequence STRONGLY INDICATED, NOT REPRODUCED.

`createAccountSnapshotManager()` classifies unmatched account-wide open orders as `readiness: BLOCKED` with `UNOWNED_OPEN_ORDERS` reasons. `subscribeToUserData()` awaits that audit but does not inspect its readiness result before setting `state.ready = true` and resuming deferred strategy evaluation. The current startup regression explicitly allows runtime startup with an unowned open order.

That regression uses an unowned ZROUSDT order while BTCUSDT is enabled and emits no market-price tick. It proves that the order is neither adopted nor canceled and that startup proceeds; it does not prove that a later same-symbol market tick cannot cause a new strategy order. The Conservative engine's active-order and commitment guards use only its in-memory OrderRegistry. With no restored registry entry, a prior same-symbol order can be invisible to duplicate suppression if sufficient free quote remains.

Do not label a duplicate submission as an observed incident. Add a deterministic same-symbol regression that sends a market tick after startup and verifies the selected safe policy. The policy must preserve manual-order ownership: never adopt, cancel or modify an external order. Decide whether conflicting unowned orders block the affected symbol, shared-asset account scope, or the whole trading process; do not leave `BLOCKED` as a diagnostic-only value without an explicit risk decision.

### F-037 — Durable recovery conflicts with the current Journal non-blocking contract

**Status:** CONFIRMED requirements conflict; design decision required before implementation.

`apps/harvester/AGENTS.md`, `TRADING_FIRST.md` and `JOURNAL_EVIDENCE_CONTRACT.md` state that additional Journal evidence is best-effort and must not add blocking I/O to market processing, broker-event handling or fill accounting. The Journal is an observer, not trading-state authority.

Process-restart safety nevertheless requires execution facts and safety pauses to survive abrupt termination before the application advances as though those facts are recoverable. The current engine applies a canonical fill to in-memory Portfolio/RecoveryLedger state, then publishes `execution.fill_applied` without an immediate durable flush. `pause()` publishes `STRATEGY_PAUSED` without a durable flush. These existing F-028/F-029 gaps mean recent fill and pause facts are not guaranteed to be on disk after process death.

Do not silently extend the optional Journal observer into a trading-state authority or violate the no-blocking-I/O rule. Preferred design to evaluate: an application-owned durable execution-fact port/store with an explicit acknowledgement contract, while the Journal remains a separate observer. The application may gate progression to the next strategy decision/order side effect on that durable acknowledgement; domain objects remain independent of Journal, EventBus and storage. An alternative requires an explicit revision of the current architecture contract and a reviewed trade-off. No implementation choice is accepted by this audit.

### Existing F-031 — historical market/trade-history completeness remains unresolved

PR #606's integration passes `marketUniverseComplete: false`, while `auditRecoveredTradeHistory()` requires `true`; therefore the old trading-enabled path fails closed after prior trading activity. The current runtime bypasses this gate and starts with fresh in-memory state; it does not solve completeness.

`fetchAccountTradeHistory()` is symbol-scoped and receives a caller-supplied market list. The current exchange market catalog cannot prove all historical symbols, including delisted markets. The inspected official API documentation does not establish a guaranteed history-retention horizon. Pagination exhaustion for the supplied symbols is not proof that the supplied market universe is complete.

Do not change the flag to `true` merely to make recovery pass. Define the exact universe that can be proven (including Harvester-owned symbols from durable intents), prove per-order/per-symbol history completeness and retention coverage, and reconcile account-wide balance deltas for unexplained external activity. If completeness cannot be proven, fail closed and require an operator-assisted reconciliation path.

### Existing F-028/F-029 — fill and safety-pause durability gaps

- F-028: `execution.fill_applied` is published after in-memory accounting, but the fill path does not immediately flush the Journal. A later order-intent flush may incidentally include earlier events, but that does not protect the crash window before that barrier.
- F-029: per-market pause/recovery-intent Sets are process-local; `STRATEGY_PAUSED` publication is not itself a durable checkpoint. A restart can lose a prior safety pause unless another authoritative source rediscovers the cause.

These are missing guarantees, not proof that a specific historical fill or pause was lost.

## Proposed maximum-safety implementation roadmap

These are recommendations only. Each phase requires a separate implementation authorization and RED → GREEN evidence.

1. **Close the architecture decision first.** Define the durable fact source, ownership, failure semantics, schema/versioning, write acknowledgement, replay/idempotency contract, and how it coexists with the optional Journal observer. Do not start wiring PR #606 before this decision.
2. **Make history discovery correct.** Enumerate all nested process-session directories plus legacy flat Journal files. Validate the complete set before applying any projection; preserve immutable bytes; reject gaps, truncation, malformed records, unsupported schemas, duplicate/conflicting identities and resource-limit overflow. Define session ordering and checkpoint/manifest semantics.
3. **Persist immutable execution facts before progression.** Separate an exchange-observed execution fact from the derived `fill_applied` projection event. Durably record canonical fill identity, order identity, market, side, exact quantities/notional, commission asset/amount and transaction time. Only then apply the idempotent Portfolio/RecoveryLedger projection and allow subsequent strategy progression. A crash after durable fact but before projection must replay once; a crash after projection must not double-apply. Persistence failure closes the trading gate.
4. **Persist safety-control facts.** Restore market/account pauses, recovery-managed pauses, cancellation/replacement intents and operator holds. A restart must never clear a pause merely because process memory was recreated.
5. **Restore order ownership conservatively.** Restore client IDs and known broker IDs from durable intents; resolve UNKNOWN by canonical clientOrderId lookup; reconcile canonical order state and complete fill history. Never infer ownership from symbol/side/price/quantity alone. Never adopt, cancel or modify manual orders.
6. **Prove external-history and account completeness.** Define supported market universe, pagination exhaustion, cursor persistence, exchange retention limits, delisted-market behavior, shared-asset effects, and the manual/external activity policy. Compare restored Portfolio, active reservations, current free/locked balances, account-wide open orders and all available canonical fills. Any unexplained delta or missing proof blocks readiness.
7. **Add one startup readiness gate.** Connectivity and market subscriptions are not trading readiness. Do not resume deferred strategy evaluations or enable submissions until every recovery, ownership, history, account, pause and durability check is complete. A failed or unknown result must identify the blocking reason and require an explicit safe retry or operator action.
8. **Test every crash boundary offline.** Cover crash after intent flush/before broker call; broker acceptance/before acknowledgement; partial/full fill/before durable fact; after durable fact/before projection; after projection/before next intent; cancel/fill races; recovery-cycle completion; pause persistence; duplicate replay; truncated/missing sessions; missing/delisted markets; history limits; manual same-symbol and shared-asset orders; and account mismatch. Assert no duplicate order, no double/missed fill application, no lost reservation and no READY under uncertainty.
9. **Only then run controlled TESTNET validation.** Keep all default tests offline. Require a separate explicit TESTNET authorization and a clean, known account state. LIVE restart acceptance is a separate release decision.

~~~mermaid
flowchart TD
  A[Process starts] --> B[Discover all prior Journal and durable-fact sessions]
  B --> C{All records complete and valid?}
  C -- No --> X[BLOCKED: operator reconciliation]
  C -- Yes --> D[Restore idempotent domain projections and safety pauses]
  D --> E[Resolve owned orders by canonical client/order identity]
  E --> F[Reconcile complete fills, balances, locks and open orders]
  F --> G{History and account state provably consistent?}
  G -- No --> X
  G -- Yes --> H[Durability and ownership checks complete]
  H --> I[Enable strategy evaluation and trading]
~~~

The diagram is a proposed safety gate, not a description of current runtime behavior or an accepted architecture decision.

## Evidence reviewed

- Current `develop` source at `71624bcabf1c37ae643dde23d448b8753266024b`: `apps/harvester/src/index.js`, `bootstrap/start-harvester.js`, `bootstrap/user-data/subscribe-to-user-data.js`, `bootstrap/account/create-account-snapshot-manager.js`, `infrastructure/journal/prepare-optional-journal.js`, `infrastructure/logging/create-harvester-log-session-paths.js`, `use-cases/conservative-trading-engine.js`, and retained recovery helpers.
- Journal reader/writer: `packages/journal/src/journal.js`, `read-journal-records.js`, `adapters/filesystem-journal-store.js`.
- Tests inspected: `apps/harvester/src/bootstrap/start-harvester.test.js` and recovery-helper tests; Journal read/replay implementation and package contract.
- Historical integration: PR #606; per-process layout: PRs #874/#880; Journal durability correction: issue #889 / PR #920; Harvester DTO correction: issue #923 / PR #925.
- Existing Harvester contracts: `AGENTS.md`, `TRADING_FIRST.md`, `JOURNAL_EVIDENCE_CONTRACT.md`, `JOURNAL_OPERATIONS.md`, `ROADMAP.md`, `ACCOUNTING_INVARIANTS.md` and architecture guidance.

## Verification boundary

Source and tests were inspected only. No test command, coverage run or CI workflow was executed. No source or test files were changed. No Harvester process, Binance connection, account query or exchange order operation was performed.

**Disposition:** keep #654 open. Do not enable unattended process restart in TESTNET or LIVE until the architecture conflict, history discovery, market-universe completeness, open-order readiness policy, durable fill/pause facts and startup gate are resolved and exact-head verified.
