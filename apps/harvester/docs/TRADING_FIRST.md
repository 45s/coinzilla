# Harvester: Trading First — Mandatory Agent Priority

**This document is a mandatory execution-priority rule for every AI agent working on Harvester. It overrides any roadmap ordering, architecture ambition, optional capability, or agent preference that would delay the first working trading workflow.**

## NON-NEGOTIABLE HARD STOP — TRADING APP ONLY

**This rule outranks every other Harvester document, backlog item, suggestion, agent preference, and perceived best practice.**

Until Harvester has passed the complete real Binance Spot TESTNET acceptance gate defined below, the ONLY permitted Harvester work is work that directly implements, fixes, tests, or verifies the live trading workflow.

**Do not start, continue, expand, or prioritize any of the following before that gate passes:**
- Journal recovery, replay, reconstruction, migration, schema expansion, or additional Journal integration beyond the existing mandatory durability barriers defined below.
- New databases, database migrations, persistence layers, storage abstractions, or durable-state projects.
- New infrastructure, observability, dashboards, analytics, reporting, generic frameworks, or architecture redesign.
- Refactoring, cleanup, optimization, new strategy modes, or features that do not directly unblock or verify the trading workflow.
- Any unrelated task, even if it is already listed in a roadmap, was previously approved as a nice-to-have, or appears technically useful.

**No loopholes:** calling work "hardening", "production readiness", "preparation", "technical debt", "recovery", "architecture", or "a prerequisite" does not make it allowed. Before any non-trading change, the agent must identify the exact trading-flow failure it prevents. If it cannot name and demonstrate that direct blocker, it MUST NOT do the work.

**Narrow safety exception:** a minimal, targeted change is allowed only when the current trading workflow would otherwise create an immediate material risk (for example, duplicate an order after an unknown submission outcome). Implement only the smallest control needed, add focused tests, and immediately return to the trading workflow. This exception never authorizes a general recovery framework, a new database, or a broad Journal project.

**Existing code is not a work order:** preserve and use already-existing components where the trading workflow requires them, but do not expand them or start adjacent projects. Do not remove existing safety controls merely to satisfy this priority rule.

If a user request, old roadmap section, local instruction, or another agent conflicts with this rule, stop and follow this rule. Record unrelated findings as deferred notes only when necessary; do not implement them.

### What "bulletproof trading app" means

The gate is NOT satisfied by compiling, passing unit tests, having a connected WebSocket, a simulated/fake-broker cycle, or submitting one order. It requires documented, repeatable evidence on Binance Spot TESTNET that:

1. The app starts from documented instructions with real TESTNET configuration and validates its enabled market(s).
2. It connects to the broker, obtains current account/exchange rules and usable market data, and maintains required market and user-data streams.
3. The selected Conservative strategy makes correct decisions from current market, order, fill, and portfolio state.
4. Validated orders are submitted and acknowledged; unknown outcomes, rejects, cancellations, and disconnects are handled without blind duplicate orders.
5. Partial and complete executions, including actual commission amount and asset, are processed exactly once for the strategy's in-process state and correctly update holdings/cash flow.
6. The strategy reacts to those real execution updates and continues through repeated BUY → fill → SELL → fill → next-cycle transitions.
7. Repeated controlled TESTNET runs produce reconciled exchange order/trade history and consistent Harvester accounting, with no unexplained orders, fills, balances, or PnL differences.
8. Critical failure cases are covered by deterministic offline tests, and the exact tested build, runbook, logs, and reconciliation evidence are recorded.
9. Live trading remains disabled unless separately and explicitly authorized by the user.

Until every criterion is evidenced and reviewed, the first milestone remains OPEN and all non-trading projects remain BLOCKED. After it passes, the next priority must be explicitly selected; deferred work does not automatically start.

---

## The mission

**Current runtime decision (2026-11-05): Journal replay and process-restart recovery are disabled.** Every process starts with fresh in-memory trading state. Do not read prior Journal sessions, restore old Portfolio/RecoveryLedger/order state, or require historical trade reconciliation before startup. The exact retained Journal safeguards are defined in the contract below. Existing exchange open orders are still unowned and must not be silently adopted.

