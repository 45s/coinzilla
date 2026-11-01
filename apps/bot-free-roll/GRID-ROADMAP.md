# Free-Roll Grid Migration Roadmap

**Document version:** `v0.001`  
**Application:** `apps/bot-free-roll`  
**Target branch:** `feature/bot-grid`  
**Base:** `develop`  
**Status:** Design and migration plan — no Grid runtime behavior is enabled by this document.

**Strategy specification:** [GRID-README.md](./GRID-README.md)  
**Mandatory AI-agent workflow:** [GRID-AGENT-INSTRUCTIONS.md](./GRID-AGENT-INSTRUCTIONS.md)  
**Existing strategy specification:** [README.md](./README.md)  
**Existing engineering roadmap:** [ROADMAP.md](./ROADMAP.md)


## Agreed foundational decisions (2026-11-01)

This section records the decisions confirmed during the Grid design discussion. It overrides older conflicting assumptions in this roadmap.

### Mode behavior

| Configured mode | Order management |
|---|---|
| `aggregated` | One managed BUY and one managed SELL per pair |
| `grid` | Multiple managed BUY orders and multiple independent SELL orders per pair |

- Grid is selected explicitly in pair configuration.
- Any pair may use Grid, regardless of `makerPercent`.
- Maker fees/commissions affect execution economics and profitability checks only; they do not decide Grid eligibility.
- Never automatically switch modes or silently fall back to aggregated behavior.
- Grid BUY and SELL orders are independently managed. Do not cancel or resize an unrelated cycle's SELL when another BUY fills.

### Initial BUY behavior

- `makerPercent = 0`: use post-only `LIMIT_MAKER` and place the initial BUY immediately.
- `makerPercent > 0`: use the existing price-trigger behavior for the initial BUY.
- Do not add other startup conditions unless explicitly approved.

### First working milestone

- The immediate goal is a working in-process Grid trading lifecycle.
- Persisted Grid-state restoration and restart recovery are explicitly deferred to a later phase.
- Do not block the first working milestone on restore functionality or claim restart safety before it exists.
- Multiple simultaneous BUYs are in scope. Do not reintroduce the earlier one-working-BUY restriction.
- Exact BUY placement/replenishment scheduling beyond the initial-entry rule remains to be discussed; do not invent it.

### Global trading fail-closed rule

Any trading error pauses the affected pair or the entire bot according to its scope. Never silently swallow a trading error, continue with assumed state, or switch strategy. A pair-specific failure should not stop unrelated pairs that remain safe. Resume only after the cause is resolved and the affected state is verified safe. This rule applies to both aggregated and Grid modes.

```mermaid
flowchart TD
    A[Pair configuration] --> B{Mode}
    B -->|aggregated| C[One BUY + one SELL]
    B -->|grid| D[Multiple BUYs + multiple SELLs]
    C --> E[Shared trading safety]
    D --> E
    E --> F{Trading error?}
    F -->|No| G[Continue]
    F -->|Pair-specific| H[Pause pair]
    F -->|Bot-wide| I[Pause bot]
    H --> J[Resolve and verify]
    I --> J
    J --> K[Resume only when safe]
```

---

## 1. Mission

Introduce an optional **BUY-cycle Grid mode** to Free-Roll while preserving the existing aggregated recovery behavior as the default and as a supported mode.

The first working Grid release supports multiple managed BUY orders and multiple independent SELL orders per pair:

- Every fully filled BUY order creates one independent recovery cycle.
- Every cycle owns its own recovery SELL order and accounting.
- A later BUY fill must not cancel, resize, or replace an unrelated cycle's SELL.
- Each successfully completed cycle retains its own `keepQuantity` as free inventory.
- Different cycles may complete in any order.
- All order, fill, commission, inventory, and trading-safety rules remain mandatory.
- Persisted state restoration and restart recovery are deferred; the first milestone focuses on a working in-process lifecycle.

The exact BUY placement/replenishment schedule beyond the initial-entry rule is not yet specified. Do not impose a one-working-BUY restriction or invent additional scheduling rules.

The migration must be incremental, test-first, feature-flagged, and reversible until Grid mode is explicitly enabled for a pair.

## 2. Relationship to existing Free-Roll

The current strategy is the compatibility baseline. Its approved behavior remains documented in [README.md](./README.md), including pooled recovery accounting and replacement of one aggregate SELL when another BUY fills.

Grid mode changes the unit of recovery accounting:

| Concern | Existing aggregated mode | BUY-cycle Grid mode |
|---|---|---|
| BUY orders | One managed BUY per pair | Multiple managed BUY orders per pair |
| Recovery unit | One pooled active recovery position | One independently tracked BUY cycle |
| SELL orders | At most one aggregate SELL per pair | One independent SELL per open cycle |
| New BUY fills | Reconcile/cancel/replace aggregate SELL | Create a new cycle; leave existing cycle SELLs untouched |
| Profit accounting | Pooled recovery cost/proceeds | Cost/proceeds and net-profit approval per cycle |
| Free allocation | One `keepQuantity` per completed pooled recovery cycle | One `keepQuantity` per successfully completed BUY cycle |
| Sell cancellation | Rebuild aggregate recovery SELL | Rebuild only the affected cycle's SELL |
| Restart | Existing aggregated recovery behavior | Deferred for Grid's first working milestone; implement cycle restoration in a later phase |

Do not reinterpret or silently change the existing mode to behave like Grid. The new behavior is opt-in and must have a separate, explicit configuration value.

## 3. Agreed Grid behavior and examples

### 3.1 Canonical example: two BUY cycles

Configuration example:

- Pair: `DOGEFDUSD`
- BUY quantity: `100 DOGE`
- `keepQuantity`: `1 DOGE`
- Maker commission configuration: `0%`
- Required minimum net profit: `0.01 FDUSD`
- Assumption for this arithmetic example only: actual fills report no commission and quantity increments allow the exact quantities shown.

Sequence:

1. BUY cycle A fills 100 DOGE.
2. Grid creates SELL A for 99 DOGE at a price that independently satisfies cycle A's net-profit requirement.
3. Grid places the next BUY for 100 DOGE.
4. BUY cycle B fills 100 DOGE while SELL A remains open.
5. Grid creates SELL B for 99 DOGE. SELL A remains unchanged and open.
6. The next BUY may be placed, subject to configured risk/exposure limits and all readiness checks.
7. SELL A and SELL B may fill in either order.
8. Each SELL must independently pass its own final fill, commission, inventory, and net-profit checks before exactly 1 DOGE is allocated to free inventory.

Expected result after both cycles complete successfully:

- Cycle A: buy 100, sell 99, retain 1 free DOGE.
- Cycle B: buy 100, sell 99, retain 1 free DOGE.
- Total free inventory earned: 2 DOGE.
- Previously earned free DOGE is never eligible for another order.

