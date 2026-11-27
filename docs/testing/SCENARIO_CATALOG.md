---
title: Repository Test Scenario Catalog
status: active
type: testing
owner: repository
created: 2026-11-23
---

# Test scenario catalog

Shared design guidance: [Domain Scenario Testing Methodology](DOMAIN_SCENARIO_TESTING.md). This catalog is the behavior-navigation and evidence index; owning domain specifications and issues remain authoritative for rules and detailed matrices.

This is the single human-readable entry point for understanding the important behavioral scenarios the Coinzilla automated tests are intended to prove.

It is organized around **what the application must do**, not around test filenames. Each scenario describes the business behavior, preconditions, inputs, expected outcomes, important subcases, implementation ownership, and the automated test cases that prove it.

> **Initial catalog:** this is the first repository-wide pass, not a claim of exhaustive coverage. Some entries are mapped to existing test cases; others are specified but still need scenario tests or a more precise test mapping. Gaps are explicit. Expand this file as the scenario inventory improves.

## How to use this catalog

1. Find the domain and scenario ID that match the behavior you care about.
2. Read the behavior, input, expected output, and subcases before opening any source or test file.
3. Use the implementation links to understand where the behavior belongs.
4. Use the named test links to jump directly to executable evidence.
5. Check the status and evidence note. A test filename, test count, or coverage percentage alone does not prove that a scenario is covered.

The catalog is a navigation and traceability layer. Domain specifications, accepted decisions, API contracts, and configuration remain authoritative for exact product behavior. The test files remain the executable verification. This catalog connects the two; it does not replace either.

## Quick scenario index

### Harvester — Dashboard operator and real-time monitoring

### OPS-001 — Live Bots snapshots remain authoritative across updates and reconnects

**Status:** TEST-MAPPED — all mapped regression cases pass on PR #1812 source head `dbdecc978eb4de5a81bbc289ba67179a55374aff`; this remains PR-branch evidence until merge to `develop`.

**Behavior:** The Dashboard Bots workspace receives a complete, versioned view of Harvester runtime status, configured markets, and Portfolio positions over the existing local WebSocket. Relevant application/runtime events produce newer complete snapshots. A reconnect always synchronizes current state without replaying missed deltas.

**Given / preconditions:**

- Harvester is running with its existing operator application facade and shared local HTTP/WebSocket listener.
- The Dashboard connects to `/api/v1/trading/events`.
- The application read models remain authoritative for runtime, market readiness/operator BUY gates, and Portfolio accounting.

**Input / example:**

- Connect a new WebSocket client and read the initial snapshot.
- Complete a market-scoped or global operator BUY pause/resume.
- Publish a relevant runtime, broker, readiness, market-rule, fill, recovery, or account-audit notification.
- Cause a newer notification while the initial snapshot reads are still pending.
- Disconnect and reconnect after one or more notifications were missed.
- Make one operator read fail or return malformed data.

**Expected output:**

- A complete `bots.snapshot` envelope includes version, monotonically increasing revision, observation time, and status/markets/portfolio resource DTOs.
- A snapshot read that becomes stale during an intervening event is discarded and reread before it is broadcast.
- A reconnect receives a newly sampled complete snapshot; clients do not depend on event replay.
- A failed resource read is explicit in `bots.snapshot.unavailable`; no failed read becomes an invented empty array.
- Successful operator BUY-control events distinguish `MARKET` plus symbol from `GLOBAL` without symbol and distinguish `PAUSE` from `RESUME`.
- The Dashboard separates WebSocket health from snapshot freshness, rejects stale revisions, retains last complete values as stale, and disables commands until a complete snapshot is fresh.
- Confirmed commands continue through the existing HTTP operator facade.

**Must not happen:**

- No second WebSocket server, broker connection, database connection, or browser exchange call.
- No REST polling or manual refresh for Bots runtime/market/Portfolio snapshots.
- No fabricated empty markets/positions on failed reads.
- No strategy safety pause represented as an operator BUY-control event.
- No command frame accepted over the WebSocket.
- No floating-point conversion or browser-side financial accounting.

**Subcases represented by the mapped tests:**

- Initial complete snapshot and reconnect full-snapshot synchronization.
- Market BUY pause event triggers a newer complete snapshot.
- Event arrives while the initial snapshot is being read.
- Market/global scope and pause/resume event payloads.
- Failed engine transition publishes no completion event.
- Malformed, unsupported, incomplete, and unavailable client messages.
- Duplicate/out-of-order revisions are ignored; disconnect marks retained data stale.
- Command confirmation and post-command stream synchronization; page destruction closes the socket.

**Implementation:**

- `apps/harvester/src/infrastructure/http/trading-history-websocket.js`
- `apps/harvester/src/application/operator/create-harvester-operator.js`
- `apps/harvester/src/application/events/event-names.js`
- `apps/dashboard/src/app/features/bots/page.ts`
- `apps/dashboard/src/app/features/bots/realtime.ts`

**Automated tests:**

- [Harvester WebSocket regressions](../../apps/harvester/src/infrastructure/http/trading-history-bots-websocket.test.js)
  - `sends a versioned complete operator snapshot to every new Bots WebSocket client`
  - `broadcasts a newer complete snapshot after a successful operator BUY-control transition`
  - `does not lose an operator transition that occurs while the initial snapshot is being read`
  - `reports failed operator reads explicitly instead of fabricating empty resources`
  - `rejects malformed successful read models as unavailable snapshots`
  - `rejects non-string recovery amounts in successful Portfolio reads`
  - `a reconnect receives a fresh full snapshot rather than relying on missed event replay`
- [Operator BUY-control event regressions](../../apps/harvester/src/application/operator/create-harvester-operator-events.test.js)
  - `publishes market-scoped pause and resume events only after successful BUY transitions`
  - `publishes global BUY-control events without inventing a market symbol`
  - `does not publish a BUY-control completion event when the engine rejects the transition`
- [Dashboard protocol validation](../../apps/dashboard/src/app/features/bots/realtime.spec.ts)
  - Rejects malformed envelopes, numeric market prices, and numeric Portfolio recovery values
- [Dashboard Bots stream behavior](../../apps/dashboard/src/app/features/bots/page.spec.ts)
  - `reconnects and accepts a new server revision epoch after Harvester restarts`
  - `confirms a global BUY pause through the existing HTTP operator command`

**Evidence note:** This scenario is mapped to the deterministic Harvester and Dashboard regression cases listed above. CI evidence is exact-head scoped; use the current PR #1812 checks and linked issue #1813 for the latest verification result rather than treating an older commit SHA as current. The optional read-only Binance TESTNET integration job is skipped by workflow configuration. The scenario remains `TEST-MAPPED` until this PR is merged to `develop`.

## Harvester — shared account, order, and portfolio behavior

