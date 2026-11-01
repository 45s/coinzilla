# Free-Roll V1 → Coin Farmer Behavior Map

**Reference:** `apps/bot-free-roll`  
**Successor:** `apps/bot-coin-farmer`  
**Purpose:** preserve approved strategy intent while independently designing and implementing CF.

## 1. What V1 tells us about the strategy

V1 is not a conventional grid bot. Its documented behavior is a coordinated accumulation/recovery cycle per market:

- Initial and ongoing market reference is last traded price.
- A next BUY limit is calculated from the initial reference or last qualifying BUY price using `priceStepPercent`.
- The bot normally maintains a standing BUY and a recovery SELL simultaneously when safe.
- A qualifying new BUY changes the active position and requires the old recovery SELL to be canceled and reconciled before a replacement is calculated.
- The recovery SELL must cover invested/recovery amount, all applicable fees and configured minimum net profit.
- `keepQuantity` is retained as free inventory per completed recovery cycle, not per BUY.
- Free inventory is permanently excluded from later strategy quantities.
- Actual fills and reported commissions are the source of accounting truth; order acknowledgement and configured fee rates are not actual execution facts.
- The current approved V1 policy waits for full order completion before advancing the strategy step, while still recording individual partial fills.
- The strategy does not guarantee a profitable fill or a completed sale; it must refuse unsafe/under-profitable actions.

Read the complete [V1 strategy specification](../../../bot-free-roll/README.md), not just this summary.

## 2. Source-of-truth order

For behavior discovery:
1. V1 `README.md`: approved strategy behavior and explicit open decisions.
2. V1 `ROADMAP.md`: safety invariants and engineering backlog.
3. V1 `CURRENT_STATE.md`: dated source audit; verify every finding against the current source.
4. V1 source/tests: evidence of implementation and regression scenarios, not automatic approval of every implementation behavior.
5. Repository `ENGINEERING_STANDARDS.md` and `AI_AGENT_WORKFLOW.md`: mandatory for CF.

If documents conflict, record the conflict and ask a focused question. Do not silently copy code behavior over a documented strategy rule.

## 3. Strategy rule mapping

| Area | V1 documented behavior / evidence | CF target | Status |
|---|---|---|---|
| Product strategy | Free-Roll accumulates free coins while recovering capital and covering fees | Describe as fill-driven accumulation/recovery, not grid trading | Carry forward as initial strategy scope |
| Market scope | Spot trading; market configured by trading symbol | Canonical Market with explicit base/quote assets; venue symbol mapping stays in adapter | Design target |
| Initial price | Last traded price is initial reference | Canonical last-trade observation with timestamp/quality | Preserve; freshness policy needs decision |
| BUY step | `referencePrice * (1 - priceStepPercent / 100)`; next reference is last qualifying BUY | Pure exact-decimal buy-price policy | Preserve |
| Standing orders | Maintain next BUY and profitable SELL together whenever state allows | Coordinator prevents duplicate orders/reservations and tracks each order independently | Preserve intended outcome; redesign workflow |
| BUY quantity | Configured `orderQuantity` | Exact Quantity and TradingRules validation | Preserve; decimal-string config |
| SELL price | Must meet cumulative recovery, actual fees and `minProfit` | One pure SELL approval function with exact breakdown/refusal codes | Preserve safety; audit detailed formula before coding |
| Free inventory | `keepQuantity` once per completed profitable recovery cycle | Separate permanently retained inventory bucket | Preserve |
| Partial fills | Record actual fills; do not advance strategy step until order fully filled | Fill ledger updates immediately; workflow waits for terminal/full order condition | Preserve |
| BUY fill before SELL | Cancel old SELL, reconcile final state/fills, recalculate and replace | Explicit cancel/reconcile/replace workflow | Preserve safety |
| SELL fill before next BUY | Verify actual net result; allocate free quantity only after full profitable recovery | Recovery-cycle completion transition | Preserve |
| Fees | Actual per-fill fee asset/amount; quote/base supported; third asset rejected/pauses if unexpected | Exact Commission entries with COMPLETE/PARTIAL/UNKNOWN semantics | Preserve safety |
| Market data | Last trade, not bid/ask substitute | Market-data port includes source time, stream health and stale/gap state | Preserve source; define quality thresholds |
| Manual wallet activity | Deposits/transfers/manual trades remain external; unexplained withdrawal/delta pauses market | External/unmanaged inventory bucket; never silently adopt | Preserve |
| Readiness | Six target states INITIALIZING, READY, ACTIVE, RECONCILING, PAUSED_UNSAFE, STOPPED | Explicit per-market state machine | Preserve state contract |
| Restart | Must reconcile; persistence still incomplete in V1 | Durable repository + broker reconciliation before live resume | Improve in successor; database TBD |
| Notifications | Optional Telegram for fill/pause/recovery/lifecycle events | Telegram adapter over canonical application events | Reuse existing package |