The 99 DOGE quantity is an illustrative result, not a hard-coded formula. Actual sellable quantity must account for actual base-asset commissions, broker quantity increments, already reserved inventory, and other reconciled inventory facts.

### 3.2 Different SELL completion order

SELL B may fill before SELL A. Completing B must update only cycle B and the pair-level free-inventory total. It must not reset cycle A's cost, proceeds, fees, remaining quantity, status, or order reference.

### 3.3 A third BUY fills

If cycles A and B each have an open 99 DOGE SELL and BUY C fills for 100 DOGE:

- Do not cancel or resize SELL A.
- Do not cancel or resize SELL B.
- Create cycle C and its independent SELL C.
- Multiple BUY orders are supported in Grid; exact placement scheduling remains a separate decision.

### 3.4 SELL partially fills or is canceled

The existing wait-for-full-order-fill policy remains in force for strategy advancement.

- Record every actual fill immediately and idempotently.
- A partially filled SELL does not complete its cycle and does not allocate free inventory.
- If a SELL is canceled after partial execution, reconcile its final status and all fills.
- Carry the same cycle's remaining inventory, outstanding recovery amount, actual proceeds, fees, and profit calculation into a replacement SELL for that cycle only.
- Never reset the cycle because an order was replaced.
- Never create a replacement until the prior order is conclusively terminal and its fills are reconciled.
- Never reserve the same base units for both the old and replacement SELL.

### 3.5 Fees and quantity constraints

The configured `makerPercent: 0` selects post-only `LIMIT_MAKER` and makes the initial BUY immediate; nonzero `makerPercent` uses the existing initial price-trigger behavior. This does not authorize assuming actual commissions are always zero. Maker-fee configuration never determines Grid eligibility. Actual commission amount and asset on every fill remain authoritative.

For each cycle:

- BUY cost uses actual fill quote amounts and eligible actual BUY commissions.
- Net acquired base quantity reflects base-asset BUY commissions.
- SELL proceeds use actual fill quote amounts less eligible actual SELL commissions.
- Base-asset SELL commissions reduce the cycle's remaining base inventory.
- Third-asset commission behavior remains unchanged: preserve the reported fact, mark accounting incomplete, and pause the pair; do not value or convert the third-asset fee.
- A SELL price is approved against that cycle's own unrecovered cost, actual fees, and required `minProfit`.
- The order quantity is rounded down to broker rules and cannot exceed the cycle's unreserved strategy-owned quantity.

## 4. Scope and explicit non-goals

### In scope

- Independent per-BUY-cycle lifecycle and state.
- Multiple concurrently managed BUY orders per pair.
- Multiple concurrently open SELL orders for one pair.
- Per-cycle cost, proceeds, fees, remaining quantity, and profitability approval.
- Pair-level aggregation of active, reserved, and free inventory without losing cycle ownership.
- Reconciliation of multiple tracked SELL orders.
- Optional per-pair configuration with legacy behavior as the default.
- Cycle-aware statistics, journal events, diagnostics, and documentation.
- Deterministic tests for out-of-order fills, races, and failures.

### Explicitly out of scope for the first Grid release

- Persisted Grid-state restoration and restart recovery.
- Martingale sizing, dynamic order quantities, or automatic averaging rules not explicitly approved.
- A new broker/exchange-specific implementation in strategy code.
- FIFO/LIFO redesign of the existing strategy's cost-basis policy outside the cycle accounting required by Grid.
- Automatic adoption of manual/external wallet inventory.
- Third-asset commission conversion or valuation.
- Automatic resumption after an unsafe reconciliation discrepancy.
- Live-money enablement or a claim of production readiness.

## 5. Non-negotiable invariants

1. **Execution truth:** exchange order status is not a substitute for canonical fill records.
2. **Fill idempotency:** each fill is applied once by stable broker/account/market/trade identity; conflicting duplicate facts pause the pair.
3. **Commission truth:** preserve actual commission amount and asset per fill; configured rates are planning ceilings only.
4. **Exact financial values:** no JavaScript `Number` arithmetic in financial decisions; use exact decimal-string helpers.
5. **Cycle isolation:** a state transition in one cycle cannot mutate another cycle's accounting or order lifecycle.
6. **Inventory ownership:** active strategy inventory, free inventory, external inventory, and order reservations remain distinct.
7. **No double reservation:** a base-asset unit can be reserved by at most one live SELL order.
8. **Free inventory exclusion:** completed free coins are permanently excluded from all future BUY-cycle recovery calculations and SELL quantities.
9. **Per-cycle profit gate:** a cycle cannot complete or allocate free inventory until its own SELL is fully reconciled and its actual net profit meets `minProfit`.
10. **Cancel/fill race safety:** cancellation is not proof of zero fills; reconcile terminal status and fills before releasing or reusing quantity.
11. **Fail closed:** unknown orders, missing fills, incomplete commission facts, mismatched balances, or ambiguous recovery state block new strategy orders.
12. **Compatibility:** when Grid mode is disabled or absent, existing aggregated behavior and its tests remain unchanged.
13. **Broker independence:** strategy contracts contain no Binance SDK types, payload field names, or exchange-specific assumptions.
14. **Serialized pair mutations:** retain the keyed per-symbol queue or an equivalent mechanism so concurrent events cannot race cycle and inventory updates.

## 6. Current implementation audit — develop

Audited source ref: current `develop` at the time this Grid branch was created. This is a source inspection, not a runtime certification; tests were not executed as part of this documentation task.

### 6.1 Existing foundations to reuse

- `FreeRollBot` owns per-symbol strategy state and serializes pair work through the existing keyed queue.
- `order-execution.js` is already a side-effect boundary for BUY placement, SELL placement, cancellation, and replacement.
- `fill-ledger.js` and `fill-reconciliation.js` provide fill identity, validation, deduplication, and accounting projection foundations.
- `market-inventory-ledger.js` provides a per-market inventory ownership/accounting foundation.
- `inventory-allocation.js` contains a pure decimal-string free-inventory allocation helper.
- `reconciliation-snapshot.js` validates and gathers broker-side orders/fills/balances into a normalized snapshot.
- `recovery.js` contains recovery helpers for matching local tracked orders with broker facts.
- Exact decimal helpers, order planning, profitability calculations, lifecycle helpers, and deterministic Node.js tests already exist.
- Existing configuration and README define commission-asset restrictions, post-only behavior, actual fee handling, wait-for-full-fill policy, readiness states, external inventory treatment, and fail-closed safety rules.

These are foundations, not proof that Grid behavior is already supported. The new `src/bot/grid-cycles.js`, `grid-cycle-planning.js`, and `grid-state-store.js` modules are additive domain primitives only; `FreeRollBot`, order execution, live reconciliation, and restart recovery do not call them yet.