## Journal contract boundary

Journal is **not wholly optional** during the trading-first phase. The following existing durability barriers are mandatory and retain their current fail-closed behavior:

- **Startup audit:** trading-enabled startup requires a successfully started Journal with durable `flush()`. Capture the full account-wide snapshot as `account.snapshot_captured / OPENING`, including every asset's exact free, locked, and total quantity, and durably flush it before market subscriptions or trading-engine activation. Read-only mode may continue without Journal.
- **Closing audit:** after shutdown intake is drained and owned-order reconciliation is attempted, capture and durably flush `CLOSING` while broker REST remains connected. Mark the audit INCOMPLETE if any owned order or accounting state remains unresolved.
- **Order submission:** durably flush `order.submission_requested` before calling the broker placement operation.
- **Order cancellation:** durably flush `order.cancel_requested` before calling the broker cancellation operation.
- **Failure behavior:** if a required record cannot be durably written, do not perform the corresponding exchange side effect and surface the failure.

These are existing requirements, not authorization for a broader Journal project. Until the TESTNET acceptance gate passes, do not add new blocking flushes or make strategy evaluation, market-event processing, fill accounting, or other broker-event handling wait for optional diagnostic evidence. Additional evidence delivery remains best-effort; any persistence gap must be observable rather than reported as successfully persisted.