## 4. V1 implementation inventory to study

| V1 module | What it currently contains | CF learning target |
|---|---|---|
| `src/bot/bot-free-roll.js` | Large coordinator: lifecycle, per-market state, queues, stream handling, recovery, order orchestration | Identify use cases; do not copy as a single CF class |
| `src/bot/order-execution.js` | Order create/cancel/replace effects | Trading workflow and port boundaries |
| `src/bot/event-handling.js` | Price/user-data event intake and routing | Adapter mapping and application dispatch |
| `src/bot/fill-ledger.js` | Immutable fill facts, duplicate/conflict checks | Exact idempotent fill-ledger contract |
| `src/bot/fill-reconciliation.js` | Canonical fill acceptance and exact projection transition | Fill application workflow/domain accounting |
| `src/bot/market-inventory-ledger.js` | Per-market strategy and unmanaged inventory projections | Inventory ownership and conservation |
| `src/bot/inventory-allocation.js` | Free quantity allocation | Recovery-cycle domain rule |
| `src/bot/reconciliation-snapshot.js`, `recovery.js` | Snapshot validation, tracked-order/fill recovery | Recovery workflow and completeness contract |
| `src/bot/helpers/decimal.js`, `accounting.js`, `order-planning.js`, `trading-rules.js` | Exact arithmetic and strategy planning helpers | Reuse shared exact primitives; independently test policy |
| `src/index.js` | Resource composition, startup rollback, signal/shutdown ordering | Runtime lifecycle |
| `src/prepare-broker.js` | Binance WebSocket broker setup | Binance adapter implementation |
| `src/prepare-telegram-notifications.js` | Optional Telegram setup/event subscription | Telegram adapter |
| `src/prepare-journal.js` | Event journal setup | Journal adapter |

## 5. Reuse decisions

### Reuse shared public contracts

Current `@coinzilla/entities` exports include `Asset`, `Market`, `Money`, `Quantity`, `CanonicalOrder`, `Commission`, `Fill`, `Balance`, `TradingRules`, `BrokerCapabilities`, and `BrokerResult`. Review their current constructors/tests and use them where semantics fit. Do not duplicate them inside CF.

Current `@coinzilla/brokers` exports Binance WebSocket broker/config and `CoreBroker`. The latter is a base class, not automatically the final app port contract. CF's initial adapter should map the concrete broker into narrow CEX-neutral ports. A later shared broker-port proposal may be appropriate if multiple consumers need the same contract.

Current `@coinzilla/notifiers` exports Telegram notifier and subscription helpers. Use it behind CF's notification adapter.

Current `@coinzilla/event-bus` and `@coinzilla/journal` already serve V1. Use public APIs through adapters; do not treat the journal as durable strategy persistence.

### Reimplement app-owned behavior

Strategy decisions, application workflows, per-market state orchestration, and CF-specific state ownership belong to CF. They may be informed by V1 source/tests, but CF must not import V1 source at runtime.

### Do not copy known defects

V1's dated current-state audit reports gaps and regressions around financial Number conversion, fill/commission completeness, inventory ownership, cancellation races, and restart recovery at its audited ref. Recheck source before relying on each finding. CF should meet the exactness and fail-closed requirements directly, not reproduce known shortcuts for parity.

## 6. Behavior classification before implementation

Every discovered rule must be marked:

- **PRESERVE** — explicit, approved strategy rule; reimplement independently.
- **PRESERVE_OUTCOME_REDESIGN_MECHANISM** — preserve result but change architecture/mechanism.
- **FIX_AFTER_APPROVAL** — confirmed defect or unsafe behavior; document correction and obtain approval if semantics change.
- **REVIEW** — ambiguous or contradictory; no implementation until resolved.
- **DO_NOT_CARRY_FORWARD** — accidental/obsolete/unsafe implementation behavior; record reason.

Required mapping record fields:
- Rule ID.
- V1 document/module/test reference.
- Documented expected outcome.
- Observed current implementation outcome.
- Classification.
- CF module/workflow owner.
- Acceptance test(s).
- Decision/ADR reference if changed.

## 7. Open strategy decisions to resolve before dependent code

The V1 README/roadmap explicitly leaves some questions open. CF must not silently decide them:
- Market-data freshness thresholds, stale observation policy and stream-gap behavior.
- Sell-order replacement/repricing when no new BUY fills.
- Available capital and insufficient-funds behavior for the next standing BUY.
- Exact restart/reconciliation policy and required durable state.
- Cost-basis allocation details where V1 says not to redesign without discussion.
- Any change to the current full-fill-before-next-strategy-step rule.
- Any expansion beyond the initial accumulation/recovery strategy.

Resolve each only when it blocks a specific roadmap phase. Keep the question focused; do not bundle unrelated strategy redesign into architecture implementation.