### 6.2 Audited single-order assumptions that must change

| Area | Current develop assumption | Required Grid evolution |
|---|---|---|
| Pair state in `bot-free-roll.js` | `buyOrder` and one `sellOrder`; aggregate `activeQuantity`, `cycleCost`, `saleProceeds`, `freeQuantity` | Introduce managed BUY-order tracking plus a cycle collection; each BUY maps to its own cycle and each cycle owns its SELL; keep pair totals as derived projections |
| BUY fill handler | `#handleBuyFilled` updates aggregate position, calls `#replaceSell`, then places next BUY | Resolve the specific BUY order, create its cycle after full fill, and place its SELL without touching other cycles; manage multiple BUY orders independently |
| SELL fill handler | `#handleSellFilled` reads the single `state.sellOrder`, updates aggregate totals, and performs aggregate completion/allocation | Resolve the exact cycle by order identity; update and complete only that cycle |
| Order execution | `order-execution.js` reads/writes `state.sellOrder`; `replaceSell` cancels the existing SELL before placing an aggregate replacement | Accept an explicit cycle/order context; place/cancel/replace one cycle's SELL without iterating or replacing other cycles |
| Tracked orders | Reconciliation currently constructs tracked orders from `[buyOrder, sellOrder]` | Include the BUY and every cycle's current SELL; preserve terminal historical order IDs for fill/history reconciliation where needed |
| Open-order validation | Bot compares broker open orders against the single tracked SELL | Compare all live Grid SELL IDs and fail closed on unknown or duplicate/unowned orders |
| Recovery | Recovery paths check the single `sellOrder` and may recreate one aggregate SELL | Reconstruct all cycles and each cycle's active/terminal order chain; never collapse cycles into one SELL |
| Debug/stats | Snapshot exposes one `sellOrderId` and aggregate counters | Expose cycle count/status, per-cycle order IDs, reserved quantity, and aggregate totals derived from cycles |
| Accounting projection | `fill-reconciliation.js` rebuilds an aggregate recovery-window projection | Build deterministic cycle projections keyed by stable cycle identity; preserve fill dedupe and actual commission facts |
| Inventory allocation | Existing helper allocates `keepQuantity` from aggregate active quantity | Apply allocation to the completing cycle's reconciled residual only; update pair-level free quantity exactly once |

### 6.3 New additive Grid domain primitives — refreshed audit

The feature branch contains and imports `grid-cycles.js`, `grid-cycle-planning.js`, `grid-order-mapping.js`, `grid-order-intents.js`, `grid-order-execution.js`, `grid-sell-inventory.js`, `grid-state-snapshot.js`, `grid-state-runtime.js`, and `grid-state-store.js`. The bot also contains Grid BUY/SELL lifecycle handlers. Portions of the Grid lifecycle have therefore been wired into `FreeRollBot`; this is no longer helper-only preparation.

However, the implementation is **not executable**:
- `validateTradingConfig` deliberately rejects `mode: "grid"`.
- The `FreeRollBot` constructor also rejects every non-aggregated mode.
- Grid order handlers are consequently unreachable through supported configuration. Do not describe the existing code as a working Grid implementation.
- The current state model has only one pending `state.buyOrder`; `createGridOrderExecution.attachAcknowledgedOrder` rejects a second working BUY. It cannot satisfy the approved multiple-concurrent-BUY requirement.
- Cycle SELL creation/completion/cancel-replacement handlers exist, but order submission is coupled to durable state persistence.
- The event router indexes cycle order history, but the reconnect coordinator still uses only legacy `buyOrder` and `sellOrder` fields.

### 6.4 Persistence and uncertain-order recovery audit — first milestone conflict

- `index.js` always constructs and passes a Grid state store. `FreeRollBot.run()` unconditionally calls `#restoreGridState()`, even when no pair selects Grid mode. That method reads the snapshot even for aggregated-only operation; a corrupt or stale Grid snapshot can therefore block an otherwise aggregated startup.
- `createGridOrderExecution` requires a broker and a `persistGridState` callback. Its submission path persists a PREPARED intent before `createOrder`, then persists the acknowledged order afterwards. Grid BUY/SELL submission consequently requires durable storage.
- This conflicts with the approved first milestone: in-process Grid only, with no required persisted restoration, restart recovery, or crash recovery. The store/restore path and durable-intent dependency must be explicitly separated from the first milestone. Do not assume they should remain merely because they are already wired.
- The Brokers domain already supports optional `clientOrderId` on `createOrder` (mapped to Binance `newClientOrderId`), `getOpenOrders`, `getMyTrades`, and canonical order history. No broker API change is currently indicated by this audit. The exact completeness requirements for multi-order reconnect reconciliation remain an app integration task.
- The Journal is append-only and has no read/replay API; event publication is not a substitute for durable order intents.

### 6.5 BUY partial-fill compatibility observation

The approved rule remains: strategy advancement waits for a fully filled and reconciled BUY; fills from different BUY orders must never be combined. The current Grid prototype still has one pending BUY slot, so it does not yet support the approved multiple independent BUYs. The existing aggregated trailing-BUY cancellation path pauses on an uncertain/partial cancellation; preserve that legacy behavior. The terminal-partial-BUY policy for Grid still needs an explicit decision (see the open decision register below).

### 6.6 Important compatibility observation

The existing README explicitly defines pooled recovery: when a second BUY fills before the first SELL, cancel the first SELL and replace it with a larger SELL (for example 199 DOGE after two 100 DOGE buys), retaining one DOGE per completed pooled recovery cycle.

Grid intentionally changes that policy to two independent recovery cycles (two 99 DOGE SELLs and two free DOGE after both successful completions). Do not edit the existing README or silently change the legacy implementation as part of preparatory work. The Grid documents describe the opt-in alternative until it is implemented and validated.

### 6.7 Current branch / PR / CI audit refresh — 2026-11-01

**Audited references**
- Read-only baseline: `develop`, latest commit message: `docs(utils): record completed audit and CI evidence (#384)`.
- Work branch: `feature/bot-grid`, latest commit message: `docs(bot-free-roll): link Grid agent instructions`.
- The branch comparison is **129 commits ahead and 17 commits behind** `develop`. No rebase, reset, cherry-pick, force-push, or branch synchronization was performed.
- The 17 develop-only commits update repository/app agent instructions and engineering standards, and change `event-bus`, `notifiers`, and `utils`. Free-Roll consumes these packages, so the branch must be re-audited against those current contracts after synchronization is explicitly authorized. The `brokers` package has no develop-only changes in this divergence range.

