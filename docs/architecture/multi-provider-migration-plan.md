---
title: Multi-provider migration audit and implementation plan
status: active
type: plan
owner: harvester-and-brokers
created: 2026-11-17
last_verified: 2026-11-18
---

# Multi-provider migration audit and implementation plan

**Tracking:** [Harvester/Brokers issue #1339](https://github.com/45s/coinzilla/issues/1339)
**Architecture authority:** [ADR-0003](./decisions/ADR-0003-multi-provider-routing.md) and [ADR-0004](./decisions/ADR-0004-complete-bitunix-provider-integration.md)
**Audit baseline:** `develop` at `16a8842fed0407fce67361fb382a6aaa1dab32bd` (2026-11-18 11:12:04 UTC).
**Scope:** source-verified migration plan and implementation sequencing. Phase 4 is authorized only for basic in-process account isolation; process-restart recovery, restoration and replay are explicitly deferred under #654.

## Current source revalidation — 2026-11-18

**Revalidation checkpoint:** `develop` at `636cbc3c6021a59782fa2517447e373883f1af76` (2026-11-18; includes merged PR #1452 Phase 5 independent market-data routing). This section supersedes earlier statements about current delivery status where they differ; historical audit evidence remains unchanged.

- **Phase 1 — complete:** Brokers' immutable Binance capability declaration merged in [PR #1366](https://github.com/45s/coinzilla/pull/1366). This is additive capability metadata; it does not enable another provider.
- **Phase 2 — foundation merged, routing not delivered:** [PR #1383](https://github.com/45s/coinzilla/pull/1383) adds stable Binance provider-instance/account identity, an exchange-neutral provider registry, capability validation, and deterministic connection/rollback lifecycle. It preserves the legacy single-Binance trading runtime.
- **Superseded parallel work:** [PR #1386](https://github.com/45s/coinzilla/pull/1386) was closed unmerged as superseded by PR #1383. The final closure review confirmed that #1383 already contains the in-flight connect/disconnect lifecycle serialization and deterministic regression coverage added during the #1386 review. No code from the old #1386 branch is needed.
- **Phase 4 production integration — COMPLETE:** merged in [PR #1445](https://github.com/45s/coinzilla/pull/1445). Exact head `8f1f2b4888edb716b15741bec61afcb0b8d8dcdc` merged as `5eaf38d88591a055e155ab5b8df22326ff76949b`. `brokers.instances` resolves explicit provider/account/environment identities and credential environment-variable references; the process entrypoint acquires account-scoped locks and starts an independent Harvester runtime per account. Credential variables belonging to other configured accounts are removed from each child runtime environment. Confirmed startup cleanup releases the failed account lock; uncertain cleanup retains it until process shutdown cleanup is confirmed. The legacy single-Binance environment remains the compatibility fallback. The default production adapter map currently registers Binance only; unsupported provider types fail clearly.
- **Bitunix provider boundary:** the interim observer runtime from #1422 has been removed in [PR #1455](https://github.com/45s/coinzilla/pull/1455). Bitunix is not registered as a Harvester provider until [#1185](https://github.com/45s/coinzilla/issues/1185) is complete; future integration must use the complete provider-instance, BrokerPort, capability, account-lifecycle, execution-routing and market-data contracts defined by [ADR-0004](./decisions/ADR-0004-complete-bitunix-provider-integration.md).
- **Phase 3 — COMPLETE:** [PR #1416](https://github.com/45s/coinzilla/pull/1416) merged as `543753da5938eba2d95ad19d74c3f98a991e6461` from synchronized head `e58569eaebf968f5cfcfd3fbef5b6302eb0f21ee`. Immutable provider-instance/type/account provenance is persisted before broker I/O and retained through order, cancellation, fill, Journal and Operational State lifecycle records. Historical v1 facts and hash chains remain compatible; ambiguous legacy identities fail closed. All six required `develop-core` checks passed on the exact synchronized head.
- **Phase 4 — COMPLETE:** basic in-process account isolation is merged in [PR #1445](https://github.com/45s/coinzilla/pull/1445) (head `8f1f2b4888edb716b15741bec61afcb0b8d8dcdc`, merge `5eaf38d88591a055e155ab5b8df22326ff76949b`). PR #1440 provides account-scoped process locks and the per-provider/account state registry; PR #1445 wires optional `brokers.instances` configuration into the production entrypoint and starts a separate runtime per configured account. Credential environment variables are isolated per account. Partial provider startup failures are isolated; healthy account runtimes continue. Uncertain startup cleanup retains the failed account lock until confirmed process shutdown cleanup. The default production adapter map currently supports Binance only.
- **Phase 5 — COMPLETE:** independent market-data routing merged in [PR #1452](https://github.com/45s/coinzilla/pull/1452), merge commit `636cbc3c6021a59782fa2517447e373883f1af76`. **Phase 6 — IMPLEMENTED IN PR #1455:** explicit strategy/market execution routing, provider-account pinning, and independent market-data source selection; exact-head CI and merge remain the release gates. Bitunix provider registration remains blocked by #1185.
- **Trading safety gates unchanged:** Bitunix remains outside Harvester provider registration and routing until [issue #1185](https://github.com/45s/coinzilla/issues/1185) is complete; Recovery Seller remains non-executable under [issue #1127](https://github.com/45s/coinzilla/issues/1127). No exchange operations were performed for this revalidation.

This revalidation was a read-only source and GitHub delivery-state inspection and did not itself execute tests or CI. The subsequent synchronized PR #1416 head passed all six required `develop-core` checks and was merged as `543753da5938eba2d95ad19d74c3f98a991e6461`; those results are recorded above.

## Priority and next delivery decision — 2026-11-18

**Owner priority:** #1339 remains the primary Harvester architecture/delivery workstream. Phase 4 account isolation and Phase 5 independent market-data routing are complete; Phase 6 explicit execution routing is implemented in PR #1455 and pending exact-head CI/merge. Binance remains the only registered production adapter. Bitunix is not registered until #1185 is complete; the interim observer runtime has been removed.

**Current implementation priority: complete and merge Phase 6 execution routing in PR #1455.** Phase 4 basic in-process account isolation is complete in [PR #1445](https://github.com/45s/coinzilla/pull/1445), and Phase 5 independent market-data routing is complete in [PR #1452](https://github.com/45s/coinzilla/pull/1452). Keep runtime state in memory; do not introduce restart restoration or recovery gates.

**Phase 5 implementation scope:** `marketDataRouting.routes` explicitly maps each configured symbol to one `providerInstanceId`. In a multi-provider process, every enabled market must have exactly one route; duplicate, missing, unknown-provider, unconfigured-symbol and source-environment-incompatible routes fail before any account runtime starts. Each account runtime receives only the symbols assigned to its provider instance, and only that runtime establishes the price/book/candle subscriptions and seeds initial prices for those symbols. The source provider instance is exposed in runtime metadata and market-subscription diagnostics. A legacy single-provider configuration without a route table retains its existing all-markets behavior. No implicit multi-provider default, source fallback, blending, automatic switching, recovery, replay or restoration is introduced. Phase 6 execution routing remains separate.

**Process-restart recovery (#654) is explicitly the lowest-priority separate workstream.** It must not block Phase 5/6 or receive further implementation effort unless the user explicitly reprioritizes it.

**Phase 4 implementation complete:** [PR #1445](https://github.com/45s/coinzilla/pull/1445) merged with independent configured account runtimes, account-specific credential isolation, scoped process locks and partial startup failure isolation.

**Delivery sequence after Phase 3:**

1. Phase 3 is complete in merged PR #1416; preserve its immutable provenance and backward-compatible v1 fact guarantees in all subsequent phases.
2. Complete Phase 4 basic in-process account isolation, namespaced identities, independent account state and account-scoped locks. Do not implement or depend on process-restart recovery; #654 is deferred and lowest priority.
3. Phase 5 independent market-data routing is complete in PR #1452; continue with Phase 6 explicit Binance execution routing/parity. No silent fallback or source blending.
4. Complete exact-head CI, merge Phase 6 execution routing in PR #1455, and update the delivery record.
5. After Phase 6, complete Bitunix under #1185 as a full broker and Harvester provider integration; do not introduce an observer-only or partial staging facade. RS remains disabled until #1127 is complete.

The Harvester roadmap records #1339 as its top architecture/delivery priority. The ADA recovery lifecycle (#1359/#1362) remains a separate safety obligation and must continue to receive its own focused work; prioritization does not waive trading-safety gates.

## Phase 3 implementation closeout — 2026-11-18

**Implementation PR:** [#1416](https://github.com/45s/coinzilla/pull/1416), synchronized head `e58569eaebf968f5cfcfd3fbef5b6302eb0f21ee`, merged as `543753da5938eba2d95ad19d74c3f98a991e6461`.

The implementation adds immutable provider-instance, provider-type and stable account identity to canonical orders and fills; records submission intent before broker placement; propagates identity through acknowledgement, cancellation, stream/REST fill attribution, lifecycle DTOs, Journal replay and Operational State facts/projections; and rejects partial or conflicting identity. Historical records without provenance remain readable and are not assigned today's route identity. Focused tests cover entities, registry immutability, pre-I/O durability, cancellation/fill attribution, Journal and Operational State compatibility, and crash boundaries.

The synchronized final PR head `e58569eaebf968f5cfcfd3fbef5b6302eb0f21ee` passed all six required `develop-core` checks before merge. The merge does not implement account isolation, process-restart restoration, execution or market-data routing, a second execution provider, or any exchange operation. Issue #654 remains a separate release gate.

## 1. Executive decision

The repository has useful foundations for a gradual migration: Harvester owns its application-facing `BrokerPort`, exchange-specific behavior is behind infrastructure adapters, Binance has a substantial normalized order/user-data lifecycle, and ADR-0003 defines explicit execution and market-data routing.

The current production adapter catalog is **not yet ready to trade across multiple exchange types**: Binance is the only registered production adapter. Phase 4 does support multiple configured Binance accounts in independent runtimes. A second real provider adapter remains separate work; Bitunix is not enabled for Harvester trading. Process-restart restoration remains disabled and #654 Step 8/9 remains separate and LOWEST PRIORITY.

The safe direction is incremental:

1. Preserve the existing Binance-only composition and behavior.
2. Add truthful provider capability declarations in `packages/brokers`.
3. Prepare Harvester provider construction/registry without enabling multi-provider execution.
4. Establish durable, immutable order provenance and account-scoped identity.
5. Phase 4 account isolation and Phase 5 market-data routing are complete; keep process-restart recovery under separate lowest-priority #654 and continue with Phase 6 execution routing.
6. Introduce independent market-data routing.
7. Route existing Binance execution through the new composition and prove parity.
8. Enable another provider only after its complete required lifecycle is verified.

No implicit provider selection, wildcard route, fallback, failover, cross-provider retry, order migration, or balance aggregation is permitted.

## 2. Evidence and confidence

This is a source inspection snapshot, not a claim that tests or exchange operations were executed.

- **Source-confirmed:** directly visible in the implementation at the audit baseline.
- **Test-backed in repository:** relevant deterministic tests exist; this audit did not execute them.
- **Incomplete/unsupported:** the source explicitly rejects the operation or does not implement the required contract.
- **Risk:** a consequence that follows from current identity/ownership design but has not been reproduced as a runtime incident.
- **Not verified:** requires additional source, test, official exchange-contract or runtime evidence.

The audit reviewed ADR-0003, issue #1339, Harvester and Brokers instructions/roadmaps, the Harvester architecture and broker-port guides, and the source paths cited below. No live or TESTNET exchange operation was performed. No test suite was run as part of this documentation update.

## 3. Current architecture audit

### 3.1 Configuration and provider selection

**Finding — one hard-coded Binance provider.**

Relevant source:

- `apps/harvester/src/domain/app-config.js` — `resolveRuntimeConfig()` validates explicit `TRADING_MODE=testnet|live` and returns `brokerName: "binance"`.
- `apps/harvester/src/bootstrap/broker/connect-broker.js` — reads `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`, calls one injected adapter factory, validates one BrokerPort and connects it.
- `apps/harvester/src/bootstrap/start-harvester.js` — defaults `brokerAdapterFactory` to `createBinanceBrokerAdapter`.
- `apps/harvester/src/infrastructure/brokers/binance-broker-adapter.js` — translates the package broker into the Harvester-owned port.

The current runtime configuration does not accept named provider instances or independent execution/market-data route tables. The ADR's `brokers`, `executionRouting` and `marketDataRouting` examples are target examples, not today's validated configuration.

### 3.2 Composition, runtime ownership and lifecycle

**Finding — one broker and one account lifecycle are composed for the whole Harvester runtime.**

In `apps/harvester/src/bootstrap/start-harvester.js`, the startup/runtime resources contain one `broker`, one `userDataState`, one user-data subscription, and shared market/book subscription collections. The same broker is used by account snapshots, market metadata, user-data processing, market-data intake, trading workflows and cleanup.

The existing startup and cleanup path is carefully ordered and should be preserved. Multi-provider lifecycle must be added as an explicit registry of independently owned provider/account resources, not by constructing multiple brokers and sharing the current single-account state.

A partial startup failure must clean up every successfully constructed/connected provider and preserve all cleanup errors. A disconnect or recovery failure for one provider must not mark unrelated providers ready or unready.

### 3.3 Application port and broker base class

Relevant source:

- `apps/harvester/src/application/ports/broker.port.js`
- `apps/harvester/src/infrastructure/brokers/binance-broker-adapter.js`
- `packages/brokers/src/broker.core.js`

Harvester owns the application-facing `BrokerPort`, which is the correct dependency boundary. The current port is a broad application contract covering order, account, market metadata, market-data and user-data operations. The Binance adapter maps package-specific names such as `createOrder()` to the Harvester-facing `placeOrder()`.

`CoreBroker` installs default methods that throw “method should be implemented” errors. Inherited method presence is therefore not proof of support. `assertBrokerPort()` validates method shape, not exchange capability or verified lifecycle support.

**Recommendation:** keep the Harvester-owned port and existing public exports. Add explicit, provider-instance-specific capability metadata and validate routes against it. Do not make `CoreBroker` inheritance the capability system and do not introduce a generic plugin/DI framework.

### 3.4 Market-data subscriptions

Relevant source:

- `apps/harvester/src/bootstrap/subscriptions/subscribe-to-market-data.js`
- `apps/harvester/src/bootstrap/market/load-market-metadata.js`
- `apps/harvester/src/bootstrap/start-harvester.js`

Current price, book and candle subscriptions are started from the single runtime broker. Subscription collections are organized around the current market/symbol processing path; the application does not yet carry an immutable provider-instance identity through the full market-data lifecycle.

The target subscription identity should include at least `(providerInstanceId, capability, symbol)`. The selected market-data provider must remain observable in diagnostics and freshness decisions. One-shot reads, a depth snapshot and OHLC without volume must not be promoted to continuous price/book/canonical-candle capabilities.

### 3.5 Order execution and cancellation

Relevant source:

- `apps/harvester/src/use-cases/place-order.js`
- `apps/harvester/src/use-cases/conservative-trading-engine.js`
- `apps/harvester/src/domain/orders/order-registry.js`
- `apps/harvester/src/use-cases/record-order-submission-intent.js`
- `apps/harvester/src/use-cases/record-order-submission-outcome.js`
- `apps/harvester/src/use-cases/record-order-cancellation-intent.js`
- `apps/harvester/src/use-cases/record-order-cancellation-outcome.js`

The current workflow registers a pending order, persists the submission intent before exchange I/O, preserves unknown outcomes, and reconciles cancellation/execution facts. Those are safety invariants to retain.

The missing piece is not simply route lookup: the immutable provider/account identity must be captured and durably committed with the intent before the exchange write. All later order lifecycle operations must resolve the original provider/account from that immutable provenance, never from a mutable current route table.

A timeout or disconnect during a state-changing call remains UNKNOWN. It must never cause the same intent to be sent to a different provider.

### 3.6 User-data, recovery and shutdown

Relevant source:

- `packages/brokers/src/application/user-data-session.js`
- `packages/brokers/src/infrastructure/binance/broker-websocket/broker.js`
- `apps/harvester/src/bootstrap/user-data/subscribe-to-user-data.js`
- `apps/harvester/src/bootstrap/broker/cleanup-broker.js`
- `apps/harvester/src/bootstrap/shutdown/create-shutdown-handler.js`

Binance has a substantial user-data session lifecycle, reconnection/recovery generations and state-changing-operation gates. Harvester performs same-process reconciliation before readiness is restored. Current composition has one user-data readiness/recovery state; multi-provider support requires independent state per provider/account.

**Process-restart qualification:** #654 is not an empty or untouched workstream. Steps 1–7 have merged foundations; PR #1055 added Step 8 durable fact producers/barriers and offline candidate projection. Step 8 still requires full projection/invariant parity, account-wide market-universe reconciliation readiness and actionable ambiguity resolution. Step 9 crash/restart proof remains pending. Runtime restart restoration and unattended restarts remain disabled. See [issue #654](https://github.com/45s/coinzilla/issues/654) and the [Harvester recovery roadmap](../../apps/harvester/ROADMAP.md).

Do not describe the retained offline recovery helpers as current startup behavior. The current runtime does not restore the previous process's Portfolio, RecoveryLedger and OrderRegistry before strategy readiness.

### 3.7 Process locks

Source: `apps/harvester/src/infrastructure/process-lock/acquire-harvester-process-locks.js`.

The current lock fingerprint is derived from `[broker.toLowerCase(), tradingMode]`. It preserves broker/environment isolation, atomic acquisition and ownership safeguards, but does not include account or provider-instance identity.

Issue #1307 is closed as completed: TESTNET and LIVE can coexist while duplicate writers within one broker/environment remain excluded. The Harvester roadmap's prior `[~]` status has since been corrected to `[x]` (Complete — #1307 closed); this audit note records the status at the earlier audit baseline. Do not weaken the existing atomic acquisition, owner-token verification, conservative stale-owner recovery or uncertain-shutdown lock retention when introducing account-scoped locks.

An account-lock migration must prevent old and new lock protocols from granting concurrent writer authority to the same account. A coordinated transition/dual-lock or deployment barrier is required before legacy lock identity is retired.

## 4. Target architecture and ownership

ADR-0003 is the durable architecture authority. This section records its minimal implementation shape and the source-specific constraints.

| Component | Owner | Responsibility |
| --- | --- | --- |
| Provider-specific exchange client, signing, protocol DTOs and normalization | `packages/brokers` | Implement actual exchange operations and report verified capabilities |
| Provider construction/factory boundary | `packages/brokers` | Construct one provider client from validated provider-specific configuration |
| Harvester provider registry | `apps/harvester` | Own named provider instances and their independent lifecycle |
| Execution router | `apps/harvester` | Resolve exact `(strategyId, symbol) -> providerInstanceId` routes |
| Market-data router | `apps/harvester` | Resolve exact `symbol -> providerInstanceId` routes independently |
| Harvester BrokerPort | `apps/harvester` | Remain the application-owned contract injected into use cases |
| Order/account provenance and accounting identity | `apps/harvester` with shared entity coordination | Pin orders and account-scoped accounting to immutable provider/account identity |
| Strategy/domain policy | `apps/harvester` | Remain exchange-independent; no provider IDs, credentials or client objects |

The minimum useful additions are:

1. A validated provider-instance descriptor containing stable non-secret `providerInstanceId`, provider type, stable non-secret `accountId`, supported environment and explicit capabilities.
2. A Harvester-owned registry mapping provider instance IDs to adapters/descriptors and owning lifecycle.
3. Two independent explicit resolution operations: execution by strategy+symbol and market data by symbol.
4. An account-scoped runtime context for balances, reservations, open orders, readiness, user-data, recovery, reconciliation and cleanup.
5. Immutable order provenance stored before submission and reused for every subsequent lifecycle operation.

Do not introduce generic exchange frameworks, strategy-owned routing, broker-package routing policy, implicit defaults, wildcards, automatic fee optimization, automatic failover or cross-provider order retries.

### 4.1 Route validation and failure behavior

- Every enabled executable strategy/market pair resolves to exactly one configured provider instance.
- Every market-data symbol resolves to exactly one configured market-data provider instance.
- Missing/duplicate routes, unknown instances, unsupported capabilities and invalid environment/market combinations fail closed before the affected strategy can submit.
- The initial contract has no wildcard/default route and no fallback.
- Route changes affect new intents only. Existing orders, positions, reservations, fills and recovery obligations remain pinned.
- A provider outage may block its own route/account scope; it must not transfer work to another provider.
- Balances and reservations remain account-scoped. No cross-account spendable-balance aggregation is implied.

## 5. Provider capability matrix

Status is based on source implementation and repository tests at the audit baseline. “Tests exist” does not mean tests were executed in this audit or that the exchange contract was accepted in a live/TESTNET session.

### 5.1 Binance Spot

| Capability | Source status | Evidence / boundary |
| --- | --- | --- |
| Connect/disconnect | Implemented | `BinanceWebSocketBroker.connect()/disconnect()` |
| Latest prices | Implemented | `getPrices()` |
| Continuous prices | Implemented | Binance Streams aggregate-trade subscriptions |
| Book ticker stream | Implemented | `subscribeForBookTicker()` |
| Historical candles | Implemented | `getCandles()`, exact decimal strings and server-time handling |
| Live candles | Implemented | `subscribeForCandles()` |
| Market catalog/filters | Implemented | `getExchangeMarkets()`, `getSymbolFilters()` |
| Account balances/snapshot | Implemented | `getBalances()`, timestamped `getAccountSnapshot()` |
| Native Spot positions | Not applicable | Harvester derives strategy-owned Positions from fills; exchange custody is balances |
| Account-wide open orders | Implemented | `getOpenOrders()` with omitted symbol |
| Order lookup | Implemented | Exchange order ID or client order ID |
| Canonical order history | Implemented | `getCanonicalOrderHistory()` |
| Order placement | Implemented | `createOrder()` / `createCanonicalOrder()` |
| Cancellation | Implemented | State-changing RPC with reconciliation semantics |
| Canonical fills/trades | Implemented | `getFills()`, `getMyTrades()` and user-data execution normalization |
| Private user-data stream | Implemented | `UserDataSession` and Binance authenticated stream |
| Same-process recovery | Implemented | Generation-aware user-data recovery and Harvester reconciliation |
| Process-restart restoration | Not enabled | #654 Step 8/9 remains incomplete; current startup starts fresh |
| Trading modes | TESTNET and LIVE | Explicit `TRADING_MODE`; ADR-0002 remains authoritative |

Relevant implementation: `packages/brokers/src/infrastructure/binance/broker-websocket/broker.js`. The package and Harvester have offline tests for these paths. This audit did not execute them or perform exchange acceptance.

### 5.2 Additional providers — deferred, not abandoned

**Binance is the first provider in the implementation sequence, not the permanent or exclusive provider.** Bitunix development is temporarily paused while Binance capability contracts and Harvester integration progress.

Existing Bitunix source and capability research remain part of the project. Bitunix implementation continues under [issue #1185](https://github.com/45s/coinzilla/issues/1185). Its current partial query capabilities must not be treated as Harvester execution readiness. The #1422 observer runtime has been removed and is not an interim integration stage. [ADR-0004](./decisions/ADR-0004-complete-bitunix-provider-integration.md) defines the complete-provider admission rule.

When Bitunix implements and verifies the capabilities required by the shared broker contracts—including reliable account snapshots, stable order identity, safe placement and cancellation outcomes, complete order/fill reconciliation, private execution events, environment isolation, and lifecycle/recovery guarantees—it can be added to the provider registry and routed by Harvester under the same provider-neutral architecture.

Until those acceptance requirements are met, Bitunix must not be enabled for Harvester execution. This temporary sequencing does not remove Bitunix from the target architecture or make Binance the only provider Harvester may support.

### 5.3 Capability reporting rule

Do not infer capability from:

- Inheritance from `CoreBroker`.
- Method existence or a broad BrokerPort assertion.
- A one-shot read being available.
- A method returning a generic Result envelope.
- A partial endpoint response or one-page history.
- A passing offline mapping test without exchange-contract completeness.

Capabilities must be explicit per provider instance and environment, with unsupported/unknown values failing closed. Distinguish read support from stream support, and basic order reads from canonical identity/reconciliation support.

## 6. Order provenance and persistence assessment

### 6.1 Current order identity

| Required identity | Current state | Gap |
| --- | --- | --- |
| Strategy | `OrderOwnership.strategyId` in memory | Not included in durable submission facts |
| Symbol/market | Canonical Market and durable market fields | Present |
| Provider type | `Market.venue` | Present as exchange identity only |
| Provider instance | Not represented | Missing |
| Account identity | Not represented | Missing |
| Client order ID | Canonical order, ownership and durable facts | Present |
| Exchange order ID | Canonical order/outcome facts after acknowledgement | Present when acknowledged |
| Order purpose | Durable fact field | Limited to null or `RECOVERY_SELL` in current submission workflow |

Relevant source:

- `apps/harvester/src/domain/orders/order-ownership.js` — stores `strategyId`, `positionId`, `clientOrderId` and optional `brokerOrderId`, but no provider/account.
- `apps/harvester/src/use-cases/record-order-submission-intent.js` — persists client ID, market/venue/symbol, side/type, exact decimal price/quantity and purpose; no provider instance/account or strategy ID.
- `apps/harvester/src/use-cases/record-order-submission-outcome.js` — persists acknowledgement outcome and exchange order ID; no provider/account.
- `apps/harvester/src/use-cases/record-order-cancellation-intent.js` and `record-order-cancellation-outcome.js` — persist order/market IDs and cancellation state; no provider/account.
- `apps/harvester/src/use-cases/record-execution-fill.js` — persists trade/order/client IDs, market, exact quantities, commissions and execution time; no provider/account.
- `apps/harvester/src/infrastructure/operational-state/create-file-operational-state-store.js` — strict fact field allowlists reject unrecognized provenance fields.

The current `Market.venue` identifies an exchange, not an instance/account. Strategy ownership exists in the in-memory OrderRegistry but is not fully persisted with order lifecycle facts.

### 6.2 Account-scoped identity collisions

Three existing identities are insufficient for multiple accounts sharing a process:

1. `apps/harvester/src/domain/portfolio/position.js`: `createPositionId({ marketId, strategyId })` derives identity from `[marketId, strategyId]`. Two accounts using the same market and strategy collide unless account scope is added.
2. `packages/entities/src/fills/fill.js`: Fill ID is `market.id + ":" + tradeId`. The account is not part of identity; the same native trade ID in two accounts on the same venue/market can collide.
3. `apps/harvester/src/domain/orders/order-registry.js`: broker order ID uniqueness and lookup are global within the registry. Raw native IDs must be namespaced by provider/account when multiple accounts share one registry.

The simplest safe model is account-scoped runtime state and registries, plus provider/account-aware canonical identities where objects can cross account boundaries. Avoid a single mixed registry with unqualified exchange IDs.

### 6.3 Durable storage and migration

The current Harvester order-fact path uses the append-only Operational State Store and Journal/event records, not a relational order table.

Source facts:

- `apps/harvester/src/infrastructure/operational-state/create-file-operational-state-store.js` has `FORMAT_VERSION = 1`, `DEFAULT_SCHEMA_VERSION = 1` and strict per-fact allowlists.
- Submission/cancellation/fill producers and Journal DTOs are separate contracts and must evolve together.
- Existing JSONL records are hash-chained/immutable evidence. Historical facts must not be rewritten or assigned guessed account identities.

No relational database schema migration is justified by the inspected current Harvester execution path. The required persistence work is a backward-compatible versioned fact/event extension and projection migration.

Recommended migration:

1. Define provider identity fields and validation in the new fact schema.
2. Persist provider instance, provider type, stable non-secret account ID, strategy ID and symbol with submission intent before broker I/O.
3. Carry the same immutable identity through submission outcome, cancellation intent/outcome, user-data event attribution, applied fill and recovery facts.
4. Namespace exchange-native order/fill identities by provider/account.
5. Update Journal DTOs, Operational State Store validators and recovery projections/readers to accept existing v1 facts and the new version.
6. Never infer missing legacy account identity from the current route. Require an explicit, evidence-backed operator mapping or quarantine/block ambiguous legacy orders.
7. Preserve existing hash chains, record order, exact decimal strings and historical bytes.

### 6.4 Route changes and outstanding orders

A routing configuration change must affect only new order intents. For an existing order:

- Cancellation, lookup, reconciliation, fill attribution and recovery resolve the original provider/account from persisted order provenance.
- A missing or ambiguous historical identity blocks automated mutation/recovery; it must not fall back to the current route.
- Equal raw exchange IDs from different provider/accounts are distinct.
- No order, position, reservation, fill or recovery obligation is transferred when an operator changes a route.

## 7. Binance compatibility baseline

The existing Binance implementation is the compatibility baseline. Keep these contracts unchanged during preparation and provider-registry introduction:

- Existing `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY` configuration mapping until an explicit compatibility adapter is reviewed.
- Explicit `TRADING_MODE=testnet|live`; `NODE_ENV` must never select Binance endpoints. ADR-0002 remains authoritative.
- Existing Binance WebSocket API/Streams transport and exchange endpoint selection.
- Order types, request parameters, response normalization and definite-vs-unknown error classification.
- Exact decimal strings, market filters, quantity/price precision and commissions.
- Client order IDs, exchange order IDs and `normalizeBinanceId` behavior.
- Durable submission/cancellation intent barriers and unknown-outcome handling.
- User-data session reconnect/recovery generations and state-changing-operation readiness gate.
- Existing same-process order/fill reconciliation and shutdown sequencing.
- Existing process-lock atomicity, owner verification, conservative stale-lock handling and retention on uncertain shutdown.
- Existing public exports, `CoreBroker` compatibility and Harvester BrokerPort behavior.

The first multi-provider deployments should continue to resolve the existing configuration into one Binance instance. No live/testnet environment or credential contract should change as a side effect of registry work.

## 8. Incremental implementation roadmap

Each phase is a separate reviewable issue/PR slice under #1339. Cross-domain contracts must follow the repository's cross-domain request process. Do not start a later phase by silently implementing another domain's internals.

### Phase 1 — Binance capability declarations and construction boundary

<badge>Complete — PR #1366</badge>

**Owner:** Brokers.
**Objective:** expose truthful, immutable capability declarations for the currently working Binance Spot implementation without changing exchange behavior.

**Delivered scope:** the versioned capability declaration is additive, deeply immutable, and distinguishes supported, unsupported, unknown, and environment-dependent operations. Binance declarations are source-backed; existing broker construction and consumer behavior remain the compatibility baseline.

**Acceptance for this phase:**

- Offline contract tests compare declared capabilities with actual Binance behavior.
- Unsupported and unknown operations are explicit; inherited method presence is not treated as proof of support.
- Existing Brokers tests and coverage thresholds pass on the merged implementation.
- No Harvester routing policy, additional provider, or exchange operation is introduced.

**Risk/rollback:** additive metadata only; existing consumers can ignore it. No runtime behavior changes.

### Phase 2 — Harvester named provider construction and registry

**Owner:** Harvester, with Brokers contract from Phase 1.
**Objective:** allow composition of named provider instances while preserving the legacy single-Binance runtime as the default migration path.

**Likely scope:**

- `apps/harvester/src/domain/app-config.js`
- `apps/harvester/src/bootstrap/config/resolve-harvester-options.js`
- `apps/harvester/src/bootstrap/broker/connect-broker.js`
- `apps/harvester/src/bootstrap/start-harvester.js`
- Harvester infrastructure broker adapters and focused bootstrap tests

**Requirements:**

- Add validated non-secret instance IDs, provider type, account ID and provider-specific environment configuration.
- Keep credentials in deployment environment/secrets; never include them in logs, facts or fingerprints.
- Construct providers only at the composition boundary.
- Harvester registry owns each provider's connection and cleanup.
- Existing config maps to one Binance instance with unchanged behavior.
- Do not route order execution through a new provider yet.

**Tests and acceptance:**

- Legacy config resolves to one Binance instance and preserves current startup order.
- Invalid/duplicate instance IDs, unsupported environment and missing capability fail closed.
- Partial construction/connect failure cleans up previously created instances exactly once.
- All existing Harvester startup/shutdown/Binance regression tests pass.

**Risk/rollback:** retain the existing one-Binance composition path behind the legacy resolver until registry parity is proven. Roll back registry construction without changing exchange config.

### Phase 3 — Durable provider/account provenance

**Owner:** Harvester, coordinating Entities/Journal only for required shared contracts.
**Objective:** pin every new order to its original provider/account before any exchange write.

**Likely scope:**

- `apps/harvester/src/domain/orders/order-ownership.js`
- `apps/harvester/src/domain/orders/order-registry.js`
- Submission/cancellation/fill fact producers
- Operational State Store validators and schema-version handling
- Lifecycle event DTOs, Journal event mappings and recovery projections
- Relevant Entities identity contracts only if required

**Requirements:**

- Include strategy, symbol, provider type, provider instance, stable account ID, client ID and exchange ID where known.
- Provider/account provenance is immutable after intent persistence.
- Existing v1 facts remain readable; never rewrite old JSONL/hash-chained history.
- Missing legacy account identity remains ambiguous and blocks automated order mutation/recovery.
- Preserve exact decimal strings and existing durability barriers.

**Tests and acceptance:**

- Assert intent durability includes provenance before fake broker placement is invoked.
- Reject any attempt to mutate provider/account identity later.
- Read mixed v1/new-version histories without changing old bytes/hashes.
- Recover a known order using its original provider after the route table changes.
- Quarantine/block ambiguous legacy orders.
- Verify cancellation, fills and Journal projection preserve the same identity.

**Risk/rollback:** dual-read old/new schema; new writes can be disabled while readers remain backward-compatible. Never downgrade by deleting provenance from already-written facts.

### Phase 4 — Basic in-process account isolation (recovery deferred)

**Owner:** Harvester.
**Implementation:** production bootstrap wiring is complete in merged [PR #1445](https://github.com/45s/coinzilla/pull/1445) (head `8f1f2b4888edb716b15741bec61afcb0b8d8dcdc`, merge `5eaf38d88591a055e155ab5b8df22326ff76949b`). Required exact-head CI checks passed.

**Configuration:** optional `brokers.instances` in the named `appConfig` export. Each entry has `providerInstanceId`, `providerType`, `accountId`, `environment` (`testnet` or `live`) and `credentials.apiKeyEnv`/`credentials.apiSecretEnv`. Credential values remain in environment variables. When the list is absent, the existing single-Binance environment configuration remains unchanged. The default production factory map currently registers Binance only; unsupported provider types fail clearly until a real adapter is registered.

**In scope:**

- One independent runtime per configured account: BrokerPort connection, Portfolio/Positions, OrderRegistry, account snapshot/balances, open orders, reservations, user-data readiness, market metadata, strategy workflow and shutdown lifecycle.
- Namespace native order/trade identities through account-owned runtime state; identical raw IDs from different accounts cannot collide in a shared registry because the account registries are separate.
- Acquire process locks per provider/account/environment. The request includes `providerInstanceId`; the lock fingerprint is provider type + account alias + environment so aliases for the same exchange account remain mutually exclusive. Different account/environment scopes can run concurrently.
- Keep provider connection, user-data subscription, startup and shutdown ownership independent per account. A provider startup failure is isolated: its own lock is released only after confirmed cleanup, and healthy accounts continue.
- Preserve immutable Phase 3 order provenance and direct every existing order to its originating provider/account.
- Preserve legacy single-Binance configuration and behavior.
- The first configured account owns the process-wide Telegram Command Center and optional Operational State Store callbacks. Secondary accounts do not start duplicate Telegram handlers.
- Apply the current Conservative strategy configuration independently to each account. There is no strategy/symbol route table or independent market-data route table in this phase.

**Explicitly out of scope:**

- Process-restart recovery, restoration, replay, historical reconstruction, crash recovery and unattended restart mechanisms.
- ADR-0001 / issue #654 implementation or release gates. #654 is a separate, **LOWEST PRIORITY** workstream and is not a Phase 4 dependency.
- Independent market-data routing (Phase 5), execution route-table rollout/parity (Phase 6), Bitunix execution (#1185), automatic routing, failover or cross-provider retry.
- New persistence infrastructure or database-backed trading state.

**Acceptance criteria:**

- Two accounts can coexist in one process with distinct Portfolio/Position, order registry, balances and reservations.
- Identical raw exchange order/trade IDs from different accounts cannot collide or cross-attribute fills.
- Same-account lock acquisition is exclusive; different account/environment scopes can acquire independently.
- Provider/account startup, disconnect and shutdown are independently owned. A partial account startup failure must not stop healthy account runtimes; its own lock is released only after confirmed cleanup, and cleanup failures remain visible.
- Legacy single-Binance startup remains behaviorally compatible.
- Deterministic offline tests cover same-provider accounts, provider-type factory selection, isolation, lock scope, lifecycle success/failure and cleanup. No real credentials or exchange writes are required.

**Verification:** Harvester focused tests and coverage, workspace unit/coverage, strict ESLint, syntax/policy, Markdown/anchor/link checks, dependency audit and all required exact-head GitHub Actions checks.

**Risk/rollback:** keep the legacy single-Binance path as the compatibility fallback. Do not add restart restoration or change #654's existing safety gates.

### Phase 5 — Independent market-data routing

**Status: COMPLETE.** Merged in [PR #1452](https://github.com/45s/coinzilla/pull/1452), merge commit `636cbc3c6021a59782fa2517447e373883f1af76`.

**Owner:** Harvester.

**Delivered:**

- Explicit `marketDataRouting.routes` maps each enabled symbol to one `providerInstanceId`.
- Multi-provider startup rejects missing, duplicate, unknown-provider, unconfigured-symbol and environment-incompatible routes before starting account runtimes.
- Each account runtime receives only the symbols assigned to its selected source provider; price, book, initial-price and candle subscriptions are limited to those symbols.
- Source provider identity is exposed in runtime metadata and market-subscription diagnostics.
- Legacy single-provider configuration without a route table retains its existing all-markets behavior.
- No source fallback, blending, automatic switching, recovery, replay or restoration was introduced.

**Verification:** Harvester targeted tests, full package tests, workspace test coverage, strict changed-file and workspace ESLint, JavaScript syntax, dependency audit and `packages/utils` tests passed on exact PR head `a0ccdd7b4e74005beb188fd18e90ec60d1f186c5`. The external documentation-link check was still running at merge time.

**Boundary:** Phase 5 does not introduce cross-provider execution. Phase 6 remains responsible for explicit execution routing/parity.
### Phase 6 — Binance execution routing and parity

**Owner:** Harvester.
**Objective:** route existing Conservative intents through explicit execution resolution while still selecting the same Binance instance.

**Likely scope:**

- Execution route config and resolver
- Trading Engine/place-order workflow injection
- Order provenance and account runtime context
- Startup validation and diagnostics

**Tests and acceptance:**

- Existing strategy decisions and order request payloads are byte/field equivalent where applicable.
- Every new order's provider/account provenance is durably written before broker I/O.
- All cancellation/lookup/recovery uses pinned provider identity after route changes.
- Unknown outcome never triggers another provider request.
- Existing Binance unit/regression tests and approved TESTNET-only acceptance gates remain intact.
- No live exchange operations.

**Risk/rollback:** revert route resolution for new orders to the single Binance instance. Outstanding orders continue through their stored provenance; rollback must not reassign them based on current config.

### Phase 7 — Bitunix capability completion and Harvester enablement (deferred)

**Owner:** Brokers, then Harvester for integration.
**Tracking:** [Bitunix capability and lifecycle blockers — issue #1185](https://github.com/45s/coinzilla/issues/1185).

Bitunix work remains deferred until the existing broker implementation satisfies the complete capability and lifecycle contract. Preserve the existing query methods, extend the same broker implementation with supported operations, and do not register an incomplete provider.

Resume Bitunix implementation when the Binance-first integration work provides the stable shared contracts needed by both providers. Complete the source-backed Bitunix capability gaps and prove the required account, order, fill, cancellation, private-event, environment, precision, and recovery guarantees. Then add Bitunix to Harvester through the same provider registry and explicit routing model—without provider-specific strategy logic, implicit fallback, or cross-provider retries.

Bitunix enablement requires its own reviewable implementation and acceptance work under #1185 (or explicitly linked follow-up issues). Do not create a temporary observer-only or query-only Harvester facade; the future provider must satisfy the complete shared contract before registration.

## 9. Test and verification strategy

Keep default tests offline, deterministic and credential-free. No test in this plan requires live order placement.

| Test layer | Required scenarios |
| --- | --- |
| Broker unit/contract | Actual capability vs declaration; unsupported inherited methods; malformed/partial response; exact IDs and decimals |
| Configuration | Legacy Binance config; named instances; duplicate/unknown IDs; invalid environment; missing route |
| Router | Exact route resolution; no wildcard/default; route changes affect only new intents |
| Order lifecycle | Durable intent before write; acknowledgement; timeout/unknown outcome; cancellation; lookup via original provider |
| Provenance | Immutable provider/account fields through submission, cancellation, user-data, fill and recovery facts |
| Identity/accounting | Same symbol/strategy in two accounts; same raw native IDs; isolated balances, reservations, positions and fill deduplication |
| Market data | Independent source; same symbol across providers; stream disconnect; source-aware freshness; no fallback |
| User data | Independent readiness, reconnect generation and reconciliation per account |
| Recovery/restart | Crash at every durable/exchange boundary; complete history; missing/ambiguous provenance; account-wide readiness |
| Concurrency | Same-account exclusion, different-account isolation, old/new lock coexistence, simultaneous acquisition |
| Lifecycle | Partial provider construction/connect failure, exactly-once cleanup, cleanup errors, repeated shutdown |
| Binance regression | Existing config, endpoint, request/result/error semantics, decimal precision, order IDs, user-data and shutdown invariants |

Tests for Harvester must follow the repository human-readable test standard and include detailed assertion messages. Financial quantities remain exact decimal strings. Broker order integration, if separately authorized, is TESTNET-only; this audit and its documentation PR perform no exchange operation.

## 10. Risk register

| Risk | Severity | Evidence / required control |
| --- | --- | --- |
| Existing order sent to wrong account after route change | P1 | Phase 3 provenance merged in PR #1416; preserve immutable provider/account pinning for all lifecycle calls |
| Restart loses ownership/accounting context | P1 | #654 Step 8/9 incomplete; do not enable unattended restart or multi-provider execution |
| Cross-account Position/Fill collision | P1 | Current IDs omit account; account-scope identities |
| Duplicate order after uncertain timeout | P1 | Preserve UNKNOWN outcome; never retry on another provider |
| Same-account concurrent writers during lock migration | P1 | Account-aware lock plus mixed-version transition barrier |
| False capability from CoreBroker method presence | P1 | Explicit declarations verified against implementation and tests |
| Partial startup/shutdown leaks provider resources | P2 | Registry-owned lifecycle with failure-injection tests |
| Market data silently changes venue/source | P2 | Exact explicit route and source-aware freshness |
| Binance behavior changes during refactor | P1 | Single-provider parity suite and legacy config adapter |

Severity indicates architectural/operational risk, not a reproduced incident. The cross-provider order misrouting, cross-account identity collision and duplicate-order scenarios have not been reproduced end-to-end in a multi-provider runtime because that runtime does not exist yet.

## 11. Documentation and implementation boundaries

- ADR-0003 remains the accepted target architecture. This plan is the source-verified audit, capability assessment and phased delivery plan; it does not replace the ADR.
- Issue #1339 remains the live task contract and discussion location.
- Harvester and Brokers roadmaps contain only concise ownership/status pointers to this plan and #1339.
- Do not copy this full audit into either roadmap.
- Keep #654 as the process-restart recovery release gate. Bitunix is deferred during the Binance-first sequence; its capability completion and eventual Harvester integration remain tracked in #1185.
- Keep current Conservative strategy rules in the canonical Conservative Domain Specification.
- Do not modify runtime code, schema files, credentials, environment settings, or exchange behavior as part of this audit/plan.

## 12. Phase 3 implementation closeout — COMPLETE

The durable provider/account provenance slice is complete in merged [PR #1416](https://github.com/45s/coinzilla/pull/1416). It carries immutable, validated provider-instance, provider-type and stable account identity through canonical orders/fills, durable submission and cancellation facts, user-data/REST attribution, Journal projection and Operational State recovery. The implementation preserves historical v1 facts and hash chains, rejects partial/conflicting identity, and does not infer legacy identity from current routes.

The synchronized final PR head `e58569eaebf968f5cfcfd3fbef5b6302eb0f21ee` passed all six required `develop-core` checks and was merged as `543753da5938eba2d95ad19d74c3f98a991e6461`. Phase 4 production account isolation is complete in merged PR #1445 (head `8f1f2b4888edb716b15741bec61afcb0b8d8dcdc`, merge `5eaf38d88591a055e155ab5b8df22326ff76949b`); no multi-exchange execution routing or unattended restart is enabled.

**Phase 4 production integration is complete in merged PR #1445.** This is basic in-process account isolation only. #654 restart-recovery release gates remain separate, LOWEST PRIORITY and must not be treated as Phase 4 acceptance criteria.

## 13. Audit limitations and follow-up

- Baseline is the exact `develop` merge commit recorded above; later source changes may supersede individual findings.
- Tests were inspected but not executed in this audit.
- No live or TESTNET exchange calls were made.
- No multi-provider runtime exists to reproduce route-change misrouting or cross-account collisions; these are source-derived risks.
- At this audit baseline the Harvester roadmap's #1307 lock status was stale; it has since been corrected to `[x]` (Complete — #1307 closed). The issue is closed completed and the lock source implements broker/environment scoping. No lock code change was required.