The deferred category is broader Journal work: replay/recovery, reconstruction, migrations, schema/consumer expansion, comprehensive raw broker-payload retention, and additional investigation evidence. Issue [#650](https://github.com/45s/coinzilla/issues/650) follows this boundary: its optional/best-effort rule applies only to additional evidence, never to these required barriers.


**FIRST MAKE IT WORK. THEN MAKE IT BETTER.**

Harvester's first product deliverable is a running trading application that can repeatedly execute its selected strategy on Binance TESTNET. The main task is TRADING: read configuration, receive prices, decide, place orders, process executions, and repeat.

Do not turn the first trading milestone into a persistence, journal, recovery-framework, observability, architecture, or optimization project. Those are secondary. They must not be prerequisites for implementing or demonstrating the first working trading cycle unless a specific minimal safety requirement makes a particular capability unavoidable.

## Current TESTNET incident safety gate — 2026-11-04 (post-PR #515)

PR [#513](https://github.com/45s/coinzilla/pull/513) and follow-up [#515](https://github.com/45s/coinzilla/pull/515) are merged into `develop`. PR #515 merge commit is `26fab0c5c22822aa3a8cfa5f851f3e35da37aeb8` (`test(harvester): complete incident lifecycle and audit verification`). All five required workflows passed on that exact `develop` commit: Unit Tests, Test Coverage, JavaScript Syntax, Utils Unit Tests, and Dependency Audit. The Harvester offline lifecycle, accounting, fee-policy, and account-audit implementation/test work is complete; the merge and green CI do **not** prove live TESTNET effectiveness.

The historical incident facts remain: twelve distinct 400-DOGE BUY orders at 0.07598 USDT, client IDs `h-DOGEUSDT-32` through `h-DOGEUSDT-43`, total 4,800 DOGE / 364.704 USDT gross, all TAKER. FILLED acknowledgements preceded canonical fill application. The merged engine now awaits complete execution-history reconciliation inside the serialized transition before the next strategy evaluation; the regression suite also covers twelve sequential immediate fills and reconciled BUY reference prices. Limit orders may execute as TAKER when they immediately match resting liquidity; TAKER status alone does not explain the repeated BUYs.

**Operational stop remains mandatory:** Harvester stays stopped until the operator and assistant explicitly begin the joint TESTNET session. Do not submit/cancel orders, change account settings, or perform exchange writes during preparation. The current one-pair/one-cycle runbook is [TESTNET_VALIDATION_RUNBOOK.md](./TESTNET_VALIDATION_RUNBOOK.md). Actual per-trade commission amount/asset remains authoritative; historical zero-commission fills remain zero and must not be recalculated at the later 0.1% setting. The account's 12,321 free DOGE and 517 non-zero assets are external/unowned baseline inventory unless separately attributed; never adopt them as Harvester inventory.

## Mandatory implementation order

Agents MUST work in this order:

1. **Start the application.** Read and validate the trading configuration. Resolve enabled pairs and their strategy settings. Fail with actionable errors for invalid configuration.
2. **Connect to the broker.** Establish the required broker connection and subscribe to prices for enabled pairs. Keep exchange-specific details inside the broker adapter.
3. **Receive usable market prices.** Validate incoming prices and make the latest usable price available to the trading workflow. Handle missing/stale prices safely.
4. **Evaluate the first strategy.** Conservative is the first executable policy. Its initial BUY trails upward by one configured step while active Position quantity is zero. After a BUY fills, the next standing BUY is fixed while active strategy inventory remains. A profitable recovery SELL can restore the trailing phase, but repricing stays suppressed until Portfolio active `baseQuantity.amount` reaches zero; retained free inventory does not count. Recovery SELLs cover cumulative actual BUY cost, actual commissions, and minProfit while retaining keepQuantity. A new BUY fill cancels and reconciles any old recovery SELL before replacement. Do not start Aggressive first or place runtime/broker concerns inside the domain.
5. **Create and submit orders.** Turn the strategy's decision into an order intent, apply the minimum necessary TESTNET execution checks and exchange filters, and submit a real TESTNET order through the broker.
6. **Receive order updates and executions.** Process acknowledgements, partial fills, final fills, cancellations, and rejections. Update trading state only from actual executions; do not count a requested or acknowledged quantity as filled.
7. **React and repeat.** Re-evaluate when a relevant price, order-state, or fill event arrives. Place the next required order without waiting for an unrelated new price event. Continue the strategy cycle.
8. **Demonstrate the complete cycle.** Verify the full flow on TESTNET with bounded test funds and a reproducible runbook: config → price → decision → order → execution → state update → next decision/order.

The current branch has deterministic fake-broker coverage of the complete first recovery cycle and trailing/cancel-replace behavior. The first milestone is complete only when the application has demonstrably placed and managed orders and repeated the cycle on Binance TESTNET. A collection of pure calculators, entities, adapters, placeholders, NO_ACTION decisions, or disconnected use cases is not a working trading application.

## Keep startup and execution simple

The expected product workflow is the Conservative lifecycle defined in [Trading Strategies](./trading-strategies.md) and the [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Do not add extra startup phases unless they prevent a specific unsafe first order.

- A full account snapshot after every TRADE execution is **not** a default requirement. Actual canonical fills update the in-process Portfolio/RecoveryLedger. Every trading session MUST nevertheless capture and durably journal one all-asset OPENING snapshot before engine activation and one CLOSING snapshot after shutdown intake is drained and owned-order reconciliation is attempted. This narrow audit safeguard is not a per-fill refresh loop.
- A clean TESTNET account is recommended for a controlled first verification, but "no open orders / zero base inventory" must not become a permanent generic startup gate. Do not silently take ownership of external inventory or orders; report ambiguity and keep strategy ownership explicit.
- Check the specific free quote/base balance and in-process commitments required for the order being submitted. Refresh account/order state when there is a concrete reason (startup facts needed by the current implementation, reconnect, or unknown outcome), not as a ritual after every fill.
- If an evaluation is temporarily deferred while an event is processed, retain and resume it automatically after that transition. Do not wait for a new price event.
- PENDING means the broker submission has not yet been acknowledged. Track it; do not cancel it or call cancellation with a missing broker order ID. After acknowledgement, validate the ID, cancel, reconcile fills that raced with cancellation, and only then replace.
- Never classify a local readiness deferral as a Binance rejection. Keep definite rejection, unknown network outcome, expected deferral, and invariant failure distinct.
- Before adding any mechanism, identify the concrete failure in Harvester's current workflow that it prevents.

## Minimum safety required for the first TESTNET cycle

Trading first does not mean careless execution. Implement the smallest safety boundary that makes the TESTNET cycle controlled and testable:

- Require explicit `HARVESTER_ENABLE_TRADING=true` and `HARVESTER_TRADING_MODE=testnet`; reject production NODE_ENV. The default remains read-only. Live trading stays disabled and cannot be enabled implicitly.
- Validate the enabled pair, current price, exchange tick/step rules, supported order type, minimum quantity/notional, and available balance needed for the specific order.
- Use stable client order identifiers where the broker supports them and retain enough in-process order state to associate updates/fills with submitted orders.
- Never submit duplicate orders because of repeated market events or duplicate execution events.
- Apply only incremental actual fills; handle partial fills without double-counting.
- Do not sell more base quantity than is available to the strategy's current in-process position and not already committed to another active SELL.
- On disconnect, stale data, unknown order outcome, unsupported commission, or inconsistent state: stop creating new orders, expose the reason, and require safe refresh/reconciliation before continuing.
- Use a clean, controlled TESTNET account for the first cycle. If pre-existing open orders or unexplained inventory make the test state ambiguous, do not trade blindly; report the blocker.

These are execution safeguards, not a demand to build a comprehensive production reconciliation or persistence subsystem before the first TESTNET order.

## Explicitly secondary — defer until the first TESTNET cycle works

Unless one narrowly scoped part is essential to prevent an immediate unsafe TESTNET action, agents MUST NOT prioritize or block trading implementation on:

- Journal read/replay integration, broader event/evidence coverage, or a comprehensive event/audit journal. The existing durable startup/closing account snapshots and pre-side-effect order/cancel intent flushes are NOT deferred: preserve their current fail-closed behavior.
- Durable Portfolio, RecoveryLedger, reservation, and execution-identity persistence.
- Full process-restart recovery and exactly-once delivery guarantees.
- Comprehensive reconciliation of all historical exchange executions and long-term account history.
- Generic recovery frameworks, storage abstractions, or app-local persistence frameworks.
- Advanced health dashboards, alerting, operator controls, analytics, and performance optimization.
- Aggressive strategy, multiple strategy modes, or additional trading features.
- Refactoring or expanding architecture solely for theoretical future extensibility.

The shared Journal package is used for the mandatory account PREFLIGHT safety audit: every broker-connected startup must durably record balances and account-wide open orders before market subscriptions. This narrow audit is already implemented and is not a reason to expand Journal scope. Broader Journal consumers, schemas, replay, and persistence remain secondary and must not delay the main trading workflow.

## What to do when a secondary gap is discovered

1. Ask: does this gap directly prevent the minimum TESTNET trading workflow, or create an immediate material risk in that workflow?
2. If **no**, record it under the deferred/hardening roadmap and continue implementing trading.
3. If **yes**, implement only the smallest targeted safeguard needed for the current TESTNET cycle. Do not expand it into a generic subsystem.
4. Explain the concrete order-flow failure the safeguard prevents and add focused tests.
5. Return immediately to the next missing step in the trading workflow.

Do not use "production readiness", "future recovery", "complete architecture", or "best practice" as vague reasons to postpone order placement. Identify the specific failure, the minimum necessary control, and the narrowest implementation.

## Engineering standards still apply

Follow the canonical [repository engineering standards](../../../ENGINEERING_STANDARDS.md) and [Harvester agent instructions](../AGENTS.md). This document defines Harvester's product priority and TESTNET execution sequence only.
## Current implementation status

Offline implementation now includes the lifecycle/accounting matrix merged in PR #515, automatic account PREFLIGHT auditing in PR #545, Binance transaction-time fill identity alignment in PR #546, and the aggregate order-commitment allocator/regressions in PR #554, plus same-process lost-ack clientOrderId reconciliation in PR #559. The deterministic suite covers immediate-FILLED acknowledgement barriers, twelve sequential immediate BUY fills through the Conservative policy, weighted execution-price references, streamed partial fills, cancellation/fill and late-event races, REST/stream overlap and stale history, duplicate/conflicting execution facts, concurrent market updates, shutdown reconciliation, commission accounting, RecoveryLedger/Portfolio agreement, Journal aggregation, durable PREFLIGHT/CLOSING audit failure modes, aggregate BUY/SELL budget allocation, UNKNOWN submission state transitions, client-order-ID lookup, and post-lookup fill reconciliation.

The remaining milestone is live Binance Spot TESTNET validation, not another offline implementation phase unless new evidence exposes a defect. Use the [controlled TESTNET runbook](./TESTNET_VALIDATION_RUNBOOK.md). Do not claim that offline tests prove the exchange lifecycle. Any partial-fill/cancel/late-event case not observed in the bounded live session remains explicitly NOT OBSERVED rather than silently accepted.

## Definition of done for the first trading milestone

All of the following must be demonstrated, not merely described:

- [x] App starts from documented instructions and loads/validates real configuration (operator-confirmed TESTNET startup, 2026-11-04).
- [x] Enabled market price subscriptions connect and deliver validated prices (DOGEUSDT market prices were evaluated on TESTNET, 2026-11-04).
- [x] Conservative strategy evaluates actual current context and produces actionable order intents (`PLACE_ORDERS` observed on TESTNET, 2026-11-04).
- [x] Broker adapter submits TESTNET orders and receives acknowledgements (BUY, SELL, and standing BUY orders observed, 2026-11-04).
- [ ] Order acknowledgements and all execution updates are received and normalized. (NEW, FILLED, and TRADE events were observed, and fill-application records exist; at least one CANCELED report was logged as IGNORED, so complete cancellation/order-lifecycle reconciliation is not accepted.)
- [ ] Partial and final fills update Position/Portfolio correctly using actual commission facts.
- [x] The strategy reacts to a BUY fill/order transition and submits the next required SELL plus standing BUY (both acknowledged on TESTNET, 2026-11-04).
- [ ] A safe, repeatable BUY → fill → SELL → fill → next-cycle sequence succeeds on TESTNET. (One recovery SELL and cycle-completion event are evidenced, but the run exposed a repeated-BUY race and a post-cycle MIN_NOTIONAL failure.)
- [ ] Disconnect/unknown-outcome behavior pauses new orders rather than blindly duplicating them.
- [x] Deterministic regression tests and fixes for the rapid-BUY race and post-cycle MIN_NOTIONAL intent are merged into develop and pass all five required workflows on the PR #515 merge commit; live TESTNET effectiveness remains unproven.
- [x] Live trading remains disabled; the evidence recorded here is Binance Spot TESTNET only.

Only after this definition of done is met should the team move the main priority to durable Journal integration, restart recovery, comprehensive reconciliation, operational hardening, or Aggressive strategy work.

## Required agent progress report

At the end of each task, state:

1. Which exact step of the mandatory trading workflow was completed.
2. What now works end to end and what is still only a foundation or placeholder.
3. The next missing trading step.
4. Why any secondary work was necessary to unblock that step.
5. Exact tests/checks run and their outcomes.



### 2026-11-04 exchange trade reconciliation update

The operator-provided DOGEUSDT order-history response contained 102 orders
across 2026-10-28 and 2026-11-04. The 2026-11-04 subset contains 21 FILLED
BUYs (8,400 DOGE; 635.85200 USDT gross quote) and 5 FILLED SELLs
(8,390 DOGE; 636.42265 USDT gross quote). Bounded order-history arithmetic is
therefore +10 DOGE and +0.57065 USDT before commissions. The twelve-order
burst consisted of twelve **distinct** exchange orders/client IDs, but every order
had the same BUY price (0.07598 USDT), quantity (400 DOGE), and TAKER
execution role; all filled within roughly three seconds. This is not a client-ID
collision, and a burst of twelve orders can be legitimate during a sharp dump.
The concern is that all twelve were independently submitted at the same price.
The strategy computes each BUY from lastBuyPrice (or the current market price
before the first fill) minus priceStepPercent; 0.05 means 0.05%, and after a
fully reconciled BUY the next reference should be the actual weighted fill price.
Identical repeated prices are therefore consistent with the engine evaluating
multiple orders against stale/unreconciled fill state. The logs support the
acknowledgement/fill race, but do not identify the exact trigger event for each
submission. The 5,595-DOGE recovery SELL
exceeded that burst by 795 DOGE and necessarily consumed earlier accumulated
inventory too. These are gross exchange order totals, not reconciled Harvester
PnL or a known free-inventory balance.

A read-only `testnet:trades` diagnostic now retrieves Binance
`GET /api/v3/myTrades` records with per-trade commission facts. Run the
single command documented in the README. Correlate each trade's `orderId`
to order history and the journal; preserve the raw rows. The command retrieves
one page (up to 1,000 trades), so completeness must be checked before using
the output as the full incident ledger. The account's opening baseline remains
unknown unless an actual pre-run snapshot can be found. Do not infer it from
the latest account balance or bounded order history.

A further source-review hardening change in PR #513 rejects repeated fill IDs when the duplicate canonical payload differs from the first record. This prevents conflicting execution-history rows from being silently discarded during immediate-FILLED acknowledgement reconciliation; a deterministic regression test asserts the pair pauses before applying any fill.

The trade-history retrieval is still pending operator execution. Harvester
remains stopped; no further TESTNET orders are authorized until trade-level
reconciliation, regression checks, and the incident gate are complete.


### TESTNET commission setting — 2026-11-04

Binance Spot TESTNET account settings previously showed **Commissions: None**. The operator changed the setting to **0.1% maker & taker**; the supplied follow-up screenshot shows that selection. The historical incident trade records still report zero commission and must be reconciled as historical zero-fee executions, not retroactively charged at 0.1%. Before the next controlled TESTNET run, verify the new setting is effective and record the timestamp. For each new execution, use the actual commission amount and asset returned by Binance trade history; never infer the realized fee solely from the UI setting. The setting is account-level and applies across the API keys shown on the page, not only Harvester's key. The new fee configuration changes expected economics and must be included in strategy profit/recovery calculations and regression fixtures before resuming trading.

### 2026-11-04 latest PR #513 review gates

PR #513 has merged and its exact-head CI passed. The MIN_NOTIONAL regression now expects `ok: false`, asserts the validation error, and verifies the pair pauses once without repeated evaluation. PR #515 remains the active offline follow-up: its lifecycle, accounting, fee-policy, and OPENING/CLOSING audit acceptance checks are still in progress. Require fresh exact-head CI for every pushed increment; earlier green runs do not certify later commits.

The maker-only fee-reserve defect is fixed in PR #513: Conservative recovery SELL sizing reserves the greater of configured `makerPercent` and `takerPercent`. Tests cover zero, maker-higher, taker-higher, equal, and invalid fee inputs. Actual commissions remain authoritative for realized fill accounting.

The remaining streamed partial/final, duplicate/out-of-order, cancel/fill, REST/stream and concurrent-market-update matrix is moved to the follow-up PR. The future closed-session opening-balance audit is also follow-up work. Keep Harvester stopped; merge of PR #513 does not authorize TESTNET restart or orders.


### Incident execution handoff — 2026-11-04 (PR #515 follow-up)

**Do not ask the operator to restart Harvester, submit orders, or repeat already supplied evidence.** The operator's role is to provide TESTNET logs/trade-history outputs when explicitly requested after source instrumentation and verification are ready. The engineering agent owns code investigation, fixes, regression tests, documentation, and CI.

#### Implemented in the current PR continuation

- Recovery SELL planning now reserves `max(makerPercent, takerPercent)` until the actual execution role is guaranteed. The fee calculator returns the reserved rate, percentage and role.
- Fee calculator tests now cover zero, maker-higher, taker-higher, equal and invalid rates. The Conservative strategy test expects the higher taker fee to reduce sellable quantity.
- The actual Conservative engine now emits DEBUG records for every market-price event and correlated strategy evaluation, including monotonic market/evaluation IDs, current/previous price, lastBuyPrice/reference overrides, active orders, pair config, readiness/pause state, Portfolio/RecoveryLedger snapshots, trailing-BUY repricing trigger inputs/results, decisions and executable intents. Regression coverage verifies event/evaluation correlation.
- Bootstrap now emits DEBUG per-fill accounting records, including trade/execution/order identity, side, price, quantities, actual commission facts, before/after Position and RecoveryLedger snapshots, exact per-fill active/free base and quote cash-flow deltas, BUY cost/SELL proceeds deltas, outstanding recovery/profit deltas, and applied/duplicate outcome. Rejected fills log errors and unchanged state.
- A bootstrap regression test verifies the per-fill accounting trace.
- README and roadmap now record the incident findings, current fixes and explicit acceptance blockers.

#### Incident findings and source status — 2026-11-04

1. **The +0.20730 USDT difference is explained.** The historical Journal has 21 BUY fills (8,400 DOGE / 635.85200 USDT) and 8 SELL fills (8,390 DOGE / 636.42265 USDT), net +0.57065 USDT quote cash flow. The five recovery.cycle_completed profits are +0.07808, +0.03285, +0.06053, +0.03584, and +0.36335 USDT; they sum exactly to +0.57065. The previous four cycles sum to +0.20730. The +0.36335 value was the last cycle, not the session total.
2. **The twelve BUYs were a confirmed stale-state race.** All 12 distinct 400-DOGE BUYs at 0.07598 USDT were acknowledged FILLED before the first execution fill was applied. The engine now awaits complete canonical fill-history retrieval and application before releasing the serialized transition. Tests cover delayed immediate-FILLED reconciliation and 12 sequential fills through the real Conservative policy, verifying that each next BUY uses the preceding reconciled lastBuyPrice.
3. **Post-cycle residual inventory must remain correctly classified.** Recovery completion allocates exactly keepQuantity to free inventory; extra residual remains active. The Conservative policy now requires positive outstanding recovery before planning another recovery SELL, so residual active inventory alone cannot trigger a new SELL after ledger reset. Invalid strategy-order validation pauses the pair, preventing repeated invalid MIN_NOTIONAL decisions. Pure-policy and new engine-level regression tests cover this path; verify them on the current CI head.
4. **Fee reserve:** recovery SELL sizing uses the greater of configured maker/taker rates. Tests cover zero, maker-higher, taker-higher, equal, and invalid inputs.
5. **Account audit:** trading-enabled startup requires a ready, durably flushable Journal; OPENING all-asset balances are flushed before engine activation. Graceful shutdown reconciles owned orders and flushes CLOSING balances before broker disconnect. The read-only journal:balance-audit command reports per-asset balance deltas and sums per-cycle recovery profits per Journal session.

#### Remaining blockers — work in this order

1. **Exact-head CI before merge:** run the required workflows on the exact current PR head. The previous failure came from an earlier merge ref; current branch expectation has been corrected.
2. **Follow-up lifecycle overlap matrix:** streamed non-terminal → FILLED/TRADE ordering, multiple partial fills, duplicate/out-of-order reports, cancel/fill overlap, REST/stream reconciliation overlap, same-price market events while pending/active, and shutdown while reconciliation is pending.
3. **Follow-up accounting invariants:** verify base-asset and quote-asset commission effects, unsupported third-asset fees, incomplete commission data, and Portfolio/RecoveryLedger per-fill and per-cycle reconciliation.
4. **Follow-up new-session balance audit:** the historical incident Journal predates OPENING/CLOSING snapshots. Run `journal:balance-audit` against a future closed TESTNET session and reconcile per-asset deltas with exchange trade/commission history and external account movements.
5. **Ownership baseline:** the account is pre-funded (12,321 DOGE and 517 non-zero assets). Do not infer Harvester-owned inventory from wallet totals. Separate Harvester executions/orders from external balances/trades before any controlled run.
6. **Commission verification:** historical executions reported zero commissions under the earlier account setting. Verify the later 0.1% maker/taker setting before any future controlled execution. Use actual per-fill commission amount, asset, and status; never retroactively apply the new rate.
7. **Controlled TESTNET gate:** keep the process stopped. No restart or order submission until follow-up lifecycle/account-baseline checks pass and an operator explicitly approves the controlled run.
#### Current gate

- Confirmed source fixes: committed to PR #513.
- 0.20730 USDT cycle/session discrepancy: resolved exactly from the five Journal cycle events.
- Twelve-BUY stale-state race: root cause confirmed; awaited fill-reconciliation barrier and deterministic regression coverage committed.
- Post-cycle residual inventory / MIN_NOTIONAL behavior: policy guard, pair pause, and engine-level regressions committed; exact-head test result still pending.
- Full lifecycle overlap matrix: incomplete.
- New-session OPENING/CLOSING balance audit: implemented, but no post-fix session exists yet.
- TESTNET: stopped; no restart/order submission.
- Merge: authorized once required CI passes on the exact current PR head; TESTNET restart remains separately gated.


## Mandatory account snapshot audit

When a fully reconciled recovery SELL has recovered invested capital and met minimum net profit, only the configured keepQuantity is allocated to free inventory. Additional active residual caused by conservative base-fee reserves or quantity-step rounding remains active inventory. It must not, by itself, create another recovery SELL after the RecoveryLedger is reset.

The required startup/closing capture sequence and failure behavior are defined in the [Journal contract boundary](#journal-contract-boundary) above.

Account-level balance changes are a cross-check only. They cannot be labeled profit until executions, commission asset/amount, external deposits/withdrawals/transfers, and remaining inventory valuation are reconciled. Do not assign external balances to strategy Portfolio.

The historical +0.20730 USDT scope mismatch and twelve-BUY acknowledgement/fill race are resolved and source-remediated in PR #513. Follow-up blockers are the lifecycle overlap matrix, a future closed-session opening-balance reconciliation, ownership separation, and commission-setting verification. No TESTNET restart or order submission is permitted until those gates are complete.

After a session has been stopped gracefully, use `pnpm run journal:balance-audit` from `apps/harvester` to compare its OPENING and CLOSING snapshots. The command reports exact per-asset quantity deltas and fails if either endpoint is absent or the closing audit is incomplete. It does not claim profit from balances alone.

### Post-PR #515 status correction — 2026-11-04

This status supersedes older incident-handoff text in this document that describes PR #515 as pending or its lifecycle/accounting matrix as incomplete. PR #515 is merged; its offline acceptance matrix and exact-head CI are complete. The only remaining critical milestone is the separately authorized joint TESTNET validation and real opening/closing account reconciliation. No TESTNET write has been performed during this documentation preparation.


### Latest ZROUSDT TESTNET reconciliation incident — 2026-11-04

The follow-up branch addresses two broker/engine contract defects. Binance `myTrades` has no client order ID, so REST fills are correlated by exchange order ID, symbol/market and side; a present client ID remains a strict consistency check. Binance `allOrders.orderId` is a cursor lower bound, not an exact filter; the broker now returns only the exact requested order's canonical snapshot. The engine retains the acknowledged broker order ID in an active UNKNOWN order with zero reconciled quantity while execution history is unresolved, preserving the CanonicalOrder rule that PENDING cannot have a broker ID. Later user-data or shutdown reconciliation can advance it without resuming a paused pair.

SELL 698745 cancellation follows the Conservative BUY-filled path: cancel the old recovery SELL, reconcile its fills, and wait for a subsequent eligible market event to evaluate a replacement against the new inventory. The cancellation event ID `IR2BlFAQOVPlsCtcQqq2A5` cannot be attributed to Binance `c` or `C` without raw execution-report evidence. Mark that attribution and any actual replacement as **NOT OBSERVED**, not confirmed cancel/replace behavior.

Exact accounting baseline: trade 9939 = 5 ZRO at 1.792, 8.96 USDT gross, 0.005 ZRO fee; trade 9940 = 5 ZRO at 1.789, 8.945 USDT gross, 0.005 ZRO fee. Combined net 9.990 ZRO, invested/recovery 17.905 USDT, sell proceeds 0, realized net profit -17.905 USDT. No new TESTNET operation was performed. Offline CI and the next joint controlled TESTNET session remain separate gates.