**Open PR inventory (actual base/head refs checked)**
- [#352](https://github.com/45s/coinzilla/pull/352) — draft Grid integration PR; base `develop`, head `feature/bot-grid`. It is the only currently open PR targeting `develop` that is directly relevant to this workstream. Its recorded base is the old shared ancestor, so it is 17 commits behind current `develop`. It was not modified.
- [#373](https://github.com/45s/coinzilla/pull/373) — base `feature/bot-grid`; proposed fix for replay/projection accounting. Not present in the work branch.
- [#374](https://github.com/45s/coinzilla/pull/374) — base `feature/bot-grid`; adds a dedicated multi-SELL reservation projection helper. Not present in the work branch.
- [#375](https://github.com/45s/coinzilla/pull/375) — base `feature/bot-grid`; adds duplicate broker-order-ID validation to snapshots. Not present in the work branch.
- [#376](https://github.com/45s/coinzilla/pull/376) — base `feature/bot-grid`; adds cycle-aware open-order reconciliation mapping. Not present in the work branch.
- PRs #373–#376 are all based on the earlier work-branch commit message `feat(bot-free-roll): route Grid order events by cycle owner`; each source branch is 8 commits behind the current work branch and 2–3 commits ahead of its merge base. They remain independent open proposals. No PR was merged, retargeted, closed, or edited.

**CI evidence at the current work-branch head**
- Node 22 and Node 24 package-test jobs both fail. The Node 22 app test summary is **397 passed / 18 failed** (415 total).
- The dominant regression is constructor wiring: `FreeRollBot` constructs `createGridOrderExecution` unconditionally, and that factory throws unless `broker.createOrder` exists. This breaks existing non-Grid cases, including a disabled strategy that is explicitly allowed to run without a broker. Several unrelated legacy startup/configuration tests fail before reaching their own assertions.
- Two additional Grid runtime tests fail: canonical fill replay produces active quantity `1` where the test expects `0`; the multi-pair snapshot restore test returns `ok: false` where it expects `true`. PR #373 contains a proposed replay/projection correction, but it is not in this branch.
- Workspace coverage fails after the app test failure; the Free-Roll coverage threshold step is not reached. JavaScript syntax, actionlint, production dependency audit, and the standalone `packages/utils` test job pass. Passing checks do not offset the failed package suite.

**Implementation blockers confirmed**
1. Grid is configuration- and constructor-gated, so the substantial Grid handlers are dead/unreachable through supported runtime configuration.
2. Multiple concurrent BUYs are not modeled: one `buyOrder` slot and one pending BUY intent are enforced.
3. The current Grid order submission path requires durable pre/post-submit persistence, contrary to the first in-process-only milestone.
4. Startup restore is wired unconditionally, including aggregated-only startup.
5. Reconnect reconciliation only supplies the legacy BUY/SELL pair and does not enumerate each cycle's live SELLs. A Grid reconnect can classify legitimate cycle SELLs as unexpected and leave the bot globally gated.
6. Pair-level exposure limits and the policy for placing/replenishing multiple BUYs are not implemented or decided.
7. Per-cycle lifecycle handlers exist, but they are not backed by passing end-to-end multi-order fake-broker tests.
8. The current branch CI is red; do not treat helper presence or open PRs as completion.

**Proposed first-milestone order**
1. Close the design questions in Gate B/C below; do not implement while any required first-milestone decision remains open.
2. Restore the aggregated-mode constructor/test baseline first, without changing legacy order behavior.
3. Separate restart persistence/restore and durable crash-window intents from the in-process Grid execution path.
4. Complete cycle-owned order tracking, multi-BUY scheduling, pair-wide reservation/exposure checks, and in-process reconnect reconciliation.
5. Add fake-broker end-to-end tests for concurrent BUYs, independent SELLs, out-of-order completion, partial fills, cancel/fill races, and pair-scoped fail-closed behavior.
6. Enable Grid configuration only after the above runtime and safety gates pass. Keep restart reconstruction and crash recovery in Stage G6.

**Open decision register — Gate B**
- `OPEN — BUY scheduling:` After the initial BUY, what creates the next BUY levels and when may several BUYs be live together? The current prototype places one next BUY after a fill; the approved initial-entry rule does not define the continuing ladder. This controls the scheduler and pending-BUY state model.
- `OPEN — Exposure cap:` What per-pair quote-exposure cap (and/or maximum live BUY count) should apply? Proposed: reserve the full possible quote cost of every live BUY plus unrecovered open-cycle exposure before allowing another BUY. This controls risk limits and prevents already-open BUYs from breaching the cap.
- `OPEN — BUY terminal partial fill:` If a BUY is canceled/expired after a partial fill, should the pair pause for operator review (safest/simple first release), or should the partial quantity become a smaller recovery cycle? The approved rule only creates a cycle after a fully filled BUY; this controls ownership of acquired base in the terminal-partial case.
- `OPEN — SELL repricing:` Once a cycle's recovery SELL is live, should it remain at its calculated recovery price until filled/terminal, or may the bot reprice it while preserving that cycle's minimum net-profit requirement? Proposed first release: no discretionary repricing; replace only after a terminal, fully reconciled prior SELL.
- `OPEN — Reconnect resume:` After an in-process user-data reconnect, should a pair automatically resume only when every cycle/order/fill/reservation/balance fact reconciles, or require explicit operator resume even after successful reconciliation? This controls the reconnect state machine; unsafe/ambiguous state always remains paused.
- `OPEN — Legacy-to-Grid boundary:` Confirm the first release requires a clean pair boundary (no live orders, no unresolved fills, and reconciled position) before changing the explicit mode from aggregated to Grid. Proposed: reject startup/switch if the boundary is not clean; no automatic conversion of pooled legacy inventory.
- `OPEN — First release test gate:` Is deterministic fake-broker end-to-end coverage sufficient to call the in-process milestone working, with TESTNET validation as a separate rollout gate, or must controlled TESTNET validation pass before Grid may be enabled for any pair?

**Already DECIDED — do not ask again**
- Explicit per-pair `aggregated` / `grid` modes; no automatic mode switch or silent fallback; aggregated default remains unchanged.
- `makerPercent = 0`: initial BUY immediately as post-only `LIMIT_MAKER`; `makerPercent > 0`: existing price-trigger behavior. No further scheduling rule is implied.
- One fully filled and reconciled BUY creates one independent cycle; every cycle owns its own recovery accounting and SELL attempts; multiple cycles may complete in any order.
- A new BUY must never modify another cycle's SELL. Free `keepQuantity` is allocated only after that cycle's SELL is fully reconciled and actual net profit meets `minProfit`.
- Fail closed on uncertain trading state; pause the affected pair without unnecessarily stopping demonstrably safe pairs; reconcile before resuming.
- First milestone is in-process only. Persisted restore, restart recovery, and crash recovery are deferred to a later phase.

## 7. Migration strategy: safe preparation versus Grid-only behavior

The most important migration rule is:

**First improve shared foundations in ways that preserve legacy behavior. Only after those foundations are proven should Grid-specific runtime behavior be introduced behind a disabled-by-default mode.**

### 7.1 Safe preparatory changes that can land in existing develop functionality

These changes should be behavior-preserving. They can be developed as small PRs against `develop` and later merged into this feature branch by updating it from `develop`.

| Prep ID | Change | Why it is safe/useful | Required proof |
|---|---|---|---|
| PREP-01 | Add characterization tests for current aggregated lifecycle | Locks down existing behavior before refactoring | Existing tests plus new tests prove 1 BUY / 1 aggregate SELL, replacement quantity, cancel/fill race, and free allocation remain unchanged |
| PREP-02 | Add stable order-role/context helpers without changing execution | Makes order identity and role explicit for BUY, aggregate SELL, and future cycle SELL | Pure helper tests; no broker calls or state mutation |
| PREP-03 | Add pure cycle-domain primitives in a new isolated module, not yet used by bot | Allows design/testing of cycle identity, status transitions, sellable quantity, and per-cycle P&L | Object-input/object-output pure functions; decimal strings; immutability and boundary tests |
| PREP-04 | Add a pure aggregate projection from a list of cycles | Establishes how pair totals are derived without replacing current state | Tests for empty, active, partially sold, completed, failed, and out-of-order cycles |
| PREP-05 | Strengthen inventory reservation helpers as additive APIs | Makes multiple reservations provable without changing the current one-SELL call path | Tests prove no overlap, no over-reservation, release only after terminal reconciliation |
| PREP-06 | Add multi-order reconciliation helper alongside existing single-order recovery | Allows snapshot validation to understand an array of tracked orders while existing caller still passes one | Tests for N SELLs, unknown orders, duplicate IDs, missing history, terminal order fills |
| PREP-07 | Add cycle-oriented journal/event schemas as unused additive contracts | Stabilizes observability contract before execution changes | Schema/serialization tests; existing events unchanged |
| PREP-08 | Add Grid-only config parsing/validation with default `mode: "aggregated"` | Makes opt-in explicit while preserving absent-config behavior | Existing config fixtures pass unchanged; invalid mode fails startup; no order behavior changes |
| PREP-09 | Add cycle-aware statistics as an optional projection | Prepares diagnostics without changing trading decisions | Existing stats output remains compatible; new fields are additive and derived |
| PREP-10 | Add adversarial test fixtures for multi-SELL ordering and restart scenarios | Builds the test harness before the runtime feature | Deterministic fake broker and no live exchange/network dependency |

A preparatory PR must not start placing additional SELL orders, change the meaning of `keepQuantity`, change aggregate accounting, or alter the legacy replacement policy.

### 7.2 Changes that must remain isolated to Grid implementation

Do not land these as behavior changes in the shared legacy path:

- Creating one cycle for each fully filled BUY.
- Allowing multiple live SELL orders for one pair.
- Removing the cancel-and-replace-all behavior from the aggregated strategy.
- Changing `keepQuantity` from one pooled recovery allocation to one allocation per BUY cycle.
- Switching profitability accounting from pooled to per-cycle.
- Changing how BUY fill creates/replenishes the next BUY relative to cycle SELL placement.
- Grid-specific startup/restart reconstruction and handling of legacy open orders.
- Enabling Grid mode in a real trading config.

These changes require Grid-mode branching and dedicated integration tests. The legacy path must remain intact.

### 7.3 Feature-flag and rollout rule

- Add an explicit per-pair strategy mode, proposed shape: `mode: "aggregated" | "grid"`.
- Missing mode must resolve to `"aggregated"` for backward compatibility.
- Grid must remain disabled by default in committed configuration and all existing fixtures.
- Never infer Grid mode from the presence of multiple SELLs or from a new field that older configs do not contain.
- Do not allow a pair to switch modes while it has live strategy orders or unreconciled inventory/cycle state.
- A mode switch requires a deliberate drain-and-reconcile procedure. If the bot cannot prove a clean boundary, pause and require operator reconciliation.
- Do not support simultaneous aggregated and Grid accounting for the same pair.
- Initial rollout must use deterministic tests and controlled testnet validation. No live-money enablement is included in this roadmap.

## 8. Proposed target domain model

Prefer one authoritative cycle collection; do not maintain duplicate mutable `sellOrders` and `cycles` collections that can drift apart. A cycle owns its BUY provenance, accounting, current SELL order, and order history.

Illustrative shape only; finalize field names and contracts during the domain-model PR:

```js
{
  id: "stable-cycle-id",
  symbol: "DOGEFDUSD",
  buyOrderId: "broker-buy-order-id",
  buyFillIds: ["stable-fill-id-1"],
  status: "SELL_PENDING",
  acquiredQuantity: "100",
  remainingQuantity: "100",
  recoveryCost: "10",
  netSaleProceeds: "0",
  commissions: {
    base: "0",
    quote: "0",
    unsupported: []
  },
  sellOrder: {
    currentOrderId: "broker-sell-order-id",
    orderIds: ["broker-sell-order-id"],
    status: "OPEN",
    reservedQuantity: "99"
  },
  freeQuantityAllocated: "0"
}
```

The exact model must distinguish:
- Stable cycle identity from exchange order identity.
- Actual acquired base quantity from currently sellable and reserved quantity.
- Current SELL order from all prior SELL attempts for that cycle.
- Cumulative actual cost/proceeds from order price estimates.
- Actual commission facts from configured fee assumptions.
- A completed cycle from a merely filled/canceled order.
- Free inventory already allocated from the cycle's remaining active inventory.
- Unknown/incomplete accounting from an explicit zero amount.

Cycle IDs must be stable across event replay and restart. Prefer a deterministic identity derived from the market/account scope and the canonical BUY order/fill identity; document collision and partial-fill behavior. Do not use timestamps or random IDs as the only recovery key.

Pair-level values such as total active quantity, total free quantity, total reserved quantity, open-cycle count, and realized profit should be derived from cycle state plus the market inventory ledger. Avoid two competing sources of truth.

## 9. Required lifecycle and safety decisions

### 9.1 BUY completion

- Continue recording/deduplicating each actual fill as it arrives.
- Preserve the current wait-until-FILLED policy for strategy advancement.
- Only after canonical order history and all BUY fills reconcile to a terminal fully filled order may a new cycle be committed.
- Cycle creation must be idempotent. Replaying the same BUY completion cannot create a second cycle or a second SELL.
- The cycle's acquired quantity and cost must come from actual fill facts, not submitted order quantity multiplied by limit price.

### 9.2 Independent SELL lifecycle

- A cycle may have at most one live SELL order at a time.
- Different cycles may each have one live SELL order concurrently.
- Every SELL order must reserve only its owning cycle's available strategy-owned quantity.
- A new cycle must not modify another cycle's SELL.
- Replacement is scoped to one cycle and requires terminal reconciliation of that cycle's prior SELL.
- If an old SELL's final status is unknown, do not create a replacement for that cycle or release its reservation.
- If any order cannot be mapped to exactly one cycle, pause the pair.

### 9.3 Per-cycle recovery accounting

Grid uses independent recovery balances. For each cycle:
- Accumulate actual BUY quote cost and eligible quote-denominated BUY commissions.
- Accumulate actual net SELL quote proceeds across all SELL attempts belonging to that cycle.
- Preserve cost/proceeds through cancellation and replacement.
- Calculate the required SELL price from that cycle's remaining recovery amount, its sellable quantity, applicable commission coverage, and configured `minProfit`.
- Never count unrealized market value as recovered quote capital.
- A cycle is eligible for free allocation only when its SELL completion is fully reconciled and actual net profit meets `minProfit`.
- A failed or canceled SELL does not erase proceeds already earned or the cycle's recovery balance.

The exact treatment of residual base quantity, base-asset fees, and quantity-step dust must be specified in the pure accounting design before integration. Do not assume every 100-unit BUY always permits exactly a 99-unit SELL.

### 9.4 Inventory and reservation model

At minimum, represent and reconcile:
- Active strategy-owned base quantity assigned to open cycles.
- Free base quantity allocated by completed cycles.
- Base quantity reserved by each live SELL.
- Base quantity executed by SELL fills but not yet finalized in cycle accounting.
- External/unmanaged base quantity.
- Broker-reported available and locked balances.

A reservation is keyed to a specific cycle and order. It is not a second copy of owned inventory. Pair-level reserved quantity is the exact sum of current live cycle SELL reservations.

On cancellation, do not release the reservation until final order status and fills are reconciled. On partial fill, reduce remaining owned/reserved quantities using actual fill facts. Never let two SELLs reserve overlapping units.

### 9.5 Recovery and restart

Startup/reconnect must reconstruct:
- The one current BUY order, if any.
- Every open cycle and its current SELL order.
- Historical SELL order IDs for each cycle, including canceled/replaced attempts.
- All relevant fills and commission facts, deduplicated by stable identity.
- Per-cycle recovery balances and free allocation status.
- All live reservations and the pair-level inventory projection.

Unknown broker open orders, duplicate order-to-cycle mapping, missing fill history, stale state, or unexplained balance differences must block new order creation. Do not automatically adopt unknown orders or wallet inventory.

Legacy-to-Grid transition must not guess how one pooled legacy position maps to independent BUY cycles. The initial migration policy should require a clean pair boundary (no live orders, no unreconciled fills, and a reconciled position) or an explicit, reviewed conversion procedure. Until such a procedure is implemented, keep that pair in aggregated mode.

## 10. Detailed implementation sequence

Each item should be a small PR with a clear Grid roadmap ID, complete tests, and no unrelated cleanup.

### Stage G0 — Documentation and migration boundary

- [x] **GRID-001 — Create Grid strategy specification and migration roadmap.** Add this document and [GRID-README.md](./GRID-README.md), link them from each other, record the current source audit, distinguish safe preparation from behavior changes, and define acceptance gates.
- [ ] **GRID-002 — Review and approve Grid domain decisions.** Confirm BUY-cycle semantics, per-cycle `keepQuantity`, per-cycle `minProfit`, partial-fill/cancel behavior, cycle identity, and legacy mode-switch policy before runtime changes.

### Stage G1 — Characterize and protect existing behavior

- [~] **GRID-010 — Add legacy lifecycle characterization tests.** In progress on `feature/bot-grid`: strengthened the existing partial-SELL/cancel/replacement integration test to assert that the original aggregate SELL is canceled, the replacement SELL is exactly 189 units after a 10-unit partial fill and a second 100-unit BUY, and the legacy pair still has one active SELL with zero free allocation. Remaining: add explicit full-fill aggregation and cancellation-race assertions if not already covered by the existing suite; run the complete app test and coverage commands. No production behavior change.
- [~] **GRID-011 — Capture current test and coverage baseline.** CI evidence captured at the current branch head: Node 22 and Node 24 package tests fail; Node 22 reports 397 passed / 18 failed. Syntax and production dependency audit pass; workspace coverage fails because app tests fail. A green baseline is not established.
- [x] **GRID-012 — Add explicit legacy-mode config compatibility tests.** Tests prove absent mode preserves the legacy default and explicit `aggregated` is accepted. This is a config-validation test completion only; the full app suite remains red.

### Stage G2 — Pure domain model and projections (safe additive preparation)

- [~] **GRID-020 — Define cycle identity and lifecycle contracts.** In progress: `src/bot/grid-cycles.js` adds deterministic cycle IDs derived from market + BUY order ID; immutable cycle creation; one-live-SELL enforcement; order/fill history; explicit reservation bounds; idempotent SELL fill replay (including after completion); reconciliation-gated terminal cancellation; exact free allocation; and pair projections. Canonical BUY and SELL order IDs, client IDs, sides, types, prices, and quantities are now retained in cycle snapshots. Bot imports and invokes the cycle model from Grid BUY/SELL handlers, but the handlers remain unreachable because Grid mode is rejected. Remaining: make the runtime executable, support multiple pending BUYs, and complete cycle-aware reconnect reconciliation.
- [~] **GRID-021 — Define per-cycle exact accounting helpers.** In progress: `grid-cycle-planning.js` builds a cycle from canonical BUY fills using `calculateFillAccountingExact`, preserving net acquired base, quote recovery cost, and supported base/quote commission totals. `calculateGridCycleSellPlan` combines the exact existing sell-price planner with `grid-sell-inventory.js` and rejects quantity/reservation disagreement. `recordGridCycleSellFill` applies exact SELL base debits/net quote proceeds and preserves per-asset commission facts; `completeGridCycle` gates on actual per-cycle net proceeds. Grid BUY/SELL handlers now call the per-cycle planner and completion helpers, but the mode gate prevents runtime use. The replay/projection regression is currently failing in CI; see PR #373. No floating-point financial decisions.
- [~] **GRID-022 — Define sellable-quantity and free-allocation helpers.** Added and wired `grid-sell-inventory.js`: exact decimal planning subtracts `keepQuantity`, rounds gross SELL quantity down to the exchange step, reserves gross quantity plus configured base-fee coverage, and reports unreserved dust. `calculateGridCycleSellPlan` now returns that reservation; cycle validation rejects persisted live orders whose reservation cannot cover remaining gross quantity. Actual exchange base debits remain authoritative, and a fill exceeding its reservation is rejected. Reservation values are used by the current Grid SELL-intent path, which is coupled to durable persistence. A separate cross-cycle reservation projection proposal is open in PR #374; inspect it for necessity/overlap before adopting. First-milestone reservation logic must not depend on restart persistence.
- [~] **GRID-023 — Define pair projection from cycles.** In progress: `projectGridCycles` derives active, free, reserved, residual, recovery-cost, proceeds, realized-profit, cycle counts, and commission totals from immutable cycle snapshots; it rejects duplicate cycle IDs, duplicate SELL ownership, mixed symbols, and pair reservations above active inventory. The bot calls the projection after Grid cycle changes, but replay/snapshot tests currently fail (PR #373 proposes a correction). The projection is not evidence of a working end-to-end runtime while Grid mode remains disabled.
- [~] **GRID-024 — Define cycle order mapping and order-role helpers.** Added `grid-order-mapping.js` with an immutable index of each cycle's canonical BUY and every historical SELL attempt, plus event resolution by broker order ID/client order ID. It rejects unknown, duplicate, conflicting, or symbol/side-mismatched identities. Tests cover two cycles and historical SELL ownership. Grid user-data events now use this mapping. Reconnect/open-order reconciliation is still legacy; PR #376 proposes cycle-aware open-order reconciliation and remains unmerged.

### Stage G3 — Multi-order inventory and reconciliation foundations

- [~] **GRID-030 — Add multiple-reservation inventory helpers.** Existing cycle projection sums reservations and checks them against active inventory; a dedicated cross-cycle reservation projection is proposed in open PR #374 but is not in this branch. Audit whether it adds a necessary invariant beyond `projectGridCycles` before adopting it. Prove non-overlap and release only after final reconciliation.
- [~] **GRID-031 — Extend reconciliation snapshot for multiple tracked orders.** The snapshot collector accepts a tracked-order collection, but the current bot caller still supplies only legacy `buyOrder`/`sellOrder`. Enumerate the pending BUYs and every live cycle SELL; keep unknown-order validation strict.
- [~] **GRID-032 — Extend fill reconciliation to cycle projections.** A canonical fill replay helper exists for the later snapshot-restore phase, but its replay/projection tests currently fail. Live fill routing has partial cycle integration; first-milestone tests must prove per-cycle ownership and idempotency without requiring restart replay. PR #373 is open.
- [~] **GRID-033 — Add cycle-aware recovery mapping.** The event router maps known cycle orders, but open-order snapshot/reconnect mapping is incomplete. PR #376 proposes cycle-aware open-order reconciliation and remains unmerged.
- [ ] **GRID-034 — Add multi-order fake-broker fixtures.** Deterministically simulate multiple concurrent BUYs and SELLs, out-of-order fills, partial fills, cancellation races, duplicate events, and trading errors. Restart scenarios belong to the later restoration phase.

### Stage G4 — Configuration and observability (still disabled)

- [~] **GRID-040 — Add explicit per-pair mode validation.** In progress: absent mode remains the legacy aggregated default; explicit `aggregated` is accepted; unknown modes are rejected; explicit `grid` is deliberately rejected by both trading-config validation and the bot constructor. Enable it only after the first in-process runtime, multi-order reconciliation, exposure limits, and fake-broker tests pass; persisted restart restoration is not a prerequisite for this first milestone.
- [ ] **GRID-041 — Add cycle-aware journal events.** Stable cycle ID, order ID, event type, quantities, and accounting completeness; no raw broker payloads or secrets.
- [ ] **GRID-042 — Add optional cycle statistics/debug snapshots.** Expose open/completed/paused cycle counts, per-cycle SELL state, reserved quantity, free inventory, and realized profit as derived values.
- [ ] **GRID-043 — Add migration diagnostics.** Report why a pair is not eligible to switch from aggregated to Grid (open order, incomplete fill history, unreconciled balance, ambiguous legacy position).\n- [~] **GRID-044 — [Later phase] Add versioned atomic Grid state snapshots.** In progress: `grid-state-store.js` provides schema-version validation, JSON-safe snapshot validation, monotonic revisions, serialized writes, file sync, and same-directory atomic rename; tests cover missing/corrupt state, path safety, round-trip, and concurrent revision ordering. `grid-state-snapshot.js` now serializes/restores cycle maps, order intents, current BUY, fill ledger, trailing state, and configuration fingerprint while deliberately rebuilding derived accounting maps from the ledger. The store and snapshot restore are already wired into startup and state-changing operations. This is explicitly deferred for the first milestone: remove the restore dependency from the in-process execution path and keep this work isolated for the later restart phase. Existing snapshot tests are not all passing.
- [~] **GRID-045 — [Later phase] Add deterministic persisted order intents and uncertain-submit restoration.** In progress: `grid-order-intents.js` creates stable 36-character Binance-compatible client IDs, immutable PREPARED intents, acknowledgement checks against returned broker order identity, and FOUND/ABSENT/UNKNOWN recovery decisions. `grid-order-execution.js` persists PREPARED intents before `createOrder`, submits using the deterministic client ID, attaches acknowledged BUY/SELL orders to state, and resolves found/absent/unknown outcomes without blind retries. Retry is permitted only for a PREPARED intent after the caller proves order-history completeness; an ACKNOWLEDGED intent missing from complete history fails closed. The execution boundary is already wired into `FreeRollBot` and requires persistence before and after order submission. That hard dependency conflicts with the first in-process-only milestone. Keep durable intent recovery in the later phase; decide separately whether deterministic client IDs remain useful in-memory.

### Stage G5 — Grid execution behind opt-in mode

- [~] **GRID-050 — Introduce cycle collection into pair state.** `gridCycles` is initialized in pair state and used by the prototype handlers. Grid mode is still rejected, so this is not a completed runtime contract.
- [~] **GRID-051 — Create one cycle after a fully reconciled BUY.** A handler exists and creates a cycle from canonical BUY fills after full-order reconciliation; it is unreachable until Grid mode is enabled and lacks end-to-end Grid tests.
- [~] **GRID-052 — Place independent SELL for each new cycle.** A per-cycle SELL handler and planner exist. Submission currently requires durable intent persistence, and pair-wide exposure/reservation integration remains incomplete.
- [~] **GRID-053 — Handle cycle SELL fills and completion.** A cycle-scoped fill/completion handler exists and checks reconciled quantity and net profit before free allocation; it remains unreachable and lacks multi-order integration coverage.
- [~] **GRID-054 — Replace a SELL within its owning cycle only.** A terminal-reconcile/close/replan path exists for the owning cycle. Reconnect handling and multi-cycle reservation tests are still missing.
- [~] **GRID-055 — Implement multiple independent BUY orders.** Initial BUY entry follows the approved maker/trigger distinction, but the current runtime has one `buyOrder` slot and rejects a second working BUY. Multi-BUY scheduling is an open design decision; do not invent it.
- [ ] **GRID-056 — Add Grid safety limits and exposure policy.** No cap is implemented. Define bounded quote exposure and/or live BUY count, including full possible exposure from every already-live BUY, before enabling repeated BUY placement.
- [ ] **GRID-057 — Reconcile Grid orders after an in-process user-data reconnect.** Enumerate every pending BUY and live cycle SELL, reconcile fills/status/reservations, isolate pair-specific failures, and resume only after verified-safe state. This does not require disk restore.
- [ ] **GRID-058 — Add fake-broker in-process multi-order lifecycle tests.** Prove multiple live BUYs and independent SELLs, arbitrary completion order, partial fills, cancel/fill races, duplicate events, and pair-scoped fail-closed behavior without restarting the process.

### Stage G6 — Later phase: persistence, restoration, and migration hardening

**Deferred beyond the first working Grid milestone.** Do not block the initial in-process Grid implementation on persisted state restoration or restart recovery.

- [ ] **GRID-060 — Integrate all-cycle startup reconciliation.** Reconstruct every cycle, BUY/SELL order, fill, commission, reservation, and free allocation before the pair can become ACTIVE.
- [ ] **GRID-061 — Add persisted restart/crash recovery.** Reconstruct all cycles, orders, fills, commissions, and reservations from durable state plus broker evidence. This remains later-phase work and is not a first-milestone gate.
- [ ] **GRID-062 — Define legacy-to-Grid activation boundary.** Require clean drain/reconciliation or implement a reviewed explicit conversion; never infer cycle ownership from aggregate quantity.
- [ ] **GRID-063 — Add adversarial model-based lifecycle tests.** Generate deterministic in-process event permutations (BUY A, BUY B, SELL B, SELL A; partial/cancel/replacement; duplicate/out-of-order fills). Restart-between-events scenarios belong to the later restore phase.
- [ ] **GRID-064 — Prove legacy mode remains unchanged.** Run all existing tests and explicit regression suite with mode absent/aggregated; compare expected order actions and accounting.
- [ ] **GRID-065 — Test Grid mode end-to-end with fake broker.** Validate two and three independent cycles, arbitrary SELL order, fees, base commission, quantity dust, insufficient funds, and all fail-closed paths.

### Stage G7 — Controlled testnet rollout and release gates

- [ ] **GRID-070 — Add a deterministic Grid simulation scenario.** Use recorded/synthetic price and fill events; no network required for unit tests.
- [ ] **GRID-071 — Run controlled testnet smoke tests.** Verify multiple independent open SELLs, cancellation/fill races, restart, and actual commission reporting with small quantities.
- [ ] **GRID-072 — Document operator runbook and rollback.** Include how to stop new BUYs, reconcile live SELLs, drain cycles, and return to aggregated mode only after a clean boundary.
- [ ] **GRID-073 — Approve Grid enablement per pair.** Require all prior gates, independent review of accounting/inventory/recovery, CI green, and explicit user approval. No live-money rollout is implied.

## 11. Required test matrix

| Scenario | Expected invariant |
|---|---|
| BUY A fills 100; BUY B fills 100 | Two cycles; SELL A and SELL B each independently target their own sellable quantity |
| BUY C fills while SELL A/B open | SELL A/B unchanged; cycle C gets its own SELL |
| SELL B fills before SELL A | Only B completes; A accounting and reservation unchanged |
| Duplicate BUY fill/completion event | One cycle and one SELL creation only |
| Duplicate SELL fill from stream/history | Applied once; cycle P&L unchanged on replay |
| SELL A partial fill | A remains incomplete; no free allocation |
| SELL A canceled after partial fill | A's proceeds/cost carry forward; only A may be replaced |
| Cancel result races with final fill | Final status/fills reconciled before replacement/reservation release |
| Base commission on BUY | Acquired/sellable quantity reflects actual net base quantity |
| Base commission on SELL | Actual remaining inventory and cycle completion reflect fee debit |
| Quote commission on BUY/SELL | Per-cycle recovery cost/net proceeds include actual eligible fee |
| Third-asset commission | Accounting incomplete; pair pauses; no conversion or new trading |
| Quantity-step rounding leaves dust | No oversell; dust remains explicitly accounted, not silently free |
| Two cycles reserve SELL quantity | Reservations do not overlap and do not exceed owned strategy quantity |
| Unknown broker open SELL | Pair cannot become ACTIVE or create new orders |
| Restart with N open SELLs | Every SELL maps to exactly one cycle; no aggregate collapse |
| Missing order/fill history | Pair pauses; no guessed recovery |
| Legacy mode config omitted | Existing aggregated behavior unchanged |
| Attempted mode switch with live orders | Rejected/paused until safe drain and reconciliation |
| Exposure cap reached with BUY still open | New BUY creation blocked; existing possible fill remains within explicit cap policy |

## 12. Definition of done for each PR

- The PR references one or more GRID roadmap IDs.
- Scope is limited to the stated item; no unrelated refactor.
- All functions use one object input and one object output where applicable.
- Prefer pure helpers with immutable inputs/outputs and deterministic tests.
- Use exact decimal strings for financial values; no Number-based financial decisions.
- Return validation/calculation outcomes using the repository's `toResult` convention where appropriate.
- Public exports are intentional; avoid circular dependencies and hidden cross-module imports.
- Existing legacy tests pass; new Grid tests cover success, failure, boundaries, duplicates, ordering, and immutability.
- Broker/exchange-specific payloads stay inside adapters.
- Actual fill and commission facts remain authoritative.
- No raw exchange messages in normal logs.
- Documentation and current-state notes are updated with verified facts.
- Required CI checks pass on the PR head, and the branch is up to date with its target before merge.
- Do not mark an item complete until its code is merged into `develop` and required checks pass.

## 13. AI agent instructions

Follow [`GRID-AGENT-INSTRUCTIONS.md`](./GRID-AGENT-INSTRUCTIONS.md) as the controlling workflow for this workstream. It overrides generic repository branch/PR rules for Grid.

- Gate A is audit/documentation only. No trading implementation is authorized until Gate C is closed and the user explicitly authorizes Gate D.
- All writes stay on `feature/bot-grid`; `develop` is read-only.
- No PRs (including drafts), no merges, no cherry-picks, and no edits to existing PRs unless explicitly requested by the user.
- Do not synchronize/rebase the work branch without explicit authorization; report divergence and dependencies instead.
- Do not change another package's source or create cross-domain issues during the audit/design gates.
- Keep this roadmap evidence-based and distinguish implemented-but-unreachable prototypes from verified working behavior.

**Current status (2026-11-01):** Gate A audit refreshed. The branch contains partial Grid runtime prototypes, but Grid remains rejected by configuration/constructor and is not executable. This audit changed documentation only; no trading behavior or source code was changed. CI is red; first-milestone design questions remain open.