- [HARV-ACC-001 — Account-wide commitments](#harv-acc-001--account-wide-commitments-are-counted-exactly-once)
- [HARV-ACC-002 — Canonical fill idempotency and conflict rejection](#harv-acc-002--canonical-fills-are-applied-once-and-conflicting-replays-are-rejected)
- [HARV-MKT-001 — Exchange trading-rule boundaries](#harv-mkt-001--exchange-trading-constraints-are-enforced-at-exact-boundaries)

### Harvester — Dashboard operator and real-time monitoring

- [OPS-001 — Live Bots snapshots remain authoritative across updates and reconnects](#ops-001--live-bots-snapshots-remain-authoritative-across-updates-and-reconnects)

### Harvester — Conservative (CG)

- [CG-001 — No new BUY until recovery cycle completion and basis reset](#cg-001--no-new-buy-is-admitted-until-recovery-cycle-completion-and-basis-reset)
- [CG-002 — Recovery completion and constrained dust](#cg-002--recovery-completion-preserves-required-inventory-and-does-not-misclassify-dust)
- [CG-003 — Pre-existing BUY lifecycle remains safe during recovery](#cg-003--pre-existing-buys-continue-their-lifecycle-without-reopening-buy-admission)

### Harvester — Recovery Seller (RS)

- [RS-001 — Legacy basis versus Spot custody](#rs-001--legacy-basis-is-not-proof-of-current-spot-custody)
- [RS-002 — Recovery BUY accounting](#rs-002--recovery-buy-accounting-uses-confirmed-net-fills-and-actual-commissions)
- [RS-003 — Additive mixed SELL quantity](#rs-003--a-mixed-recoverylegacy-sell-uses-the-additive-legacy-slice)
- [RS-004 — Independent profitability gates](#rs-004--recovery-legacy-and-combined-profitability-gates-are-independent)
- [RS-005 — One SELL lifecycle per cycle](#rs-005--a-recovery-cycle-may-submit-only-one-sell-lifecycle)
- [RS-006 — Atomic mixed SELL accounting](#rs-006--mixed-sell-accounting-commits-both-allocations-atomically)
- [RS-007 — Unknown outcome and no blind retry](#rs-007--unknown-submission-outcome-preserves-identity-and-forbids-blind-retry)
- [RS-008 — CG/RS shared account availability](#rs-008--cg-and-rs-share-account-availability-and-market-owned-volatility-without-sharing-strategy-ownership)
- [RS-009 — Investment-only STOP and continued recovery](#rs-009--stop-blocks-additional-buy-spending-only)
- [RS-010 — Deferred restart and fee valuation](#rs-010--unsupported-restart-and-fee-valuation-capabilities-remain-blocked)

### Scenario Runner application-level integration scenarios (#1836)

These APPLICATION-layer cases exercise the production Recovery Seller runtime/use-case path with deterministic simulated broker and run-local operational-state ports. They are tracked separately from the domain scenario matrix above.

| Scenario ID | Claim | Status |
| --- | --- | --- |
| `RS-RUNTIME-SELL-SUBMISSION-001` | Normal production-flow SELL submission and reservation | PARTIAL / non-executable |
| `RS-RUNTIME-SELL-REJECTION-001` | Broker rejection is surfaced and STOP is latched | PARTIAL / non-executable |
| `RS-RUNTIME-SELL-PARTIAL-CANCEL-001` | Partial terminal SELL is reconciled before STOP | PARTIAL / non-executable |
| `RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001` | Fully FILLED under-target SELL reconciles accounting, pauses the market and latches STOP | PARTIAL / non-executable |
| `RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001` | Failed account STOP persistence is surfaced and new BUY admission fails closed | PARTIAL / non-executable |
| `RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001` | STOP blocks new BUY spending while an eligible first recovery SELL remains allowed | PARTIAL / non-executable |

**Automated test:** `apps/harvester/src/infrastructure/scenario-runner/rs-scenario-adapter.test.js`.

**Coverage boundary:** these runtime integration scenarios do not count as domain scenario-suite coverage under issue #1780 and do not mark RS-009 VERIFIED. The broker and operational-state store are simulated/run-local; these tests do not prove production durability, trusted OS isolation, build attestation or live-account safety. Keep the runtime catalogue PARTIAL and non-executable until the Scenario Runner production-adapter and sandbox gates are met.

### Shared packages

- [BRK-001 — Unknown broker mutation outcome](#brk-001--unknown-broker-mutation-outcome-is-not-treated-as-failure)
- [BRK-002 — Bitunix Futures TP/SL history is bounded and identity-preserving](#brk-002--bitunix-futures-tpsl-history-is-bounded-and-identity-preserving)
- [BRK-003 — Futures position closes require reconciled private user data](#brk-003--futures-position-closes-require-reconciled-private-user-data)
- [BRK-004 — Futures REST pacing and mutation outcomes follow endpoint contracts](#brk-004--futures-rest-pacing-and-mutation-outcomes-follow-endpoint-contracts)
- [DB-001 — Database transaction atomicity](#db-001--a-failed-database-transaction-leaves-no-partial-write)
- [EVT-001 — Publish versus subscriber completion](#evt-001--publish-acceptance-is-distinct-from-subscriber-completion)
- [JRN-001 — Journal durability boundary](#jrn-001--journal-flush-is-the-durability-boundary)
- [NTF-001 — Bounded notification delivery](#ntf-001--notification-delivery-remains-bounded-and-failure-isolated)
- [ENT-001 — Exact financial values and asset identity](#ent-001--financial-values-preserve-exact-decimal-and-asset-identity)
- [UTL-001 — Exact shared decimal helpers](#utl-001--shared-decimal-helpers-produce-exact-deterministic-results)
- [IND-001 — Valid contiguous indicator history](#ind-001--indicator-calculations-reject-discontinuous-or-insufficient-candle-history)

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `SPECIFIED` | The intended behavior is documented, but no accepted test mapping is recorded yet. |
| `TEST-MAPPED` | The catalog names existing test cases that appear to exercise the behavior. This is a navigation claim, not fresh verification. |
| `VERIFIED` | The named assertions were reviewed against the intended behavior and passed on the exact cited commit/PR head. |
| `PARTIAL` | Some dimensions are proved; the missing assertions or subcases are listed. |
| `MISSING` | No accepted scenario test currently proves this behavior. |
| `BLOCKED` | The expected behavior cannot be safely specified until a decision, evidence source, or prerequisite is resolved. |
| `UNSUPPORTED` | The behavior is explicitly outside the current product contract. Do not write a test that invents support for it. |

A scenario may have more than one status across its subcases. State that distinction explicitly.

## Scenario entry format

New or materially changed behavior should receive a stable scenario ID and an entry with these fields:

- **Behavior:** the business outcome in plain language.
- **Given / preconditions:** relevant initial state and invariants.
- **Input / When:** concrete commands, fills, events, requests, or state changes.
- **Expected output / Then:** exact observable result and important state changes.
- **Must not happen:** safety and negative assertions.
- **Subcases:** boundary, invalid, duplicate, reordered, concurrent, timeout, and failure variants as relevant.
- **Implementation:** production paths that own the behavior.
- **Automated tests:** exact test file and test case title. Use `not mapped` rather than guessing.
- **Status / evidence:** current disposition and exact verification reference when one exists.

Keep each scenario focused on one business behavior. A scenario can have multiple subcases, and a single test can prove more than one assertion, but the mapping must say exactly what it proves. Prefer named test titles over a bare list of filenames.

## Repository-wide scenario map

This map is deliberately incomplete. It gives the reader a starting point across the active application and package domains. The detailed entries below are the initial cataloged scenarios; unexpanded domains remain visible as discovery work rather than being silently omitted.

| Domain | Scenario families in this initial pass | Current catalog state | Authoritative starting point |
| --- | --- | --- | --- |
| Harvester — shared account/order/portfolio | Account-wide commitments, canonical fill identity, exchange filters | TEST-MAPPED | [Harvester domain test inventory](../../apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md) |
| Harvester — Conservative (CG) | Initial BUY, no-new-BUY until cycle completion, pre-existing BUY lifecycle, partial fills, residual/dust completion | TEST-MAPPED | [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) |
| Harvester — Recovery Seller (RS) | Legacy authorization/custody, BUY accounting, mixed SELL, profitability, one-SELL lifecycle, STOP, concurrency | PARTIAL — RS-003/004/005/006/007 have limited new scenario evidence; RS-001/002/008 MISSING; RS-009 BLOCKED; RS-010 UNSUPPORTED/BLOCKED | [RS scenario issue #1780](https://github.com/45s/coinzilla/issues/1780) and [RS domain specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) |
| Brokers | Canonical request/response contracts, unknown mutation outcomes, provider capability boundaries | SPECIFIED / mapping incomplete | [Broker API contract](../../packages/brokers/BROKER_API.md) |
| Entities | Exact financial values, canonical market/order/fill identity, immutable domain contracts | SPECIFIED / mapping incomplete | [Entities roadmap](../../packages/entities/ROADMAP.md) |
| Database | CRUD conformance, transaction rollback, persistence across connections, locking | SPECIFIED / mapping incomplete | [Database CRUD decision](../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md) |
| Event Bus | Bounded fan-out, subscriber failure isolation, flush/close lifecycle | SPECIFIED / mapping incomplete | [Event Bus roadmap](../../packages/event-bus/ROADMAP.md) |
| Journal | Ordered append, flush durability, malformed records, failed sync and cleanup | SPECIFIED / mapping incomplete | [Journal roadmap](../../packages/journal/ROADMAP.md) |
| Notifiers | Bounded delivery, malformed events, transport failure, redaction and shutdown | SPECIFIED / mapping incomplete | [Notifiers roadmap](../../packages/notifiers/ROADMAP.md) |
| Utils | Exact decimal primitives, validation, structured logging and bounded async helpers | SPECIFIED / mapping incomplete | [Utils roadmap](../../packages/utils/ROADMAP.md) |
| Indicators | Candle validation, contiguous history, ATR/NATR and invalid-history behavior | SPECIFIED / mapping incomplete | [Indicators package](../../packages/indicators/README.md) |
| Dashboard / Market Simulator | UI behavior and simulator behavior | Discovery not started | [Domain ownership map](../engineering/DOMAIN_OWNERSHIP.md) |

The repository-wide method for designing domain scenarios is being established separately in [issue #1779](https://github.com/45s/coinzilla/issues/1779). Strategy-specific rules and scenario matrices belong to their owning domains and issues.

---

## Harvester — shared account, order, and portfolio behavior

### HARV-ACC-001 — Account-wide commitments are counted exactly once

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** New trading actions must be allocated against the current account snapshot and all commitments without double-counting locks already reflected in the snapshot. CG and RS share physical account availability, but each strategy keeps its own budget and ownership.

**Given / preconditions:**

- An authoritative account snapshot contains free quote and base balances.
- Some active-order commitments may already be reflected in that snapshot.
- Other commitments may have been created after the snapshot.
- Multiple strategies may reserve the same quote or base asset.

**Input / example:**

- Snapshot free quote: 100 USDT.
- An existing BUY lock of 20 USDT is already reflected in that free-balance snapshot.
- A new BUY commitment of 10 USDT is created after the snapshot.
- The allocator evaluates another BUY.

**Expected output:**

- The already-reflected 20 USDT is not subtracted a second time.
- The new 10 USDT commitment is subtracted.
- The remaining quote availability for the next allocation is 90 USDT.
- Shared base reservations similarly prevent aggregate SELL allocation from exceeding account-available inventory.
- Strategy budgets remain separate; unused RS budget is not borrowed by CG and vice versa.

**Must not happen:**

- Do not count the same Portfolio inventory or exchange lock twice.
- Do not let aggregate SELL commitments exceed shared base inventory.
- Do not let one strategy's allocation bypass another strategy's account-wide reservation.

**Subcases represented by the mapped tests:**

- BUY and SELL commitments already reflected in account snapshots.
- Commitments created after snapshots.
- Partial BUY fill credit and partial SELL lock release.
- Shared quote/base reservations across pairs.
- Combined CG + RS SELL reservations and verified Spot custody.

**Implementation:**

- `apps/harvester/src/domain/orders/allocate-order-commitments.js`
- Account snapshot and Portfolio allocation collaborators under `apps/harvester/src/domain/`

**Automated tests:**

- [`allocate-order-commitments.test.js`](../../apps/harvester/src/domain/orders/allocate-order-commitments.test.js)
  - `does not subtract a BUY commitment already reflected in the exchange free-balance snapshot`
  - `subtracts only a new BUY commitment created after the account snapshot`
  - `does not count Portfolio base inventory twice when the exchange snapshot already reflects it`
  - `rejects a SELL that exceeds shared inventory after combined CG and RS reservations`
  - `rejects a mixed SELL when verified free Spot custody is smaller than tracked recovery plus legacy inventory`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-ACC-002 — Canonical fills are applied once and conflicting replays are rejected

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** The same canonical execution may arrive through more than one delivery path, such as REST history and a user-data stream. It must affect accounting once. Reusing the same identity with changed execution facts must be rejected without partially mutating the accepted Portfolio.

**Given / preconditions:**

- A Position is owned by a specific strategy and market.
- A canonical Fill has a stable market-scoped identity and exact execution facts.

**Input / example:**

- Apply a DOGEUSDT BUY Fill with a canonical ID, quantity, price, and commission.
- Deliver the identical Fill again through another event path.
- Separately, attempt to reuse the same Fill ID with a changed quantity or commission.

**Expected output:**

- Identical replay is an immutable no-op.
- A conflicting replay is rejected.
- Position quantity, cost basis, cash flow, and applied-fill identity remain unchanged after the rejected conflict.
- Same raw trade IDs in different markets remain independent when their canonical market-scoped identities differ.
- A fill cannot be applied to a Position owned by another strategy.

**Must not happen:**

- No duplicate accounting.
- No partial Portfolio mutation on conflict.
- No ambiguous strategy or market attribution.

**Subcases represented by the mapped tests:**

- Same fill delivered through history and stream in either order.
- Same ID with changed execution facts.
- Same ID with changed commission amount.
- Same trade ID reused across markets.
- Multiple strategy-owned Positions for one market.
- Rejected cross-Position allocation.

**Implementation:**

- `apps/harvester/src/domain/portfolio/portfolio.js`
- `apps/harvester/src/domain/portfolio/position.js`
- `apps/harvester/src/domain/fills/`

**Automated tests:**

- [`portfolio.test.js`](../../apps/harvester/src/domain/portfolio/portfolio.test.js)
  - `deduplicates a fill by canonical market-scoped identity`
  - `keeps exact fill accounting isolated when different markets reuse the same trade ID`
  - `rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting`
  - `rejects a reused Fill ID when commission amount differs without mutating Portfolio`
  - `deduplicates equivalent history-response and user-data stream fills in either delivery order`
  - `keeps independent strategy-owned Positions for the same market`
  - `rejects applying one canonical fill to a different strategy Position`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-MKT-001 — Exchange trading constraints are enforced at exact boundaries

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** An order is eligible only when the market metadata and configured order type are valid and the exact price, quantity, and notional satisfy the exchange's declared constraints.

**Given / preconditions:**

- A canonical market and validated trading-rule metadata are available.
- The strategy configuration requests an order type supported by the market.

**Input / example:**

- Submit a candidate quantity exactly at the configured minimum notional.
- Compare it with a candidate one meaningful increment below that minimum.
- Repeat for quantity and price boundaries where the exchange declares them.

**Expected output:**

- Exact inclusive boundaries are accepted where the rule is inclusive.
- Values outside the permitted range are rejected.
- Missing or malformed required rule metadata fails closed.
- The selected order type respects maker-commission configuration and exchange support.

**Must not happen:**

- Do not treat missing constraints as an empty rule set.
- Do not silently round or alter an invalid business intent into a different order.
- Do not submit an unsupported order type.

**Subcases represented by the mapped tests:**

- Missing increments and unsupported order type.
- Exact MIN/MAX price and quantity boundaries.
- MIN_NOTIONAL equality and immediately-below behavior.
- Malformed or incomplete metadata.
- LIMIT versus LIMIT_MAKER selection.

**Implementation:**

- `apps/harvester/src/domain/market/validate-market-trading-readiness.js`
- `apps/harvester/src/domain/orders/validate-order-against-trading-rules.js`

**Automated tests:**

- [`validate-market-trading-readiness.test.js`](../../apps/harvester/src/domain/market/validate-market-trading-readiness.test.js)
  - `fails closed when a required trading rule is missing or unsupported`
  - `enforces exchange quantity limits at exact boundaries and immediately outside them`
  - `enforces MIN_NOTIONAL at exact equality and immediately below the configured investment`
  - `rejects malformed unvalidated constraint metadata instead of treating it as an empty list`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

---

## Harvester — Conservative strategy (CG)

The [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) remains the authority for Conservative business rules. The following entries are an initial readable map of important existing behaviors, not a declaration that the full Conservative scenario matrix is complete.

### CG-001 — No new BUY is admitted until recovery cycle completion and basis reset

**Status:** TEST-MAPPED — strategy, final submission-gate, engine, and replay cases are mapped; exact-head verification is pending.

**Scenario registry:** `CON-BUY-001`.

**Behavior:** Conservative must recover from actual filled inventory without opening another BUY cycle prematurely. A recovery SELL acknowledgement, terminal SELL status by itself, or proceeds reaching the accumulated BUY cost does not complete the cycle. New BUY admission opens only after the full recovery cycle is reconciled, retained inventory is allocated, and the Position recovery basis and RecoveryLedger cycle totals are reset.

**Given / preconditions:**

- A valid Conservative market, strategy configuration, and current exchange trading constraints.
- An active strategy-owned Position and its RecoveryLedger cycle accounting.
- A recovery SELL that may be PENDING, UNKNOWN, OPEN, or PARTIALLY_FILLED.
- A canonical order registry that may contain an owned recovery SELL reservation.

**Input / example:**

- Apply an actual BUY fill and evaluate recovery SELL planning.
- Deliver market-price events while the recovery SELL acknowledgement is delayed, unknown, open, or partially filled.
- Reconcile terminal SELL status and complete distinct fill/commission history.
- Evaluate recovery completion, retained inventory allocation, and Position/RecoveryLedger basis reset.
- Evaluate the next market-price event after completion.

**Expected output:**

- Actual filled inventory and commissions drive recovery SELL planning.
- Strategy policy and the final application submission gate both block every new Conservative BUY while Position active quantity is positive, Position spent basis is positive, RecoveryLedger cycle totals remain non-zero, or an owned recovery SELL remains an active reservation.
- PENDING, UNKNOWN, OPEN, and PARTIALLY_FILLED recovery SELL states do not release BUY admission.
- A successful SELL acknowledgement, terminal SELL acknowledgement alone, or realized proceeds reaching the cost basis does not release BUY admission.
- Only fully reconciled cycle completion, retained inventory allocation, and Position/RecoveryLedger basis reset permit the next BUY.
- Recovery SELL remains eligible while the BUY gate is closed; Recovery Seller orders are not incorrectly subjected to the Conservative CG gate.

**Must not happen:**

- Do not submit a new or replacement BUY while any recovery obligation or cycle basis remains.
- Do not treat a SELL acknowledgement, terminal status without complete fill reconciliation, or recovered cost basis as cycle completion.
- Do not reopen BUY admission before the retained allocation and recovery-basis reset are durably complete.
- Do not block the required recovery SELL merely because new BUY admission is closed.

**Subcases represented by the mapped tests:**

- Initial BUY tick rounding and duplicate suppression.
- Active Position with no active recovery SELL: recovery SELL only, no next BUY.
- PENDING/delayed and UNKNOWN recovery SELL acknowledgement.
- OPEN and PARTIALLY_FILLED recovery SELL reservations.
- SELL proceeds equal to or exceed BUY cost before completion.
- Residual sell-through and exact dust classification.
- Position/RecoveryLedger reset and next-BUY admission after completion.
- Recovery Seller strategy remains outside the CG-specific BUY gate.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/strategy.js`
- `apps/harvester/src/use-cases/create-submission-gate.js`
- `apps/harvester/src/use-cases/conservative-trading-engine.js`

**Automated tests:**

- [`strategy.test.js`](../../apps/harvester/src/domain/strategies/conservative/strategy.test.js)
  - `plans only a recovery SELL while a filled Position remains active`
  - `blocks the next BUY while an acknowledged recovery SELL remains open`
  - `blocks the next BUY while the recovery SELL acknowledgement is pending or unknown`
  - `keeps recovery SELL eligible while investment limits cannot reopen BUY during an active cycle`
  - `fails closed when an active Position is missing its RecoveryLedger`
  - `fails closed when Position.spent and RecoveryLedger buyCost diverge`
  - `fails closed when active recovery SELL commitments exceed sellable Position inventory`
  - `rejects a negative remaining quantity on an active recovery SELL`
- [`create-submission-gate.test.js`](../../apps/harvester/src/use-cases/create-submission-gate.test.js)
  - `blocks a Conservative BUY while the Position still has active recovery inventory`
  - `blocks a Conservative BUY after SELL proceeds recover cost but before cycle completion resets the Position`
  - `allows a Conservative BUY only after recovery basis and cycle totals have been reset`
  - `blocks a Conservative BUY while an owned recovery SELL remains active after accounting totals reset`
  - `does not apply the Conservative recovery BUY gate to Recovery Seller orders`
  - `blocks a Conservative BUY while RecoveryLedger buyCost remains non-zero after Position reset`
  - `fails closed when Conservative recovery admission dependencies are unavailable`
  - `fails closed when Conservative recovery admission accounting contains an invalid decimal`
- [`conservative-trading-engine.test.js`](../../apps/harvester/src/use-cases/conservative-trading-engine.test.js)
  - `does not submit a next standing BUY while the Conservative recovery cycle remains active`
  - `a fully filled BUY keeps subsequent evaluations in recovery-only mode while its SELL remains open`
- [`doge-zro-conservative-replay.test.js`](../../apps/harvester/test/replays/doge-zro-conservative-replay.test.js)
  - `submits only the recovery SELL while the recovery cycle remains active`
  - `accounts streamed partial BUY executions before recovery SELL planning`
  - `completes the recovery cycle only after the SELL fill report is received and reconciled`
- [`2026-11-22-conservative-recovery-runtime-replay.test.js`](../../apps/harvester/test/replays/2026-11-22-conservative-recovery-runtime-replay.test.js)
  - `blocks subsequent archived ZROUSDT BUYs while the first recovery cycle is active`
  - `blocks subsequent archived DOGEUSDT BUYs while the first recovery cycle is active`
  - `blocks subsequent archived ADAUSDT BUYs while the first recovery cycle is active`

**Evidence note:** This mapping records the intended contract and named regression cases. It remains TEST-MAPPED, not VERIFIED, until the exact current PR head passes the focused Harvester suite and required CI checks.

### CG-002 — Recovery completion preserves required inventory and does not misclassify dust

**Status:** TEST-MAPPED — named existing cases identified; scenario-matrix completeness is not claimed.

**Behavior:** A recovery cycle completes only when the actual remaining inventory satisfies the configured keep-quantity and exchange constraints. Partial or canceled SELLs do not count as completed recovery. Residual inventory that cannot currently be sold must be classified rather than submitted as an invalid order.

**Given / preconditions:**

- A Position with accumulated BUY cost basis and actual SELL proceeds.
- A configured keep quantity and current exchange filters.

**Input / example:**

- Apply one or more partial SELL fills.
- Evaluate completion with remaining inventory above, equal to, or below keep quantity.
- Evaluate residual quantities below the quantity step or minimum notional.

**Expected output:**

- Only a profitable, fully eligible recovery SELL may complete the cycle.
- Partial/canceled SELLs do not allocate retained free inventory as if the cycle completed.
- Residuals above the keep quantity remain sell-through work.
- Quantity-step and MIN_NOTIONAL dust are classified and do not become invalid SELL submissions.
- A later BUY can make a previously constrained residual sellable without losing accumulated basis or proceeds.

**Must not happen:**

- Do not complete a cycle while a partial or canceled SELL remains unresolved.
- Do not release inventory that should remain active.
- Do not discard prior recovery cost basis or net SELL proceeds when residual inventory is carried forward.

**Subcases represented by the mapped tests:**

- Exact keep-quantity allocation after profitable recovery.
- Partial/canceled SELL completion rejection.
- Actual SELL missing the configured profit floor.
- Residual above keep quantity.
- Zero keep quantity.
- Quantity-step and MIN_NOTIONAL dust.
- Later BUY with previously constrained residual inventory.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/recovery-completion.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-ledger.js`

**Automated tests:**

- [`recovery-completion.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-completion.test.js)
  - `allocates exactly keepQuantity after a profitable recovery SELL`
  - `does not allocate free coins for a partial or cancelled recovery SELL`
  - `pauses when a fully filled recovery SELL misses minProfit`
  - `defers completion while any active residual remains above keepQuantity`
  - `fails closed when exchange-constrained dust evidence contains non-positive filter values or negative evaluations`
- [`recovery-sell-plan.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.test.js)
  - `plans a recovery SELL that retains keepQuantity and covers cost plus minProfit`
  - `continues cumulative recovery after confirmed partial SELL proceeds`
  - `reserves base quantity for the configured fee ceiling`
  - `rounds the minimum SELL price up only when the exact fee-adjusted price exceeds a tick`

- [`strategy.test.js`](../../apps/harvester/src/domain/strategies/conservative/strategy.test.js)
  - `continues selling residual inventory after cumulative recovery profit is already secured`
  - `does not create a duplicate residual SELL while one is active`
  - `sells the fee-reserved 1.7 DOGE quantity from the incident 2.8 DOGE residual under explicit sellable test filters`
  - `sells the fee-reserved 0.004 ZRO quantity from the incident 0.015 ZRO residual under explicit sellable test filters`
  - `classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL`
  - `classifies residual quantity below MIN_NOTIONAL instead of submitting an invalid SELL`
  - `sells the residual exactly at the MIN_QUANTITY boundary`
  - `sells the residual exactly at the QUANTITY_INCREMENT boundary`
  - `sells the residual exactly at the MIN_NOTIONAL boundary`
- [`create-latest-transition-evaluator.test.js`](../../apps/harvester/src/use-cases/create-latest-transition-evaluator.test.js)
  - `submits the residual SELL on reevaluation after the recovery SELL fill without completing or pausing the cycle`
  - `fails closed before completion or residual SELL submission when recovery evidence cannot be durably flushed`
  - `preserves unknown, rejected, and blocked residual SELL outcomes without completing recovery or placing a BUY`
- [`conservative-trading-engine.test.js`](../../apps/harvester/src/use-cases/conservative-trading-engine.test.js)
  - `reconciles multiple actual SELL fills before completing recovery`
  - `keeps the recovery basis open and classifies exchange-constrained residual after a profitable SELL`
  - `reconciles recovered orders without canceling or replacing any exchange order` (also reevaluates after restart reconciliation and asserts no duplicate recovery SELL)
  - `does not cancel a recovery SELL when cancellation intent publication is still pending`
  - `durably journals recovery SELL cancellation intent before broker cancellation` (proves optional EventBus flush failure does not block the write-only Journal barrier)

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### CG-003 — Pre-existing BUYs continue their lifecycle without reopening BUY admission

**Status:** TEST-MAPPED — application-path cases are mapped; exact-head verification is pending.

**Scenario registry:** `CON-RECOVERY-001`.

**Behavior:** A BUY acknowledged before a Conservative recovery cycle became active remains an existing order lifecycle, not a new BUY intent. Its presence must not suppress recovery SELL evaluation. If that BUY fills while a recovery SELL is active, Harvester must reconcile the fill exactly once and update or replace only the recovery SELL coverage from the latest canonical Position and RecoveryLedger state. New/replacement BUY admission remains closed until full cycle completion.

**Given / preconditions:**

- A canonical active BUY was acknowledged before the strategy Position became active.
- A recovery Position and its cost basis are active.
- A recovery SELL may be PENDING, OPEN, PARTIALLY_FILLED, or UNKNOWN.
- The existing BUY and recovery SELL are owned by the same Conservative strategy/market.

**Input / example:**

- Deliver a market-price event while the pre-existing BUY and active Position coexist.
- Deliver partial/final BUY fills, including late fills while recovery SELL acknowledgement or cancellation is in flight.
- Reconcile recovery SELL cancellation, terminal state, and all fills, including fills racing with cancellation.
- Deliver duplicate and out-of-order execution reports and evaluate shutdown reconciliation.

**Expected output:**

- Skip only trailing-BUY replacement while an active Position exists; continue normal Conservative evaluation so recovery SELL coverage is established or maintained.
- Preserve the pre-existing BUY's canonical identity and ownership until its actual terminal lifecycle is reconciled.
- Apply each late BUY/SELL fill and commission exactly once.
- Cancel/reconcile only the identified owned recovery SELL when coverage changes; replace it from the latest reconciled inventory.
- Keep BUY admission closed throughout the unresolved recovery cycle.
- Fail closed when cancellation, acknowledgement, fill history, or replacement outcome is unknown or inconsistent.

**Must not happen:**

- Do not cancel a pre-existing BUY merely because a recovery Position became active.
- Do not let an active BUY suppress recovery SELL planning.
- Do not submit a second/replacement BUY during recovery.
- Do not duplicate or over-reserve recovery SELL quantity.
- Do not replace a SELL from stale or incomplete fill/accounting evidence.

**Subcases represented by the mapped tests:**

- Pre-existing BUY with active Position and no recovery SELL yet.
- Pre-existing BUY late partial/final fill while recovery SELL is acknowledged or pending acknowledgement.
- Multiple BUY fills racing with shutdown cancellation.
- SELL fill racing with cancellation and duplicate late reports.
- Durable cancellation-intent failure and unresolved cancellation/replacement submission.
- Existing recovery SELL reservation remains intact when no safe replacement is available.
- Concurrent/re-entrant market evaluations while the existing BUY lifecycle is unresolved.

**Implementation:**

- `apps/harvester/src/use-cases/conservative-trading-engine.js`
- `apps/harvester/src/use-cases/create-submission-gate.js`
- `apps/harvester/src/use-cases/create-user-data-event-transition.js`
- `apps/harvester/src/domain/strategies/conservative/strategy.js`

**Automated tests:**

- [`conservative-trading-engine.test.js`](../../apps/harvester/src/use-cases/conservative-trading-engine.test.js)
  - `keeps a pre-existing BUY untouched while planning the recovery SELL for its active Position`
  - `reconciles multiple BUY fills racing shutdown cancellation and replaces only the owned recovery SELL`
  - `fails closed when shutdown recovery SELL cancellation or replacement submission is unresolved`
  - `does not cancel a recovery SELL when its durable cancellation intent flush fails`
  - `reconciles the recovery SELL after any partial BUY fill without completing the BUY lifecycle`
- [`conservative-trading-engine.test.js`](../../apps/harvester/test/use-cases/conservative-trading-engine.test.js)
  - `a pre-existing partially filled BUY is reconciled during recovery SELL acknowledgement and replaces SELL from latest fills`

**Evidence note:** The existing-order path is a separate application lifecycle guarantee from the no-new-BUY policy. It remains TEST-MAPPED until the exact current PR head passes the named regression cases and required CI checks.

---

## Harvester — Recovery Seller (RS)

- [RS-001 — Legacy basis versus Spot custody](#rs-001--legacy-basis-is-not-proof-of-current-spot-custody)
- [RS-002 — Recovery BUY accounting](#rs-002--recovery-buy-accounting-uses-confirmed-net-fills-and-actual-commissions)
- [RS-003 — Additive mixed SELL quantity](#rs-003--a-mixed-recoverylegacy-sell-uses-the-additive-legacy-slice)
- [RS-004 — Independent profitability gates](#rs-004--recovery-legacy-and-combined-profitability-gates-are-independent)
- [RS-005 — One SELL lifecycle per cycle](#rs-005--a-recovery-cycle-may-submit-only-one-sell-lifecycle)
- [RS-006 — Atomic mixed SELL accounting](#rs-006--mixed-sell-accounting-commits-both-allocations-atomically)
- [RS-007 — Unknown outcome and no blind retry](#rs-007--unknown-submission-outcome-preserves-identity-and-forbids-blind-retry)
- [RS-008 — CG/RS shared account availability](#rs-008--cg-and-rs-share-account-availability-and-market-owned-volatility-without-sharing-strategy-ownership)
- [RS-009 — Investment-only STOP and continued recovery](#rs-009--stop-blocks-additional-buy-spending-only)
- [RS-010 — Deferred restart and fee valuation](#rs-010--unsupported-restart-and-fee-valuation-capabilities-remain-blocked)

### Shared packages

- [BRK-001 — Unknown broker mutation outcome](#brk-001--unknown-broker-mutation-outcome-is-not-treated-as-failure)
- [DB-001 — Database transaction atomicity](#db-001--a-failed-database-transaction-leaves-no-partial-write)
- [EVT-001 — Publish versus subscriber completion](#evt-001--publish-acceptance-is-distinct-from-subscriber-completion)
- [JRN-001 — Journal durability boundary](#jrn-001--journal-flush-is-the-durability-boundary)
- [NTF-001 — Bounded notification delivery](#ntf-001--notification-delivery-remains-bounded-and-failure-isolated)
- [ENT-001 — Exact financial values and asset identity](#ent-001--financial-values-preserve-exact-decimal-and-asset-identity)
- [UTL-001 — Exact shared decimal helpers](#utl-001--shared-decimal-helpers-produce-exact-deterministic-results)
- [IND-001 — Valid contiguous indicator history](#ind-001--indicator-calculations-reject-discontinuous-or-insufficient-candle-history)

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `SPECIFIED` | The intended behavior is documented, but no accepted test mapping is recorded yet. |
| `TEST-MAPPED` | The catalog names existing test cases that appear to exercise the behavior. This is a navigation claim, not fresh verification. |
| `VERIFIED` | The named assertions were reviewed against the intended behavior and passed on the exact cited commit/PR head. |
| `PARTIAL` | Some dimensions are proved; the missing assertions or subcases are listed. |
| `MISSING` | No accepted scenario test currently proves this behavior. |
| `BLOCKED` | The expected behavior cannot be safely specified until a decision, evidence source, or prerequisite is resolved. |
| `UNSUPPORTED` | The behavior is explicitly outside the current product contract. Do not write a test that invents support for it. |

A scenario may have more than one status across its subcases. State that distinction explicitly.

## Scenario entry format

New or materially changed behavior should receive a stable scenario ID and an entry with these fields:

- **Behavior:** the business outcome in plain language.
- **Given / preconditions:** relevant initial state and invariants.
- **Input / When:** concrete commands, fills, events, requests, or state changes.
- **Expected output / Then:** exact observable result and important state changes.
- **Must not happen:** safety and negative assertions.
- **Subcases:** boundary, invalid, duplicate, reordered, concurrent, timeout, and failure variants as relevant.
- **Implementation:** production paths that own the behavior.
- **Automated tests:** exact test file and test case title. Use `not mapped` rather than guessing.
- **Status / evidence:** current disposition and exact verification reference when one exists.

Keep each scenario focused on one business behavior. A scenario can have multiple subcases, and a single test can prove more than one assertion, but the mapping must say exactly what it proves. Prefer named test titles over a bare list of filenames.

## Repository-wide scenario map

This map is deliberately incomplete. It gives the reader a starting point across the active application and package domains. The detailed entries below are the initial cataloged scenarios; unexpanded domains remain visible as discovery work rather than being silently omitted.

| Domain | Scenario families in this initial pass | Current catalog state | Authoritative starting point |
| --- | --- | --- | --- |
| Harvester — shared account/order/portfolio | Account-wide commitments, canonical fill identity, exchange filters | TEST-MAPPED | [Harvester domain test inventory](../../apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md) |
| Harvester — Conservative (CG) | Initial BUY, recovery SELL, next-BUY gating, partial fills, residual/dust completion | TEST-MAPPED | [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) |
| Harvester — Recovery Seller (RS) | Legacy authorization/custody, BUY accounting, mixed SELL, profitability, one-SELL lifecycle, STOP, concurrency | PARTIAL — RS-001/002 have registered evidence with explicit blockers; RS-003/004/005/006/007 remain partial; RS-008 PARTIAL (RS-008-017-A/B/C/D/E and RS-008-018-A/B/C/D/E/F TEST-MAPPED; runtime BUY serialization and runtime SELL rejection against seeded reservations mapped; concurrent newly-created SELL/base intents and cross-asset atomicity remain missing); RS-009 SPECIFIED with implementation evidence MISSING; RS-010 UNSUPPORTED/BLOCKED | [RS scenario issue #1780](https://github.com/45s/coinzilla/issues/1780), [RS playbook](../../apps/harvester/docs/domain/recovery-seller-scenario-testing.md) and [RS domain specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) |
| Brokers | Canonical request/response contracts, unknown mutation outcomes, provider capability boundaries | SPECIFIED / mapping incomplete | [Broker API contract](../../packages/brokers/BROKER_API.md) |
| Entities | Exact financial values, canonical market/order/fill identity, immutable domain contracts | SPECIFIED / mapping incomplete | [Entities roadmap](../../packages/entities/ROADMAP.md) |
| Database | CRUD conformance, transaction rollback, persistence across connections, locking | SPECIFIED / mapping incomplete | [Database CRUD decision](../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md) |
| Event Bus | Bounded fan-out, subscriber failure isolation, flush/close lifecycle | SPECIFIED / mapping incomplete | [Event Bus roadmap](../../packages/event-bus/ROADMAP.md) |
| Journal | Ordered append, flush durability, malformed records, failed sync and cleanup | SPECIFIED / mapping incomplete | [Journal roadmap](../../packages/journal/ROADMAP.md) |
| Notifiers | Bounded delivery, malformed events, transport failure, redaction and shutdown | SPECIFIED / mapping incomplete | [Notifiers roadmap](../../packages/notifiers/ROADMAP.md) |
| Utils | Exact decimal primitives, validation, structured logging and bounded async helpers | SPECIFIED / mapping incomplete | [Utils roadmap](../../packages/utils/ROADMAP.md) |
| Indicators | Candle validation, contiguous history, ATR/NATR and invalid-history behavior | SPECIFIED / mapping incomplete | [Indicators package](../../packages/indicators/README.md) |
| Dashboard / Market Simulator | UI behavior and simulator behavior | Discovery not started | [Domain ownership map](../engineering/DOMAIN_OWNERSHIP.md) |

The repository-wide method for designing domain scenarios is being established separately in [issue #1779](https://github.com/45s/coinzilla/issues/1779). Strategy-specific rules and scenario matrices belong to their owning domains and issues.

---

## Harvester — shared account, order, and portfolio behavior

### HARV-ACC-001 — Account-wide commitments are counted exactly once

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** New trading actions must be allocated against the current account snapshot and all commitments without double-counting locks already reflected in the snapshot. CG and RS share physical account availability, but each strategy keeps its own budget and ownership.

**Given / preconditions:**

- An authoritative account snapshot contains free quote and base balances.
- Some active-order commitments may already be reflected in that snapshot.
- Other commitments may have been created after the snapshot.
- Multiple strategies may reserve the same quote or base asset.

**Input / example:**

- Snapshot free quote: 100 USDT.
- An existing BUY lock of 20 USDT is already reflected in that free-balance snapshot.
- A new BUY commitment of 10 USDT is created after the snapshot.
- The allocator evaluates another BUY.

**Expected output:**

- The already-reflected 20 USDT is not subtracted a second time.
- The new 10 USDT commitment is subtracted.
- The remaining quote availability for the next allocation is 90 USDT.
- Shared base reservations similarly prevent aggregate SELL allocation from exceeding account-available inventory.
- Strategy budgets remain separate; unused RS budget is not borrowed by CG and vice versa.

**Must not happen:**

- Do not count the same Portfolio inventory or exchange lock twice.
- Do not let aggregate SELL commitments exceed shared base inventory.
- Do not let one strategy's allocation bypass another strategy's account-wide reservation.

**Subcases represented by the mapped tests:**

- BUY and SELL commitments already reflected in account snapshots.
- Commitments created after snapshots.
- Partial BUY fill credit and partial SELL lock release.
- Shared quote/base reservations across pairs.
- Combined CG + RS SELL reservations and verified Spot custody.

**Implementation:**

- `apps/harvester/src/domain/orders/allocate-order-commitments.js`
- Account snapshot and Portfolio allocation collaborators under `apps/harvester/src/domain/`

**Automated tests:**

- [`allocate-order-commitments.test.js`](../../apps/harvester/src/domain/orders/allocate-order-commitments.test.js)
  - `does not subtract a BUY commitment already reflected in the exchange free-balance snapshot`
  - `subtracts only a new BUY commitment created after the account snapshot`
  - `does not count Portfolio base inventory twice when the exchange snapshot already reflects it`
  - `rejects a SELL that exceeds shared inventory after combined CG and RS reservations`
  - `rejects a mixed SELL when verified free Spot custody is smaller than tracked recovery plus legacy inventory`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-ACC-002 — Canonical fills are applied once and conflicting replays are rejected

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** The same canonical execution may arrive through more than one delivery path, such as REST history and a user-data stream. It must affect accounting once. Reusing the same identity with changed execution facts must be rejected without partially mutating the accepted Portfolio.

**Given / preconditions:**

- A Position is owned by a specific strategy and market.
- A canonical Fill has a stable market-scoped identity and exact execution facts.

**Input / example:**

- Apply a DOGEUSDT BUY Fill with a canonical ID, quantity, price, and commission.
- Deliver the identical Fill again through another event path.
- Separately, attempt to reuse the same Fill ID with a changed quantity or commission.

**Expected output:**

- Identical replay is an immutable no-op.
- A conflicting replay is rejected.
- Position quantity, cost basis, cash flow, and applied-fill identity remain unchanged after the rejected conflict.
- Same raw trade IDs in different markets remain independent when their canonical market-scoped identities differ.
- A fill cannot be applied to a Position owned by another strategy.

**Must not happen:**

- No duplicate accounting.
- No partial Portfolio mutation on conflict.
- No ambiguous strategy or market attribution.

**Subcases represented by the mapped tests:**

- Same fill delivered through history and stream in either order.
- Same ID with changed execution facts.
- Same ID with changed commission amount.
- Same trade ID reused across markets.
- Multiple strategy-owned Positions for one market.
- Rejected cross-Position allocation.

**Implementation:**

- `apps/harvester/src/domain/portfolio/portfolio.js`
- `apps/harvester/src/domain/portfolio/position.js`
- `apps/harvester/src/domain/fills/`

**Automated tests:**

- [`portfolio.test.js`](../../apps/harvester/src/domain/portfolio/portfolio.test.js)
  - `deduplicates a fill by canonical market-scoped identity`
  - `keeps exact fill accounting isolated when different markets reuse the same trade ID`
  - `rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting`
  - `rejects a reused Fill ID when commission amount differs without mutating Portfolio`
  - `deduplicates equivalent history-response and user-data stream fills in either delivery order`
  - `keeps independent strategy-owned Positions for the same market`
  - `rejects applying one canonical fill to a different strategy Position`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-MKT-001 — Exchange trading constraints are enforced at exact boundaries

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** An order is eligible only when the market metadata and configured order type are valid and the exact price, quantity, and notional satisfy the exchange's declared constraints.

**Given / preconditions:**

- A canonical market and validated trading-rule metadata are available.
- The strategy configuration requests an order type supported by the market.

**Input / example:**

- Submit a candidate quantity exactly at the configured minimum notional.
- Compare it with a candidate one meaningful increment below that minimum.
- Repeat for quantity and price boundaries where the exchange declares them.

**Expected output:**

- Exact inclusive boundaries are accepted where the rule is inclusive.
- Values outside the permitted range are rejected.
- Missing or malformed required rule metadata fails closed.
- The selected order type respects maker-commission configuration and exchange support.

**Must not happen:**

- Do not treat missing constraints as an empty rule set.
- Do not silently round or alter an invalid business intent into a different order.
- Do not submit an unsupported order type.

**Subcases represented by the mapped tests:**

- Missing increments and unsupported order type.
- Exact MIN/MAX price and quantity boundaries.
- MIN_NOTIONAL equality and immediately-below behavior.
- Malformed or incomplete metadata.
- LIMIT versus LIMIT_MAKER selection.

**Implementation:**

- `apps/harvester/src/domain/market/validate-market-trading-readiness.js`
- `apps/harvester/src/domain/orders/validate-order-against-trading-rules.js`

**Automated tests:**

- [`validate-market-trading-readiness.test.js`](../../apps/harvester/src/domain/market/validate-market-trading-readiness.test.js)
  - `fails closed when a required trading rule is missing or unsupported`
  - `enforces exchange quantity limits at exact boundaries and immediately outside them`
  - `enforces MIN_NOTIONAL at exact equality and immediately below the configured investment`
  - `rejects malformed unvalidated constraint metadata instead of treating it as an empty list`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

---

## Harvester — Conservative strategy (CG)

The [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) remains the authority for Conservative business rules. The following entries are an initial readable map of important existing behaviors, not a declaration that the full Conservative scenario matrix is complete.

### CG-001 — A confirmed BUY creates recovery work, but the next BUY waits for SELL acknowledgement

**Status:** TEST-MAPPED — named existing cases identified; full scenario-matrix completeness is not claimed.

**Behavior:** Conservative must base recovery work on actual filled inventory. It can plan a recovery SELL and the next standing BUY from the actual BUY fill, but it must not advance the next BUY while the recovery SELL is pending or unknown.

**Given / preconditions:**

- A valid market, strategy configuration, and exchange trading constraints.
- No duplicate active BUY for the same strategy/market.
- A confirmed BUY fill establishes actual recovery inventory.

**Input / example:**

- A price event causes an initial BUY to be planned.
- The BUY receives an actual fill.
- The strategy evaluates recovery SELL and next standing BUY.
- The recovery SELL acknowledgement is delayed or its outcome is unknown.

**Expected output:**

- Initial BUY is priced and rounded according to the market tick.
- Repeated price events do not duplicate an active BUY.
- Actual filled inventory drives recovery SELL planning.
- The next standing BUY is allowed only after the recovery SELL is acknowledged.
- A pending or unknown SELL acknowledgement blocks the next BUY.

**Must not happen:**

- Do not use requested BUY quantity as if it were confirmed filled quantity.
- Do not submit a duplicate active BUY.
- Do not submit the next BUY while the required recovery SELL is pending or unknown.

**Subcases represented by the mapped tests:**

- Initial BUY tick rounding.
- Duplicate suppression.
- Actual fill-driven recovery SELL and standing BUY.
- Acknowledged versus pending/unknown recovery SELL.
- Partial BUY fill behavior.
- Investment cap equality and just-below behavior.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/strategy.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.js`

**Automated tests:**

- [`strategy.test.js`](../../apps/harvester/src/domain/strategies/conservative/strategy.test.js)
  - `creates the initial BUY below last traded price and rounds down to tick`
  - `does not duplicate an already active BUY on repeated price events`
  - `creates a recovery SELL and the next standing BUY from actual filled inventory`
  - `allows the next BUY only after the recovery SELL is acknowledged`
  - `blocks the next BUY while the recovery SELL acknowledgement is pending or unknown`
  - `keeps the partial BUY active while continuing recovery SELL planning`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### CG-002 — Recovery completion preserves required inventory and does not misclassify dust

**Status:** TEST-MAPPED — named existing cases identified; scenario-matrix completeness is not claimed.

**Behavior:** A recovery cycle completes only when the actual remaining inventory satisfies the configured keep-quantity and exchange constraints. Partial or canceled SELLs do not count as completed recovery. Residual inventory that cannot currently be sold must be classified rather than submitted as an invalid order.

**Given / preconditions:**

- A Position with accumulated BUY cost basis and actual SELL proceeds.
- A configured keep quantity and current exchange filters.

**Input / example:**

- Apply one or more partial SELL fills.
- Evaluate completion with remaining inventory above, equal to, or below keep quantity.
- Evaluate residual quantities below the quantity step or minimum notional.

**Expected output:**

- Only a profitable, fully eligible recovery SELL may complete the cycle.
- Partial/canceled SELLs do not allocate retained free inventory as if the cycle completed.
- Residuals above the keep quantity remain sell-through work.
- Quantity-step and MIN_NOTIONAL dust are classified and do not become invalid SELL submissions.
- A later BUY can make a previously constrained residual sellable without losing accumulated basis or proceeds.

**Must not happen:**

- Do not complete a cycle while a partial or canceled SELL remains unresolved.
- Do not release inventory that should remain active.
- Do not discard prior recovery cost basis or net SELL proceeds when residual inventory is carried forward.

**Subcases represented by the mapped tests:**

- Exact keep-quantity allocation after profitable recovery.
- Partial/canceled SELL completion rejection.
- Actual SELL missing the configured profit floor.
- Residual above keep quantity.
- Zero keep quantity.
- Quantity-step and MIN_NOTIONAL dust.
- Later BUY with previously constrained residual inventory.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/recovery-completion.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-ledger.js`

**Automated tests:**

- [`recovery-completion.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-completion.test.js)
  - `allocates exactly keepQuantity after a profitable recovery SELL`
  - `does not allocate free coins for a partial or cancelled recovery SELL`
  - `pauses when a fully filled recovery SELL misses minProfit`
  - `defers completion while any active residual remains above keepQuantity`
  - `fails closed when exchange-constrained dust evidence contains non-positive filter values or negative evaluations`
- [`recovery-sell-plan.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.test.js)
  - `plans a recovery SELL that retains keepQuantity and covers cost plus minProfit`
  - `continues cumulative recovery after confirmed partial SELL proceeds`
  - `reserves base quantity for the configured fee ceiling`
  - `rounds the minimum SELL price up only when the exact fee-adjusted price exceeds a tick`
- [`strategy.test.js`](../../apps/harvester/src/domain/strategies/conservative/strategy.test.js)
  - `continues selling residual inventory after cumulative recovery profit is already secured`
  - `sells the fee-reserved 1.7 DOGE quantity from the incident 2.8 DOGE residual under explicit sellable test filters`
  - `sells the fee-reserved 0.004 ZRO quantity from the incident 0.015 ZRO residual under explicit sellable test filters`
  - `classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL`
  - `classifies residual quantity below MIN_NOTIONAL instead of submitting an invalid SELL`
  - `sells the residual exactly at the MIN_QUANTITY boundary`
  - `sells the residual exactly at the QUANTITY_INCREMENT boundary`
  - `sells the residual exactly at the MIN_NOTIONAL boundary`
- [`create-latest-transition-evaluator.test.js`](../../apps/harvester/src/use-cases/create-latest-transition-evaluator.test.js)
  - `submits the residual SELL on reevaluation after the recovery SELL fill without completing or pausing the cycle`
  - `fails closed before completion or residual SELL submission when recovery evidence cannot be durably flushed`
  - `preserves unknown, rejected, and blocked residual SELL outcomes without completing recovery or placing a BUY`
- [`conservative-trading-engine.test.js`](../../apps/harvester/src/use-cases/conservative-trading-engine.test.js)
  - `reconciles multiple actual SELL fills before completing recovery`
  - `keeps the recovery basis open and classifies exchange-constrained residual after a profitable SELL`
  - `reconciles recovered orders without canceling or replacing any exchange order` (restart reevaluation asserts no duplicate recovery SELL)
  - `does not cancel a recovery SELL when cancellation intent publication is still pending`
- [`prepare-optional-journal.test.js`](../../apps/harvester/src/infrastructure/journal/prepare-optional-journal.test.js)
  - `exposes a write-only durable flush without draining the global EventBus`
  - `fails closed when the underlying Journal has no write-only flush capability`
  - `marks Journal degraded when write-only flush returns a failure`
  - `marks Journal degraded and reports a rejected write-only flush`
- [`event-publisher.test.js`](../../apps/harvester/src/application/events/event-publisher.test.js)
  - `normalizes a rejected write-only flush and reports the original failure`

**Evidence note:** This mapping names the residual sell-through, filter-boundary, restart-idempotency, and durability assertions. It remains TEST-MAPPED until the complete required CI set passes on the exact current PR HEAD; historical exchange filters and the original runtime source revision remain unknown.

---

## Harvester — Recovery Seller (RS)

The [Recovery Seller Domain Specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) is the behavior authority; [issue #1780](https://github.com/45s/coinzilla/issues/1780) owns the RS-specific scenario matrix and evidence. The detailed AI-agent implementation contract is the [RS Scenario Testing Playbook](../../apps/harvester/docs/domain/recovery-seller-scenario-testing.md). The shared, strategy-neutral authoring method is [DOMAIN_SCENARIO_TESTING.md](./DOMAIN_SCENARIO_TESTING.md), tracked separately by [#1779](https://github.com/45s/coinzilla/issues/1779).

**Coverage rule:** this initiative starts at zero. Existing RS unit, workflow, runtime, and operator tests are ordinary regression evidence only; they do not earn scenario-matrix credit. A scenario is not COVERED merely because a related helper test exists or because a test file name sounds relevant. Domain scenarios must prove a coherent business outcome through real domain components. Application-boundary claims require application-level scenarios.

### RS scenario record schema

Every RS entry and issue-matrix row should make the following fields discoverable. Keep the record human-readable; this is a documentation schema, not a new runtime DTO.

| Field | Required meaning |
| --- | --- |
| `id` / `priority` | Stable RS-001…RS-010 identifier and P0/P1/P2 risk rank |
| `authority` | Exact specification section / owner-approved decision |
| `layer` | `DOMAIN`, `APPLICATION`, or deferred `REPLAY` boundary |
| `given` | Initial business state, ownership, custody, reservations and lifecycle |
| `when` | Ordered events/inputs with exact decimal strings and canonical identities |
| `then` | Exact decision, quantities, money, state transitions and committed projections |
| `must_not` | Explicit negative assertions: no duplicate order, cross-subsidy, partial commit, or unauthorized inventory |
| `subcases` | Equality, just-below/above, partial, duplicate, conflicting, reordered, missing and failure variants |
| `implementation` | Source paths that own the behavior; paths are navigation, not evidence |
| `tests` | Exact new scenario file and named case(s), or `not mapped` |
| `status` | MISSING / IN PROGRESS / PARTIAL / BLOCKED / UNSUPPORTED / COVERED |
| `evidence` | Exact head SHA, required workflow result and merge status; otherwise explicitly none |

Example record shape:

```yaml
id: RS-003
priority: P0
authority:
  - recovery-seller-domain-specification.md: sellQuantity is additive
layer: DOMAIN
given:
  recovery:
    netQuantity: "1"
    costQuote: "10"
  legacy:
    authorizedRemainingQuantity: "0.01"
    verifiedSpotUnreservedQuantity: "0.01"
    fixedAverageCostQuotePerBase: "20"
  minProfitQuote: "0.01"
when:
  - evaluate the mixed SELL plan
then:
  totalBaseQuantity: "1.01"
  requiredNetProceedsQuote: "20.20"
  unroundedPriceQuotePerBase: "20.00"
must_not:
  - treat sellQuantity as the total SELL quantity or a cap
  - use combined profit to bypass either allocation gate
  - include off-Spot or reserved legacy quantity
subcases:
  - legacy slice smaller than configured amount
  - legacy exhausted (recovery-only)
  - exact tick/step and notional boundaries
status: PARTIAL
tests:
  - path: apps/harvester/test/scenarios/recovery-seller-mixed-sell-accounting.scenario.test.js
    case: one 401 DOGE canonical SELL Fill allocates 400 DOGE to recovery and 1 DOGE to legacy
evidence:
  exactHead: pending after branch synchronization
  mergedToDevelop: false
```

The schema intentionally separates *business input* from *derived oracle*. Tests must calculate the expected result independently; never copy the implementation's returned value into the expected value.

### RS-001 — Legacy basis is not proof of current Spot custody

**Status:** PARTIAL — 14 stable authorization/custody scenario cases are registered and mapped to the new application/domain suite. The two freshness-sensitive cases (RS-001-010 and RS-001-014) retain explicit BLOCKED freshness subcases because the canonical account snapshot exposes no authoritative freshness marker.

**Behavior:** Operator-declared original quote investment and original base quantity establish historical basis/authorization. Current sellability is a separate fact obtained from verified Spot custody, less existing reservations and other account commitments.

**Given / example:**

- Operator declaration: `invested="100" USDT`, `originalQuantity="50" ZRO`.
- Configured legacy release: `sellQuantity="0.01" ZRO`.
- Verified Spot free quantity: `"0.50" ZRO`; the remaining logical quantity may be in EARN/off-Spot custody.

**Then:**

- Fixed historical average cost is `100 / 50 = 2 USDT/ZRO`.
- Only verified, unreserved Spot quantity is available for the current Spot SELL.
- A Spot/EARN transfer changes custody/availability, not the original cost basis.
- Configuration does not seed Portfolio with synthetic fills or create a wallet-wide RS ownership claim.

**Must not happen:** infer RS ownership from total wallet balance; sell EARN/off-Spot quantity; adopt manual/external inventory; rewrite basis on transfer.

**Required subcases:** invalid/missing/zero/negative basis; insufficient Spot; stale/conflicting account snapshot; external/manual order isolation; CG reservation reducing available Spot; transfer in/out while preserving historical basis.

**Implementation:** `legacy-position.js`, `legacy-spot-allocation.js`, account snapshot and shared commitment allocation.

**New scenario tests:** `apps/harvester/test/scenarios/recovery-seller/authorization-custody.scenario.test.js` with `scenarios/authorization-custody.js` (RS-001-001 through RS-001-014). The consolidated [PR #1823](https://github.com/45s/coinzilla/pull/1823) includes these records and their application/domain runner integration. The family remains PARTIAL: freshness subcases RS-001-010 and RS-001-014 are BLOCKED because the account snapshot has no authoritative freshness marker. Exact-head verification is pending.

### RS-002 — Recovery BUY accounting uses confirmed net fills and actual commissions

**Status:** PARTIAL — 15 of the 20 reserved RS-002 business-matrix IDs are TEST-MAPPED; RS-002-002, -006, -012, -015 and -018 are PARTIAL; no reserved parent case remains wholly BLOCKED. RS-002-017 maps acknowledgement-before-fill, fill-before-acknowledgement and immediate terminal acknowledgement through the production order-event and RS accounting workflows. Cross-cutting application case RS-002-004 also maps #1780 J.01 BUY fill ownership dispatch. The partial cases retain explicit blockers for application authorization/account snapshots, partial-order quote reservation, successful third-asset valuation, overfill/TradingRules validation, and reconciliation of an owned UNKNOWN BUY while STOP is latched. The unknown-submission case proves durable intent/outcome, owned UNKNOWN order retention, one broker call and STOP latching. Follow-up reconciliation while STOP is active remains a separate BLOCKED subcase; source audit shows the current evaluator returns BLOCK before reconciling the owned UNKNOWN order, contrary to the owner-approved investment-only STOP contract. This requires a separate production fix and is not encoded as an expected passing scenario result. This is not complete BUY lifecycle coverage.

**Behavior:** Recovery inventory and cost are derived only from canonical confirmed BUY fills attributed to the current RS Position/cycle/order/market. Requested quantity and acknowledgement are not execution.

**Given / worked fee variants (kept separate):**

- Fill: `10 ZRO @ 2 USDT/ZRO`; gross execution cost = `20 USDT`.
- Base-fee variant: commission `0.01 ZRO` => net acquired recovery quantity `9.99 ZRO`; quote execution cost remains `20 USDT`.
- Quote-fee variant: commission `0.02 USDT` => net acquired base `10 ZRO`; quote cost becomes `20.02 USDT`.

**Then:** aggregate multiple canonical fills using exact quantity, cost, commission and execution VWAP; only the owning RS cycle is credited.

**Must not happen:** credit requested/unfilled quantity; treat an unsupported third-asset fee as zero; attribute CG, manual, external, wrong-market or wrong-Position fills to RS; apply a duplicate twice or accept changed facts under an existing Fill identity.

**Required subcases:** full/partial/multiple fills; base/quote/zero/multiple fee records; fill-before-ack and ack-before-fill; identical replay and conflicting identity; unknown BUY outcome; active BUY gating; investment cap below/equal/above.

**Implementation:** RS accounting workflow, Portfolio/Position and canonical Fill ownership.

**New scenario tests:** `apps/harvester/test/scenarios/recovery-seller/buy-accounting.scenario.test.js` with `scenarios/buy-accounting.js` registers RS-002-001 through RS-002-021 (including explicit blocked dispositions) and cross-cutting RS-002-004. The suite maps initial BUY eligibility from an empty recovery allocation without pre-Fill inventory, RS-versus-CG ownership dispatch, full/partial/multiple fills, exact net base/quote cost/gross VWAP, base/quote/zero/multiple supported fees, third-asset fail-closed behavior, duplicate replay, changed quantity/price/commission identity conflicts, wrong strategy/Position/order/market/side, invalid quantity/commission bounds, multi-tranche legacy-basis preservation, readiness, canonical BUY intent, active-order suppression, investment-cap boundaries using existing recovery exposure; pending BUY commitments now have two application authorizer mappings: RS-002-006-B proves the unfilled 6-unit BUY at 10 quote remains reserved and defers a new BUY with only 65 quote free; RS-002-020-B proves 20 spent + 60 pending + 20 new is accepted exactly at the 100 pair cap, counting the pending commitment once. Both map to `src/use-cases/create-recovery-seller-action-authorizer.test.js` and are included in targeted tests. RS-002-002-B, RS-002-012-B, RS-002-015-C/D and RS-002-018-B remain BLOCKED/PARTIAL with explicit unblock conditions. The consolidated [PR #1852](https://github.com/45s/coinzilla/pull/1852) carries the current suite; the family remains PARTIAL.

### RS-003 — A mixed recovery/legacy SELL uses the additive legacy slice
The accounting workflow-to-default-evaluator defect is addressed by merged [PR #1815](https://github.com/45s/coinzilla/pull/1815), merge commit `cbf07da54fd2e14fbeb3f96d4d9f8efe48d597c2`. All six workflows passed on its exact PR head `20963617c9d9d73c31b47865e0aa34c4a966cc8e`.

**Status:** PARTIAL — RS-003-001…008 remain TEST-MAPPED for the first eight approved cases. RS-003-009-A now exercises a tiny exponent-notation recovery quantity and quantity/price increments through the exact-decimal SELL planner; RS-003-009-B exercises a cross-market CG SELL commitment created after the AccountSnapshot baseline and asserts exact 0.26/0.27 free-base boundaries. Both subcases are TEST-MAPPED. RS-003-010-A separately maps a supported MIN_NOTIONAL violation through the production SELL evaluator and proves BLOCK + sticky STOP + no intent; RS-003-011-A additionally maps missing required MIN_NOTIONAL metadata to BLOCK + sticky STOP + no intent; full exchange-filter and concurrency coverage remains incomplete. The controlled post-snapshot reservation case does not establish all concurrency interleavings, full workflow/custody composition, other commission assets, partial/multiple fills, complete TradingRules boundaries, durable reservation, precision failure or dust. Earlier 14/14 RS-003 tests passed on `ae2af2670e9f96ddcdeeeabdb1da114a385f75a7`; RS-003-009-B exact-head validation is pending. The planner oracle derives legacy average cost from invested / quantity; no separate average-cost config input exists. DOGE/USDT Fill values are illustrative fixtures, not trading defaults. Keep the family PARTIAL.

**Behavior:** Conceptual SELL quantity is actual net recovery quantity plus the configured legacy `sellQuantity`, limited by the authorized remaining legacy amount that is verified, Spot-available and unreserved. `sellQuantity` is additive, not total quantity or a cap.

**Specification example (illustrative quantities, not pair defaults):**

- DOGE example: `400 DOGE recovery + 1 DOGE legacy = 401 DOGE`.
- The example establishes additive semantics only. It does not approve a DOGE price, notional, commission rate, or trading configuration.

**New test fixture caveat:** the current mixed-SELL scenario uses a synthetic DOGE Fill at `10 USDT/DOGE`, `4010 USDT` gross quote proceeds and `4.01 USDT` quote commission. Those values are fixture inputs in that test, not specification-approved fee economics or production defaults. The test proves a supplied canonical Fill can be split as 400 + 1 and that the allocation sums to the Fill; it does **not** prove that the pre-submission planner derives 401 from recovery inventory plus eligible legacy custody.

**Required then:** planner returns the exact target and ownership split; actual canonical fills/fees determine final recovery and legacy debit/proceeds; all relevant filters and profitability gates are enforced. The full production workflow must supply a cycle state accepted by the SELL domain validator before the application path can be called covered.

**Must not happen:** interpret legacy slice as total/cap; use gross BUY quantity rather than net base; consume unverified/reserved legacy; round allocation ownership silently; invent fee assumptions.

**New scenario tests:**

- `recovery-seller-sell-planner.scenario.test.js` (planner-focused; canonical cycle state is supplied to isolate planner behavior)
  - `the SELL planner derives the specification ZRO quantity from canonical workflow inventory and verified Spot custody using the canonical lifecycle-state contract`
  - `a smaller verified Spot remainder is the only legacy quantity added to the recovery SELL`
  - `missing verified Spot custody blocks the SELL intent and produces no broker submission`
  - `an existing account SELL reservation blocks a second Recovery SELL evaluation`
  - `actual TradingRules minimum-notional violations block the derived SELL without adjustment or submission`
- `recovery-seller-mixed-sell-accounting.scenario.test.js`
  - `one 401 DOGE canonical SELL Fill allocates 400 DOGE to recovery and 1 DOGE to legacy`
  - `recovery and legacy allocations must sum exactly to the canonical SELL Fill quantity`
- `recovery-seller/mixed-sell-planning.scenario.test.js`
  - `RS-003-001: the mixed SELL adds the authorized legacy slice to canonical recovery inventory`
  - `RS-003-002: the mixed SELL uses only the smaller authorized legacy remainder`
  - `RS-003-003: exhausted legacy inventory produces a recovery-only SELL plan`
  - `RS-003-004: verified Spot availability below, equal to, and above the required legacy slice is capped exactly`
  - `RS-003-005: verified Spot allocation subtracts every shared Portfolio position across markets and strategies`
  - `RS-003-006: account-wide SELL reservations across markets are summed and snapshot commitments are not double-counted`
  - `RS-003-007-A/B/C: same-market RS, same-market CG and cross-market CG reservations are accounted exactly once`
  - `RS-003-007: registered same-market and cross-market SELL reservations are accounted exactly once`
- `recovery-seller/mixed-sell-fill-allocation.scenario.test.js`
  - `RS-003-008: one canonical SELL Fill is split exactly between recovery and legacy with quantity conservation`
  - `RS-003-009: a post-snapshot CG SELL commitment reduces shared free base exactly once (subcase B; subcase A remains MISSING)`

**Remaining:** concurrent reservation races/interleavings beyond the single controlled post-snapshot commitment delta; full canonical inventory/custody composition for legacy exhaustion; partial and multiple fills; base/quote/mixed commission allocation beyond the one quote-asset Fill split; exchange tick/step/min/max boundaries beyond the existing minimum-notional case; durable reservation/commit behavior; precision failure; constrained-dust classification and exclusion.

### RS-004 — Recovery, legacy, and combined profitability gates are independent

**Status:** PARTIAL — four new domain cases prove both cross-subsidy directions, exact-threshold acceptance and recovery-only eligibility. Three application-transition boundary cases now prove no submission one tick below recovery-dominant, legacy-dominant and tied recovery/legacy/combined plan prices, and submission at/above those targets. [PR #1819](https://github.com/45s/coinzilla/pull/1819) adds registry-driven case `RS-004-011` for all three profitability gates passing at exact recovery/combined thresholds with legacy break-even; it is TEST-MAPPED on exact head `06786f5a3c01f87b5e5d30e945ec7e8662f4b75b`. All five exact-head workflows pass, but the case is not VERIFIED until owner review/merge and merged-head evidence. Actual fill-commission-aware profitability and post-fill application outcomes remain incomplete.

**Specification worked example — mixed SELL planning (no fees):**

- Recovery: `1 ZRO`, cost `10 USDT`.
- Legacy: `0.01 ZRO`, fixed average cost `20 USDT/ZRO`, legacy cost `0.20 USDT`.
- `minProfit = 0.01 USDT`; combined quantity = `1.01 ZRO`.
- Recovery proceeds requirement: `(10 + 0.01) * 1.01 / 1 = 10.1101 USDT`.
- Legacy proceeds requirement: `0.20 * 1.01 / 0.01 = 20.20 USDT`.
- Combined requirement: `10 + 0.20 + 0.01 = 10.21 USDT`.
- Required proceeds = `max(10.1101, 20.20, 10.21) = 20.20 USDT`.
- Unrounded price = `20.20 / 1.01 = 20.00 USDT/ZRO`.

At `20.00 USDT/ZRO`, recovery receives `20.00 USDT` (profit `+10.00`), legacy receives `0.20 USDT` (break-even), and combined profit is `+10.00 USDT`; every applicable gate passes. Using only the combined requirement `10.21` would fail the legacy gate and is therefore incorrect.

**Cross-subsidy negative oracle:**

- Recovery cost `10.00`, proceeds `10.15` => `+0.15`.
- Legacy cost `0.20`, proceeds `0.19` => `-0.01`.
- Combined cost `10.20`, proceeds `10.34` => `+0.14`.
- Recovery and combined are profitable, but legacy fails; overall eligibility must fail.
- The reverse direction is also required: recovery cost `10.00`, proceeds `9.995` (loss `-0.005`); legacy cost `0.20`, proceeds `0.30` (profit `+0.10`); combined profit `+0.095`. Recovery fails, so overall eligibility must fail.

**Must not happen:** collapse three gates into one; let either allocation subsidize the other; evaluate gross rather than actual net proceeds; close an executed cycle after a failed realized gate.

**New scenario tests:** `recovery-seller-profitability.scenario.test.js`

- `registry-and-runner.scenario.test.js` — `RS-004-011`: registry validation and a real-domain all-gates-pass profitability case (PR #1819; TEST-MAPPED, exact-head CI passed; merge evidence pending).

- `a profitable recovery allocation cannot subsidize a legacy loss`
- `profitable legacy proceeds cannot subsidize a recovery loss`
- `a mixed recovery and legacy cycle closes at exact profitability thresholds when every gate passes`
- `recovery-only operation still requires recovery and combined profit after legacy exhaustion`

**Additional pre-submit scenario tests:** `recovery-seller-sell-planner.scenario.test.js`

- `the pre-submit transition enforces the recovery-dominant profitability boundary`
- `the pre-submit transition enforces the legacy-dominant profitability boundary`
- `the pre-submit transition accepts exact equality when recovery, legacy and combined targets coincide`

**Remaining:** actual fee-aware net proceeds and commission allocation; partial/multiple fill history; durable post-fill accounting and adverse STOP application effects.

### RS-005 — A recovery cycle may submit only one SELL lifecycle

**Status:** PARTIAL — new pure cycle-state scenarios prove identity retention and reject selected invalid transitions. They do not prove application broker-call counts or reservation persistence.

**Given / example:** cycle `rs-cycle-001` submits one SELL with client ID `rs-cycle-001-sell`; the transport result is unknown; the evaluator is invoked again.

**Then:** the original identity remains authoritative; repeated unknown notification is idempotent; a second SELL identity is rejected; incomplete terminal history cannot close the cycle; successful closure requires the original order, complete reconciliation and eligible profitability.

**Terminal variants:** CANCELED, REJECTED and EXPIRED remain unresolved; a terminal event with a different client identity is rejected without mutating the submitted state.

**Must not happen:** no replacement/continuation SELL, no next-cycle BUY, no premature reservation release, no second close from duplicate terminal delivery.

**New scenario tests:** `recovery-seller-cycle-lifecycle.scenario.test.js`

- `an unknown SELL outcome retains its only identity until reconciliation completes`
- loop-generated cases: `a terminal canceled SELL remains unresolved and forbids replacement`, `a terminal rejected SELL remains unresolved and forbids replacement`, `a terminal expired SELL remains unresolved and forbids replacement`
- `a terminal SELL with a different client identity cannot reconcile the submitted cycle`

**Remaining:** repeated application evaluation proves zero extra broker submissions; reservation retention/release; partial-fill/cancel races; lookup not-found/failure; duplicate terminal delivery; global STOP and unknown BUY.

### RS-006 — Mixed SELL accounting commits both allocations atomically

**Status:** PARTIAL — new cases prove single-Fill projection, replay no-op, staged duplicate/conflict handling and one domain-projection failure boundary. This is not proof of multi-fill REST/stream or durable transaction atomicity.

**Given / example:** one canonical mixed SELL order and Fill has an explicit recovery/legacy allocation; both projections are calculated from the same accepted execution evidence.

**Then:** recovery and legacy domain projections are returned together or neither changes; identical replay is a no-op; conflicting facts are rejected; a failed legacy projection leaves the recovery Portfolio and original inputs unchanged.

**Must not happen:** apply a partial RS SELL as a standalone CG fill; partially mutate recovery while legacy fails; release a reservation before the required commit succeeds.

**New scenario tests:** `recovery-seller-mixed-sell-accounting.scenario.test.js`

- `a reconciled mixed SELL commits recovery and legacy accounting from the same canonical Fill`
- `replaying the same terminal mixed SELL is an exact no-op in both accounting projections`
- `a failed legacy projection leaves the recovery Portfolio and both original inputs unchanged`
- `a duplicate staged Fill is idempotent and conflicting allocation facts are rejected`

**Remaining:** two-or-more canonical fills; stream-first and REST-first; duplicate cross-channel delivery; incomplete fill history; base/quote/mixed/third-asset fee behavior; commit failure at each persistence boundary; registry publication failure; durable transaction barrier; reservation and STOP effects.

**New application scenario mapping (PR #1852):** `RS-006-003-A/B` now run two canonical partial SELL Fills through the real accounting workflow, verify exact recovery/legacy allocation and quote-fee totals, and prove identical terminal replay is a no-op. Both are TEST-MAPPED only; RS-006 remains PARTIAL pending the other multi-Fill, REST/stream conflict, durability and failure-boundary cases.

### RS-007 — Unknown submission outcome preserves identity and forbids blind retry

**Status:** PARTIAL — the new cycle-state test proves state-level identity retention and replacement rejection only. The broker/application no-retry behavior is not proved by this test.

**Given / example:** durable intent exists for client order ID `rs-cycle-001-sell`; broker request is dispatched; response is lost before acknowledgement.

**Then:** the original identity remains attached to the lifecycle; only lookup/reconciliation of that identity is permitted; the application must not send a second state-changing request; unresolved reservation remains held; the current contract requires STOP and continued reconciliation.

**New scenario mapping:** the unknown-outcome case in `recovery-seller-cycle-lifecycle.scenario.test.js` overlaps RS-005 state-machine assertions. Do not count it as proof of broker submitter behavior.

**Remaining:** actual submitter invocation count; lookup not-found and lookup-failure; original reservation retention; STOP latch; durable intent/outcome failure; unknown BUY.

### RS-008 — CG and RS share account availability and market-owned volatility without sharing strategy ownership

**Status:** PARTIAL — RS-008-017-A/B/C/D/E and RS-008-018-A/B/C/D/E/F are registered and TEST-MAPPED; 018-A proves cross-market shared quote reservation, 018-B proves concurrent same-market CG/RS fills retain independent Positions in one shared Portfolio, 018-C/D prove summed CG/RS quote/base commitments at the pure account allocator boundary, 018-E proves concurrent runtime CG BUY evaluations serialize against an existing RS quote reservation, and 018-F proves runtime CG SELL rejection against an existing RS base reservation; concurrent newly-created SELL/base intents, cross-asset atomic reservation and broader failure interleavings remain MISSING.

**Example:** CG and RS each request a SELL against the same market. Their strategy budgets and Positions remain separate, while the shared account allocator must ensure combined reserved base never exceeds verified available Spot. Repeat with competing BUY quote commitments and with different markets sharing the same quote asset. An RS-only market must also consume the same market-owned volatility gate as CG when protection is enabled; no RS-specific volatility engine is permitted.

**Required outputs:** deterministic serialized allocation; one canonical order owner; one Fill credited to exactly one Position; no strategy budget borrowing; no aggregate oversell/double-spend; shared RS/CG market-volatility eligibility, the volatility-only recovery-SELL exception, and cancellation limited to Harvester-owned BUY orders (never SELL or external/manual orders).

**Global admission precedence:** an active ACCOUNT-scope safety blocker overrides market-level exceptions and blocks every broker submission, including recovery SELL. Existing-order reconciliation and confirmed-fill accounting remain non-trading work.

**Implementation:** shared commitment allocator, account runtime registry, engine transition queue and strategy-owned order routing.

**Tests:** [RS-008-017-A/B/C/D/E volatility scenarios and RS-008-018-A shared quote reservation](../../apps/harvester/test/bootstrap/market-evaluation.test.js); RS-008-018-B same-market accounting concurrency: `apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.test.js` (`RS-008-018-B: concurrent same-market CG and RS fills retain independent Positions`); registry `apps/harvester/test/scenarios/recovery-seller/scenarios/shared-market-volatility-gate.js` and `scenarios/shared-account-quote-reservation.js`. A proves RS-only routing consumes the shared volatility gate; B proves resolver rejection; C proves disabled protection avoids volatility reads while other gates remain; D proves the recovery-SELL exception still respects an independent market pause; E proves cancellation includes CG/RS owned BUYs and excludes SELL/external orders; RS-008-018-A proves an RS quote commitment blocks CG spending across markets; RS-008-018-B proves concurrent same-market fills retain independent CG/RS Positions in one Portfolio. RS-008-018-E maps `RS-008-018-E: concurrent CG BUY intents serialize against a shared RS quote reservation` in `apps/harvester/src/use-cases/conservative-trading-engine.multi-market.test.js`; it exercises concurrent public engine entry points against the shared serialized queue and a seeded RS quote commitment. RS-008-018-F maps `RS-008-018-F: runtime CG SELL is rejected when an RS SELL reserves all shared free base` in the same test file; it exercises the real Conservative engine allocator against a seeded RS-owned active SELL and zero exchange-free base. F proves runtime enforcement, not a concurrent CG/RS SELL race. Exact-head full CI is recorded in issue #1780; no scenario is VERIFIED.

### RS-009 — STOP blocks additional BUY spending only

**Status:** SPECIFIED — owner decision recorded in #1780 on 2026-11-24; implementation and scenario evidence are still MISSING.

**Owner-approved contract:**

- STOP blocks new BUYs and any action that spends additional quote funds.
- STOP does not block an otherwise-valid recovery SELL of already-owned inventory.
- The one-SELL-per-cycle rule remains mandatory. STOP does not authorize a second, continuation or replacement SELL.
- Existing orders may WAIT/RECONCILE; confirmed fills and commissions continue through exact-once accounting.
- An authorized administrator may manually clear STOP only after the cause is fixed, authoritative order/fill/balance reconciliation is complete, Portfolio/legacy/reservation accounting is verified, and the durable resolution fact is acknowledged.
- No automatic clear, self-resume or implicit resume is allowed.

**Current implementation gaps found:**

- The SELL policy returns the STOP decision before evaluating an otherwise-valid SELL.
- Runtime SELL eligibility also rejects STOPPED state, and runtime snapshot construction combines durable STOP with process `strategyStopped`.
- The transition evaluator returns early on STOPPED state instead of submitting an eligible SELL.
- The durable resolution use case exists, but the operator facade currently exposes read-only STOP status and does not expose the administrator resolution command.

**Required scenarios:**

1. STOP active + eligible first recovery SELL: submit exactly one SELL; preserve the STOP latch.
2. STOP active + BUY candidate: zero broker BUY calls and no new quote commitment.
3. STOP active + existing active/unknown SELL: retain original identity and reservation; WAIT/RECONCILE only.
4. Partial and terminal histories: reconcile every confirmed fill/commission exactly once; preserve the one-SELL-per-cycle rule.
5. Duplicate, conflicting and out-of-order events: idempotent for identical facts; fail safely for conflicts.
6. Persistence, reconciliation and accounting failures: retain STOP and unresolved reservations; never invent missing facts.
7. Authorized administrator resolution: require cause-fixed, complete reconciliation and accounting evidence; clear only after durable acknowledgement.
8. Unauthorized resolution: reject without changing STOP or appending a resolution fact.

**Existing tests:** `stop-decision.test.js`, `resolve-recovery-seller-stop.test.js`, `create-harvester-operator.test.js`, `evaluate-sell-decision.test.js`, `create-recovery-seller-transition-evaluator.test.js`, and `create-recovery-seller-runtime-evaluator.test.js`. These are regression starting points, not complete RS-009 scenario evidence.

**Restart/replay:** remains unsupported under RS-010. Do not claim STOP/cycle/reservation restoration or replay coverage.

### RS-010 — Unsupported restart and fee-valuation capabilities remain blocked

**Status:** mixed disposition — restart/replay is UNSUPPORTED for this initiative; third-asset fee valuation is BLOCKED until an authoritative execution-time quote valuation source is approved.

**Restart/replay:** no new scenario may claim automatic RS restart restoration, STOP restoration/clearing, or cycle/reservation reconstruction. A separate approved initiative and contract are required.

**Third-asset commission:** missing, stale, ambiguous or conflicting asset/rate/timestamp evidence must fail closed; never treat the fee as zero or use an unverified current market price. The specification's mixed-fee calculation is illustrative, not evidence that a reliable runtime valuation source is accepted.

**Tests:** no supported-capability scenario mapped. Keep these limitations visible.

---

## Shared packages — initial discovery entries

The package entries below make the repository-wide scope visible, but their exact test-case mapping is not yet complete. They are not marked VERIFIED. Expand them into the same Given / Input / Expected output / Subcases format as the source and test suites are reviewed.

### BRK-001 — Unknown broker mutation outcome is not treated as failure

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** A timeout or connection loss during a state-changing broker request may occur after the exchange accepted the request. The caller must treat the result as unknown and reconcile the original order identity.

**Input:** A state-changing request is dispatched; the transport loses the response before a definitive exchange result is received.

**Expected output:** The mutation outcome is `OUTCOME_UNKNOWN` where the provider contract can establish dispatch uncertainty. The caller looks up and reconciles the original order identity and actual fills before any further action.

**Must not happen:** No blind order or cancellation retry; no interpretation of a failed lookup as permission to retry.

**Subcases:** Request not sent; exchange rejection; confirmed success; timeout after dispatch; disconnect; not-found lookup; malformed order history.

**Implementation:** `packages/brokers/src/` provider mutation and canonical order lookup boundaries.

**Automated tests:** Exact files and named cases not yet mapped. Start from [Broker API contract](../../packages/brokers/BROKER_API.md) and [Brokers package README](../../packages/brokers/README.md).

### BRK-002 — Bitunix Futures TP/SL history is bounded and identity-preserving

**Status:** VERIFIED on `a80dcaeebb7a9b0bd6378834271f01f0b34559d6` — the exact-head Brokers unit suite passed.

**Behavior:** The Bitunix USDT Futures provider reads historical TP/SL order groups through the dedicated history endpoint and returns one caller-bounded page without presenting it as complete account history.

**Input:** `getFuturesTpSlOrderHistory()` accepts optional symbol, side, position-mode and time-range filters plus `limit` and `skip`. The exchange defines side/positionMode as signed int32 fields and limits each page to 100 rows.

**Expected output:** The result exposes `orders`, exchange `total`, `skip` and `limit`. TP/SL identity, position identity, exact decimal trigger/quantity values, status, creation time and trigger time are preserved. Returned rows must match the requested symbol when one is supplied.

**Must not happen:** Do not coerce exchange decimal strings to JavaScript numbers; treat TP/SL history as ordinary canonical orders; return rows for a different requested symbol; or claim that one page proves complete history/retention coverage.

**Subcases:** Valid filters and bounded pagination; maximum page size; oversized page rejection before dispatch; signed-int32 range validation; response symbol mismatch; exact TP/SL prices and exchange lifecycle timestamps.

**Implementation:** `packages/brokers/src/infrastructure/bitunix/futures/broker.js` — `getFuturesTpSlOrderHistory()`, query validation and symbol correlation; `adapters/adapt-futures-pending-tpsl-orders.js` preserves the exchange TP/SL group fields.

**Automated tests:** `packages/brokers/src/infrastructure/bitunix/futures/broker.tpsl.test.js`:

- `Bitunix Futures TP/SL history reads preserve exchange history fields and pagination`
- `Bitunix Futures TP/SL history rejects an oversized page before dispatch`
- `Bitunix Futures TP/SL history rejects rows for a different requested symbol`
- `Bitunix Futures TP/SL history rejects values outside the documented int32 query range`

### BRK-003 — Futures position closes require reconciled private user data

**Status:** VERIFIED — the regression was observed RED on test-only commit `b410108338eefba65d70e8a9393140e53ed247e0`, then GREEN on PR #1806 head `0b131add3aa31ff5f0171710fb7b254dc6cdf592`. The Brokers unit-test job passed all 1,172 tests (0 failures), including the readiness regression and pending TP/SL account-setting preflight test.

**Behavior:** Explicit `allowLivePositionMutations: true` is not sufficient to close a Futures position. The consumer must first establish an authenticated private user-data session, reconcile balances, positions, pending orders and TP/SL orders through REST, and acknowledge that reconciliation.

**Input:** Call `closeFuturesPosition()`, `closeFuturesPositionBySide()` or `closeAllFuturesPositions()` while the position-mutation opt-in is enabled but the private session is absent, disconnected, unauthenticated or still recovery-required.

**Expected output:** Every operation returns `mutationOutcome: "NOT_SENT"` and `positionOutcome: "NOT_SENT"`; no position preflight or state-changing POST is dispatched. Once the session is authenticated and reconciliation is acknowledged, the existing explicit-scope close workflow may perform its one-shot request and REST post-readback.

**Must not happen:** Do not close a position merely because the position-mutation opt-in is enabled. Do not treat reconnect as reconciliation, silently restore readiness, or retry a dispatched close after an unknown outcome.

**Subcases:** Single position close; symbol/side resolution; symbol-scoped close-all; account-wide close with explicit confirmation; missing session; authenticated but unreconciled session; disconnected session; successful reconciled readiness.

**Implementation:** `packages/brokers/src/infrastructure/bitunix/futures/broker.js` — `closeFuturesPosition()`, `closeFuturesPositionBySide()`, `closeAllFuturesPositions()`, `isUserDataReady` and `positionMutationNotReadyResult()`.

**Automated tests:** `packages/brokers/src/infrastructure/bitunix/futures/broker.positions.test.js`:

- `Bitunix Futures position mutations are NOT_SENT until the private user-data session is reconciled`
- `Bitunix Futures closeFuturesPosition closes one exact position and verifies REST readback`
- `Bitunix Futures closeFuturesPositionBySide resolves exactly one position side`
- `Bitunix Futures closeAllFuturesPositions closes only the requested symbol and verifies the final scope`
- `Bitunix Futures closeAllFuturesPositions requires explicit account-wide confirmation`

### BRK-004 — Futures REST pacing and mutation outcomes follow endpoint contracts

**Status:** VERIFIED on source head `d153e02d00427cdb91ccbdca3b1fab10d1781233` — the exact-head Brokers unit job passed 1,175 tests (0 failures); changed-file strict ESLint also passed.

**Behavior:** The Bitunix Futures REST client serializes requests under the documented conservative default and stricter close-position endpoint limits, and it classifies state-changing HTTP failures from the HTTP status before attempting to parse an error body.

**Input:** Send sequential or concurrent requests through clients using the same API key to `close_all_position` and `flash_close_position`; return non-JSON HTTP 400, 429 and 500 responses for state-changing requests.

**Expected output:** The shared queue preserves at least 1,000 ms between close-all requests and 200 ms between flash-close requests while retaining the global 100 ms floor. HTTP 400/429 are definitive rejections; 500 is outcome-unknown. A successful HTTP response with malformed JSON remains outcome-unknown for a dispatched mutation. No mutation is automatically retried.

**Must not happen:** Do not apply a universal 100 ms interval to slower close endpoints, classify non-JSON 400/429 as unknown merely because their bodies are not JSON, or replay a mutation after an ambiguous response. The limiter is process-local and API-key-scoped; it must not be described as a distributed UID/IP limiter.

**Subcases:** Shared same-key queue; documented 1 request/second close-all limit; documented 5 requests/second flash-close limit; HTTP 400 and 429 rejection; HTTP 500 ambiguity; one dispatch per request.

**Implementation:** `packages/brokers/src/infrastructure/bitunix/futures/api/rest-client.js` — shared request queue, endpoint-specific pacing and HTTP-before-body validation.

**Automated tests:**

- [REST pacing regressions](../../packages/brokers/src/infrastructure/bitunix/futures/api/rest-client.rate-limit.test.js) — `Bitunix Futures REST applies the documented slower limits to close-position endpoints`.
- [REST response classification regressions](../../packages/brokers/src/infrastructure/bitunix/futures/api/rest-client.test.js) — `Bitunix Futures REST classifies non-JSON HTTP mutation failures by status before parsing the body`.

### DB-001 — A failed database transaction leaves no partial write

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** A synchronous transaction either commits its complete write set or rolls it back. Transaction-scoped handles must not remain usable after the callback ends.

**Input:** A transaction performs multiple writes and then throws; variants retain a transaction handle or attempt an async callback.

**Expected output:** The failed transaction leaves no partial write. Async callbacks are rejected rather than allowing a premature commit. Handles/statements are invalid after commit or rollback.

**Must not happen:** No partial transaction state; no SQL execution through an expired transaction handle.

**Subcases:** Successful commit; thrown callback rollback; nested transaction rejection; async callback rejection; post-transaction handle use; file-backed reconnect persistence; writer lock contention.

**Implementation:** `packages/db/src/` transaction boundary and SQLite provider.

**Automated tests:** Exact files and named cases not yet mapped. See [provider-neutral CRUD decision](../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md).

### EVT-001 — Publish acceptance is distinct from subscriber completion

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Event publication admits work to subscribers; it does not mean all asynchronous handlers have completed. The explicit flush boundary waits for pending deliveries, including transitively published events.

**Input:** Publish an event to multiple subscribers, including a slow or failing subscriber; invoke flush; close while work is pending.

**Expected output:** One subscriber failure is isolated from unrelated subscribers. Pending work remains bounded and observable. Flush waits for accepted deliveries under the documented contract. Close drains or reports its documented timeout/failure outcome.

**Must not happen:** Do not treat publish return as durable completion. Do not silently drop critical events or leave pending work after close.

**Subcases:** No subscribers; throwing/rejecting handler; slow handler; re-entrant publish; queue capacity; unsubscribe during delivery; close while pending; repeated close.

**Implementation:** `packages/event-bus/src/event-bus.js` and delivery/lifecycle helpers.

**Automated tests:** Exact files and named cases not yet mapped. See [Event Bus roadmap](../../packages/event-bus/ROADMAP.md).

### JRN-001 — Journal flush is the durability boundary

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Recording an event queues an append; a successful flush waits for event delivery and queued writes, then syncs the backing store. A record acknowledgement alone is not proof of durability.

**Input:** Record ordered events, then flush. Variants inject a partial write or sync failure and retry flush on the same Journal instance.

**Expected output:** Records retain append order. A successful sync is reported as durable. A failed sync is reported as non-durable; a later successful flush can durably preserve the completed write and retry record in order.

**Must not happen:** Do not claim `record()` is durable before flush succeeds. Do not reorder or silently lose completed writes after a transient sync failure.

**Subcases:** Ordered append; malformed record; partial write; sync failure; retry flush; close/flush ordering; cleanup after failure.

**Implementation:** `packages/journal/src/journal.js`, filesystem store adapter, and record reader/validator.

**Automated tests:** Exact files and named cases not yet mapped. See [Journal roadmap](../../packages/journal/ROADMAP.md).

### NTF-001 — Notification delivery remains bounded and failure-isolated

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Supported notifications are validated, queued within configured bounds, and delivered through the transport. One malformed event or failed request must not corrupt queue state or leak credentials.

**Input:** Publish supported and malformed events, saturate the delivery queue, then inject a transport error and close.

**Expected output:** Unsupported/malformed events are rejected safely; queue overflow is reported; delivery failures are classified and logged with redacted diagnostics; later valid deliveries and orderly shutdown behave according to the package contract.

**Must not happen:** No unbounded queue growth, credential leakage, or unrecoverable queue state after one failed delivery.

**Subcases:** Missing/partial credentials; setup failure; malformed payload; queue saturation; timeout/HTTP/API failure; redaction; partial subscription setup failure; shutdown.

**Implementation:** `packages/notifiers/src/telegram/` formatter, subscriber, delivery queue, and transport boundary.

**Automated tests:** Exact files and named cases not yet mapped. See [Notifiers roadmap](../../packages/notifiers/ROADMAP.md).

### ENT-001 — Financial values preserve exact decimal and asset identity

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Financial quantities, prices, fees, and increments use exact decimal representations and explicit asset/market identity. Invalid or ambiguous values fail at the domain boundary.

**Input:** Construct and compare values using decimal strings, including values that cannot be represented exactly as binary floating point; provide malformed, negative, zero, or mismatched-asset inputs where disallowed.

**Expected output:** Valid values preserve their canonical exact representation and asset identity. Invalid construction or incompatible operations fail according to the public entity contract.

**Must not happen:** No binary floating-point rounding in financial expectations; no inference of asset identity from an exchange symbol alone.

**Subcases:** Normalization; equality; arithmetic boundaries; invalid decimal strings; zero/negative constraints; asset mismatch; order/fill identity.

**Implementation:** `packages/entities/src/` value objects, market, order, fill, and commission contracts.

**Automated tests:** Exact files and named cases not yet mapped. See [Entities roadmap](../../packages/entities/ROADMAP.md).

### UTL-001 — Shared decimal helpers produce exact, deterministic results

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Shared decimal arithmetic and scaling helpers return exact deterministic values for valid decimal-string inputs and reject unsupported values rather than silently coercing them.

**Input:** Multiply, compare, rescale, round to a step, and calculate percentage values using decimal strings at ordinary and precision-boundary values.

**Expected output:** Results match independently calculated exact decimal expectations; rounding direction is explicit and stable.

**Must not happen:** No floating-point approximation, hidden input coercion, or accidental change of rounding direction.

**Subcases:** Positive/negative values where supported; zero; differing scales; repeating-looking decimal fractions; tick/step rounding up/down; malformed values; maximum supported precision.

**Implementation:** `packages/utils/src/decimal.js` and percentage helpers.

**Automated tests:** Exact files and named cases not yet mapped. See [Utils roadmap](../../packages/utils/ROADMAP.md).

### IND-001 — Indicator calculations reject discontinuous or insufficient candle history

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Exchange-neutral indicators operate on normalized caller-supplied candle data. They must reject malformed, unsorted, duplicate, discontinuous, unfinished, or insufficient history according to the indicator contract.

**Input:** Supply valid contiguous candles, then vary order, timestamps, gaps, duplicate candles, missing fields, invalid prices, and insufficient lookback.

**Expected output:** Valid history produces the documented indicator value after its warm-up period. Invalid or incomplete history produces the documented validation/failure result rather than a misleading numeric value.

**Must not happen:** Do not calculate from silently skipped gaps, unsorted candles, or invalid reference values.

**Subcases:** ATR/NATR warm-up; UTC alignment; contiguous series; duplicate/out-of-order candles; invalid OHLC; zero/invalid close; unfinished candle; insufficient history.

**Implementation:** `packages/indicators/src/` candle normalization and indicator calculations.

**Automated tests:** Exact files and named cases not yet mapped. See [Indicators package](../../packages/indicators/README.md).

---

## Catalog maintenance

- Add a scenario when introducing a meaningful new business behavior, changing a public/domain contract, fixing a correctness defect, or adding a critical lifecycle/safety guarantee.
- Update the existing scenario when its expected behavior changes; do not create a second ID for the same behavior.
- Add new subcases when a boundary, failure mode, event ordering, concurrency condition, or safety invariant is discovered.
- Link the exact production owner and named test cases. If the test mapping is not known or not inspected, say so.
- Move a scenario to VERIFIED only with reviewed assertions and exact-head test evidence. Record the PR/commit or workflow link and the exact SHA.
- Keep unresolved requirements BLOCKED or UNSUPPORTED. Do not turn assumptions, existing test names, or historical CI results into proof.
- Keep domain-specific matrices and detailed evidence in their owning issues/specifications when that is their established home. Link them here instead of copying their full checklists.

## Related canonical sources

- [Engineering standards — testing requirements](../../ENGINEERING_STANDARDS.md)
- [Shared Domain Scenario Testing methodology — issue #1779](https://github.com/45s/coinzilla/issues/1779)
- [Recovery Seller from-scratch scenario matrix — issue #1780](https://github.com/45s/coinzilla/issues/1780)
- [Harvester domain test inventory](../../apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md)
- [Harvester reliability acceptance and critical behavior inventory — issue #1639](https://github.com/45s/coinzilla/issues/1639)

## HARVESTER-ACC-003 — Account-scoped safety blocker closes global admission

**Given:** multiple configured markets, complete account/open-order PREFLIGHT capture, and external orders governed by ADR-0004 (`IGNORE` continues per-market; `BLOCK` blocks only its market).

**When:** a durable `SAFETY_BLOCKER_RAISED` with `scope: ACCOUNT` is restored at startup or latched during runtime, then Conservative BUY/SELL, Recovery Seller BUY/SELL, and shutdown Recovery Seller SELL reach the shared submission boundary.

**Then:** startup does not mark trading READY or activate market-data strategy evaluation while the account blocker is active; the final gate rejects every side/purpose across every market with `ACCOUNT_SAFETY_BLOCKER_ACTIVE`; a pending or failed STOP persistence remains fail-closed; admission reopens only after explicit durable resolution with independent evidence and operator identity. No external order is adopted, cancelled, or mutated.

**Scope controls:** market-scoped blockers affect only their symbol. ADR-0008's Recovery Seller SELL exception applies only to its market-level strategy pause and is subordinate to any account-scoped blocker. An audit `readiness: BLOCKED` classification is not itself a global stop.

**Coverage:** `create-recovery-seller-stop-workflow.test.js`, `create-submission-gate.test.js`, `subscribe-to-user-data.test.js`, and `start-harvester.test.js` (including `rejects an unprojectable account-blocker ledger before broker connection for every recovery configuration` and `rejects a durable unresolved account blocker in Conservative-only mode when CG recovery is disabled`), plus `conservative-trading-engine.test.js` (`rechecks a newly raised account blocker after durable intent and before broker submission`) and `create-submission-gate.test.js` (`market-scoped strategy safety pause blocks only its symbol and preserves the recovery SELL exception`).

## HARVESTER-ACC-004 — Offline authenticated resolution of user-data ACCOUNT blockers

**Given:** a durable, verified Operational State Store; the matching Harvester process is cleanly stopped; its durable configuration baseline defines the complete market universe; and the operator has prepared one reviewed account-wide evidence bundle containing shared account/order observations and complete per-market history, order, fill, balance, and accounting evidence.

**When:** the operator runs `recovery:account-blockers` with the current OS account identity, a unique action ID, an explicit resolution reason, and `--cause-fixed`.

**Then:** the workflow audits every configured market against the shared account/order evidence, durably records one structured resolution fact per eligible user-data ACCOUNT blocker, verifies exact action metadata and projected-state readback, and reports success only after durable confirmation. The first restart is observation-only and must record/verify a fresh durable account PREFLIGHT snapshot plus a clean account-wide open-order PREFLIGHT audit in the same runtime session. Readiness remains BLOCKED; this verification does not enable execution or reopen strategy admission, and separate ADR-0001 restart acceptance remains required.

**Failure and ownership controls:** reject an unclean stop, mismatched session/configuration baseline, missing market evidence, incomplete or contradictory account/order/fill/balance/accounting evidence, unverified producer provenance, forged OS identity, conflicting action-ID reuse, partial/non-durable append, and failed readback. Exact retries may resume a partially committed action only with the same operator, action ID, reason, blocker set, and evidence. Recovery Seller STOP remains exclusively owned by its dedicated resolver; legacy untagged Recovery Seller facts retain compatibility, while an explicit user-data producer with the reserved Recovery Seller reason remains blocking. The workflow never clears Recovery Seller STOP, resets runtime state, reopens admission, calls an exchange, or mutates orders/balances.

**Coverage:** `resolve-offline-user-data-account-blockers.test.js` (including `authenticates the operator against the current OS account before reading evidence`, `durably resolves after clean stop and leaves readiness blocked for restart`, `fails closed for incomplete or contradictory market audit evidence`, `retries a partially appended multi-blocker action and accepts exact duplicate replay`, and `requires the production offline market audit adapter to be injected`); `resolve-user-data-account-blockers.test.js`; `reconcile-terminal-order-fills.test.js` (including terminal REST/stream identity, duplicate, quantity-parity, and reconciliation-acknowledgement failure cases); `record-safety-control-facts.test.js`; `project-harvester-operational-state.test.js`; `create-recovery-seller-stop-workflow.test.js`; `start-harvester.test.js` (`allows only an observation-only restart after account resolution and verifies a fresh durable PREFLIGHT snapshot pair`); and `subscribe-to-user-data.test.js` (`post-resolution restart accepts only a fresh durable account and clean open-order PREFLIGHT pair`, `post-resolution restart accepts a reconciled owned open-orders PREFLIGHT audit`, `post-resolution restart remains blocked when the account PREFLIGHT snapshot is stale`, `post-resolution restart remains blocked when PREFLIGHT finds an unowned external order`). Tracking and remaining operational acceptance: [issue #1828](https://github.com/45s/coinzilla/issues/1828), [PR #1886](https://github.com/45s/coinzilla/pull/1886).

### Conservative executable scenario matrix

The executable definitions are maintained in `apps/harvester/test/scenarios/conservative/`; shared tooling is under `apps/harvester/test/scenarios/shared/`. The registry reuses `apps/harvester/docs/critical-behaviors.json` for critical behavior ownership and named test evidence. Run with `pnpm --filter @coinzilla/harvester scenarios:conservative`. Generated inventory, execution and coverage reports are written to `apps/harvester/reports/conservative-scenarios/` and uploaded by the conditional scenario step in the existing Harvester Targeted Tests workflow.

The initial inventory contains 18 scenarios across 16 categories: 15 TEST-MAPPED, one PARTIAL, one MISSING (CON-PERSIST-003 startup history gate), and one UNSUPPORTED (runtime restoration). TEST-MAPPED means a named test is linked, not that the business outcome has been verified. Runtime restoration remains outside the active Conservative specification. Unmapped-test analysis is limited to named tests in the critical behavior registry.

### Recovery Seller — RS-002-006-B update (2026-11-25)

The RS scenario registry now maps RS-002-006-B to an application authorizer/account-allocation regression: a registered RS partial BUY with 6 remaining at price 10 retains a 60-quote commitment; a new 10-quote BUY defers when free quote is 65. The test is not yet run on the current head. RS-002-006 / RS-002 remain PARTIAL; no scenario is VERIFIED. Full order-event lifecycle proof remains outstanding.

Additional RS-002-020-B mapping: an application authorizer test asserts 20 existing exposure + 60 pending owned BUY commitment + 20 new BUY equals the 100 pair cap and is accepted. Test execution is pending; RS-002-020 / RS-002 remain PARTIAL.

## Scenario Runner real Linux isolation acceptance — 2026-11-27

The opt-in integration test `apps/harvester/src/infrastructure/scenario-runner/linux-sandbox-e2e.test.js` and manual workflow `.github/workflows/harvester-scenario-sandbox-e2e.yml` provide adversarial OS-boundary evidence for the application-level RS simulation adapter. The test checks namespace separation, secret non-forwarding, read-only source mounts, network denial, child-process denial, and the actual cgroup memory/swap/CPU/pids controls. It is not domain RS-001…RS-010 evidence and does not promote any scenario to VERIFIED. Run only on a trusted self-hosted Linux runner with delegated cgroup v2 controllers; acceptance remains pending until the workflow succeeds.
