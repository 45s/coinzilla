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

### Harvester — shared account, order, and portfolio behavior

- [HARV-ACC-001 — Account-wide commitments](#harv-acc-001--account-wide-commitments-are-counted-exactly-once)
- [HARV-ACC-002 — Canonical fill idempotency and conflict rejection](#harv-acc-002--canonical-fills-are-applied-once-and-conflicting-replays-are-rejected)
- [HARV-MKT-001 — Exchange trading-rule boundaries](#harv-mkt-001--exchange-trading-constraints-are-enforced-at-exact-boundaries)

### Harvester — Conservative (CG)

- [CG-001 — Confirmed BUY, recovery SELL, and next-BUY gating](#cg-001--a-confirmed-buy-creates-recovery-work-but-the-next-buy-waits-for-sell-acknowledgement)
- [CG-002 — Recovery completion and constrained dust](#cg-002--recovery-completion-preserves-required-inventory-and-does-not-misclassify-dust)

### Harvester — Recovery Seller (RS)

**Scenario source:** [Build Recovery Seller domain scenario coverage from scratch — issue #1780](https://github.com/45s/coinzilla/issues/1780).

**Important evidence rule:** At the start of the new scenario initiative every RS row was **MISSING**. Existing RS tests continue to run as ordinary regression tests, but they receive no scenario-coverage credit. Do not map, grade, or certify those existing tests as a shortcut. New RS scenario tests must be designed from the approved domain contract and the matrix in #1780.

The [Recovery Seller Domain Specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) and owner-approved decisions remain the behavior authority. Where the contract is draft, unresolved, or deferred, the scenario must remain blocked rather than inventing behavior.

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
  exactHead: 4d59272ea22317b3540d2356082b270328542c7e
  mergedToDevelop: true
  mergeCommit: 9902d6a01d675a988a40f0fb2130c3eb477675ef
  ci: 29 successful checks; read-only Binance TESTNET integration skipped
```

The schema intentionally separates *business input* from *derived oracle*. Tests must calculate the expected result independently; never copy the implementation's returned value into the expected value.

### RS-001 — Legacy basis is not proof of current Spot custody

**Status:** MISSING — no new RS scenario test accepted.

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

**New scenario tests:** not mapped. Existing RS tests are not credited.

### RS-002 — Recovery BUY accounting uses confirmed net fills and actual commissions

**Status:** MISSING — no new RS scenario test accepted.

**Behavior:** Recovery inventory and cost are derived only from canonical confirmed BUY fills attributed to the current RS Position/cycle/order/market. Requested quantity and acknowledgement are not execution.

**Given / worked fee variants (kept separate):**

- Fill: `10 ZRO @ 2 USDT/ZRO`; gross execution cost = `20 USDT`.
- Base-fee variant: commission `0.01 ZRO` => net acquired recovery quantity `9.99 ZRO`; quote execution cost remains `20 USDT`.
- Quote-fee variant: commission `0.02 USDT` => net acquired base `10 ZRO`; quote cost becomes `20.02 USDT`.

**Then:** aggregate multiple canonical fills using exact quantity, cost, commission and execution VWAP; only the owning RS cycle is credited.

**Must not happen:** credit requested/unfilled quantity; treat an unsupported third-asset fee as zero; attribute CG, manual, external, wrong-market or wrong-Position fills to RS; apply a duplicate twice or accept changed facts under an existing Fill identity.

**Required subcases:** full/partial/multiple fills; base/quote/zero/multiple fee records; fill-before-ack and ack-before-fill; identical replay and conflicting identity; unknown BUY outcome; active BUY gating; investment cap below/equal/above.

**Implementation:** RS accounting workflow, Portfolio/Position and canonical Fill ownership.

**New scenario tests:** not mapped. Existing RS tests are not credited.

### RS-003 — A mixed recovery/legacy SELL uses the additive legacy slice
The accounting workflow's transition snapshot currently emits an incomplete accumulating cycle-state shape that the default SELL evaluator rejects; full workflow-to-evaluator proof is tracked separately in [#1809](https://github.com/45s/coinzilla/issues/1809). The planner scenarios normalize only the lifecycle state using the canonical domain factory so that planner economics and no-submit boundaries can be tested without changing production behavior.

**Status:** PARTIAL — the new planner scenario verifies canonical BUY-derived recovery quantity, Spot-verified additive legacy quantity, the independent ZRO proceeds oracle, smaller eligible Spot remainder, missing-custody fail-closed behavior, a same-market active SELL reservation gate, a real TradingRules minimum-notional rejection, and no-submit boundaries. It supplies a canonical lifecycle state to isolate planner behavior because the real workflow-to-evaluator cycle-state projection is blocked by [#1809](https://github.com/45s/coinzilla/issues/1809); it does not prove the full runtime wiring.

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

**Remaining:** fix and prove the real workflow-to-evaluator cycle-state mapping (#1809); cross-market/shared account reservations; legacy exhaustion at scenario level; partial and multiple fills; base/quote/mixed commission allocation; exchange tick/step/min/max boundaries beyond the minimum-notional case; durable reservation/commit behavior; precision failure.

### RS-004 — Recovery, legacy, and combined profitability gates are independent

**Status:** PARTIAL — four new domain cases prove both cross-subsidy directions, exact-threshold acceptance and recovery-only eligibility. Three application-transition boundary cases now prove no submission one tick below recovery-dominant, legacy-dominant and tied recovery/legacy/combined plan prices, and submission at/above those targets. Actual fill-commission-aware profitability and post-fill application outcomes remain incomplete.

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

### RS-007 — Unknown submission outcome preserves identity and forbids blind retry

**Status:** PARTIAL — the new cycle-state test proves state-level identity retention and replacement rejection only. The broker/application no-retry behavior is not proved by this test.

**Given / example:** durable intent exists for client order ID `rs-cycle-001-sell`; broker request is dispatched; response is lost before acknowledgement.

**Then:** the original identity remains attached to the lifecycle; only lookup/reconciliation of that identity is permitted; the application must not send a second state-changing request; unresolved reservation remains held; the current contract requires STOP and continued reconciliation.

**New scenario mapping:** the unknown-outcome case in `recovery-seller-cycle-lifecycle.scenario.test.js` overlaps RS-005 state-machine assertions. Do not count it as proof of broker submitter behavior.

**Remaining:** actual submitter invocation count; lookup not-found and lookup-failure; original reservation retention; STOP latch; durable intent/outcome failure; unknown BUY.

### RS-008 — CG and RS share account availability without sharing strategy ownership

**Status:** MISSING — no new RS scenario test accepted.

**Example:** CG and RS each request a SELL against the same market. Their strategy budgets and Positions remain separate, while the shared account allocator must ensure combined reserved base never exceeds verified available Spot. Repeat with competing BUY quote commitments and with different markets sharing the same quote asset.

**Required outputs:** deterministic serialized allocation; one canonical order owner; one Fill credited to exactly one Position; no strategy budget borrowing; no aggregate oversell/double-spend.

**Implementation:** shared commitment allocator, account runtime registry, engine transition queue and strategy-owned order routing.

**Tests:** not mapped.

### RS-009 — STOP is terminal, visible, and does not suppress reconciliation

**Status:** BLOCKED — a contract/source discrepancy must be resolved before this row can be claimed as terminal or tested as an unconditional no-reset invariant.

**Current evidence and discrepancy:**

- The RS specification and #1780 describe STOP as terminal with no operator clear/reset/resume path; the operator facade exposes read-only STOP status.
- `stop-decision.js` exports `resolveRecoverySellerStopState`, and `resolve-recovery-seller-stop.js` implements an evidence-backed durable `SAFETY_BLOCKER_RESOLVED` operator-action workflow.
- `create-harvester-operator.js` currently exposes only `getRecoverySellerStopState`, not the resolution use case.
- Therefore “no operator method is exposed” is supported, but “there is no domain/application STOP resolution capability” is not. The owner must decide whether the resolution use case is obsolete/forbidden or the terminal-STOP specification needs revision. Do not write a scenario that silently chooses.

**Invariant still required:** while STOP is latched, no new BUY/SELL/retry/replacement may pass; WAIT/RECONCILE of already-submitted work remains possible; first STOP evidence is preserved.

**Tests:** not mapped by this initiative. Existing tests receive no coverage credit.

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
