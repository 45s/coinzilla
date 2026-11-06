# Conservative Strategy — Canonical Domain Specification

**AUTHORITATIVE SOURCE OF TRUTH.** Owner-approved Conservative Strategy contract.

**Scope:** Harvester Conservative decisions, position accounting, SELL economics, order lifecycle, and recovery completion.

**Change control:** Only this document defines Conservative Strategy rules. Every other document, issue, PR, test, and implementation note is a reference, implementation, regression, or historical record.

## 1. Authority and boundaries

This is the one and only authoritative definition of Conservative Strategy behavior in this repository. If any other artifact disagrees with this document, that artifact is stale and must be corrected or explicitly marked historical/superseded. Do not copy strategy rules into other documents.

The specification defines expected behavior. The implementation coordinates it through domain policies and application workflows:

- The domain calculates valid BUY/SELL intents and recovery economics.
- The application owns order submission, cancellation, exchange reconciliation, fill application, and serialized lifecycle transitions.
- The broker supplies authoritative order state, executions, commission facts, and exchange filters.
- Tests prove implementation conformance; they do not redefine the contract.
- The Mermaid diagram below is a derived algorithm visualization, not a second source of truth.

Restart reconstruction is explicitly outside this specification's active implementation scope and remains separately tracked in [#654](https://github.com/45s/coinzilla/issues/654).

## 2. Position and recovery accounting

A Conservative position is represented by two financial values:

- **quantity** — current strategy-owned base quantity. BUY fills add gross executed base less base-asset commission. SELL fills subtract gross executed base plus base-asset commission. Retained inventory is excluded from future strategy-sellable quantity once recovery completion allocates it.
- **spent** — the entire accumulated BUY cost for the current recovery position: gross executed quote notional plus quote-asset BUY commissions, plus the reliable quote value of any third-asset BUY commission. SELL fills do not proportionally reduce or erase this cost basis.

Confirmed fills are the only source of accounting changes. Apply every fill exactly once using its stable execution identity. A duplicate with identical facts is a no-op; conflicting facts under the same identity fail closed. Portfolio and recovery accounting must accept the same fill as one atomic logical transition.

Actual exchange-reported commission amount and asset are authoritative. Never infer actual fees from configured rates or order type.

| Confirmed execution | Position quantity | Recovery proceeds / cost |
|---|---:|---:|
| BUY | gross executed base less base commission | spent += gross quote + quote commission + valued third-asset commission |
| SELL | subtract gross executed base plus base commission | netSellProceeds += gross quote less quote commission and valued third-asset commission |

A third-asset commission is supported only when a reliable quote-currency valuation is available for that execution. If its asset, amount, or valuation is missing, stale, ambiguous, or unavailable, do not treat it as zero: fail closed before committing either accounting projection.

Base-asset commissions change position quantity. Quote-asset commissions change quote cost/proceeds. A BUY commission belongs in accumulated position cost; it is not added again to the later SELL commission.

Keep cumulative confirmed netSellProceeds with the current position's full spent basis until sell-through and completion are resolved. A replacement order never resets cost, proceeds, or fill identities.

## 3. BUY behavior

1. An enabled, valid pair with no active BUY may place its initial BUY one configured priceStepPercent below the first valid market reference, rounded down to the exchange price tick. Quantity is configured orderQuantity, rounded down to the quantity step.
2. The initial BUY trails upward according to the existing Conservative trailing policy. A trailing replacement requires acknowledged/cancellable order identity, cancellation, and complete fill reconciliation. Never place a replacement from stale quantity or an uncertain cancellation result.
3. Each actual BUY fill is accounted immediately. A partially filled BUY does not advance the completed-BUY lifecycle. Before advancing, reconcile the terminal order and all fills; their distinct executed quantities must match the broker's executed quantity and the order's original quantity.
4. The next standing BUY is fixed one configured step below the completed BUY's volume-weighted execution price (total executed quote divided by total executed base). It is not trailed while recovery is outstanding. Conservative trailing-BUY repricing is eligible only while active strategy position quantity is zero; retained free inventory is excluded from that gate. After successful recovery completion, the existing trailing behavior resumes.
5. Submit a required recovery SELL before the next standing BUY. Submit the next BUY only after the SELL has a successful broker acknowledgement. A failed or unknown SELL submission blocks the BUY and fails closed.
6. A standing BUY may coexist with an acknowledged open recovery SELL. Active PENDING, OPEN, PARTIALLY_FILLED, or UNKNOWN orders suppress duplicate intents.
7. Any configured investment/balance limit is an additional Harvester safety constraint. It must not alter position quantity, accumulated spent, or the full-cost recovery target.

## 4. Recovery SELL economics

The minimum realized net profit is at least 0.01 quote currency. In the configured USDT market this is $0.01. A value below 0.01 is invalid. Never intentionally close a recovery position at a loss or break-even.

Sell all exchange-sellable strategy inventory except the exact configured pair-level keepQuantity. This is the only retained-inventory setting name. Do not introduce coinToKeep or keepCoinQuantity.

Let:

- A = current strategy-owned position quantity before retained allocation;
- K = exact configured keepQuantity;
- f = applicable conservative SELL fee reserve as a decimal fraction;
- s = exchange quantity step;
- t = exchange price tick;
- C = the entire accumulated position spent;
- P = cumulative confirmed net SELL proceeds;
- m = configured minimum profit, with m >= 0.01.

Maximum planned SELL quantity, accounting for a possible base-asset fee and quantity-step rounding:

\[
Q = \operatorname{floorToStep}\left(\frac{\max(0,A-K)}{1+f},s\right)
\]

Remaining net quote proceeds required to recover the full accumulated cost basis plus minimum profit:

\[
R = \max(0,C+m-P)
\]

When Q > 0 and R > 0, the minimum SELL limit price is rounded up to the price tick:

\[
p = \operatorname{ceilToTick}\left(\frac{R}{Q(1-f)},t\right)
\]

Do not prorate C by the fraction of inventory being sold. Retaining K does not reduce the cost target. The SELL must recover the entire accumulated BUY cost plus at least m net after applicable SELL commissions.

When R = 0, the recovery profit target is already secured. Continue selling every sellable residual unit above K; price that residual using the validated current market reference rounded up to the tick, not an artificial one-tick price. Positive additional net proceeds must not reduce the already-realized aggregate profit. Actual commissions still determine final realized profit.

### Fee reserve and order type

Preserve the existing order-type selection policy:

- makerPercent = 0 selects LIMIT_MAKER (POST-ONLY). Its planning reserve is the configured maker fee.
- Non-zero makerPercent selects regular LIMIT. Because it may execute as maker or taker, its planning reserve is the higher applicable configured maker/taker rate.
- The applicable reserve is a planning estimate only. It is not an actual commission and must never be booked as one.
- The actual commission amount and asset reported on every confirmed fill determine accounting and final realized profit.

A POST-ONLY order must pass the existing fresh, same-symbol best-bid/best-ask crossing checks immediately before broker I/O. Missing, stale, malformed, crossed, or mismatched book data fails closed. The exchange remains the final POST-ONLY authority; do not silently convert a rejected POST-ONLY order into regular LIMIT.

### Exchange filters and dust

Every candidate SELL must satisfy current price, quantity, and notional filters, including tick size, quantity step, minimum/maximum quantity, and minimum/maximum notional.

Sell all quantity that can legally be sold above K. A remainder is EXCHANGE_CONSTRAINED_DUST only when the exact amount cannot currently satisfy the applicable quantity-step, minimum-quantity, or minimum-notional rules. Record its exact quantity and limiting filter. **Unsellable dust is retained as a bonus on top of configured keepQuantity.** If configured K is 1.00 and 0.04 is exchange-constrained dust, retain 1.04 total; do not discard it, force an invalid SELL, or treat it as sold. Dust is not a reason to keep submitting futile SELLs or to block completion once all other completion conditions pass. Preserve its quantity and accounting provenance when transferring the completed retained inventory.

A price-filter or fee-valuation failure is not dust; it is a blocked/unsafe decision and must fail closed.

## 5. SELL order lifecycle

### Partial SELL with no new BUY

When an acknowledged SELL is OPEN or PARTIALLY_FILLED and no new BUY fill has occurred:

- Keep the same exchange order and the same limit price.
- Do not cancel, replace, reprice, or recalculate its remaining quantity because of a partial fill.
- Apply every actual partial fill and commission exactly once to accounting.
- Let the exchange maintain the remaining quantity.
- Do not interpret a partial fill as recovery completion.

### New BUY fill while a recovery SELL is open — owner decision B

When a new BUY fill occurs while a recovery SELL is OPEN or PARTIALLY_FILLED:

1. Record the triggering BUY execution and its actual commission facts exactly once.
2. Request cancellation of the existing SELL. If it is still PENDING, wait for its broker acknowledgement and valid broker order ID; never cancel an unacknowledged order.
3. Reconcile the SELL's terminal exchange state and retrieve its complete canonical fill history, including every fill that raced with cancellation.
4. Validate ownership, market, side, order identity, unique fill identities, commission facts, and equality between summed distinct SELL fill quantity and broker-reported cumulative executed quantity.
5. Apply all newly discovered SELL fills exactly once and commit the BUY and SELL accounting updates consistently.
6. Only after terminal state and complete fill reconciliation succeed, calculate and submit a replacement SELL from the updated position quantity, full accumulated spent, and cumulative net SELL proceeds.
7. If cancellation, terminal state, fill history, commissions, or accounting cannot be reconciled completely, fail closed. Do not submit a replacement from stale or partial information.

If the SELL becomes FILLED while cancellation is in flight, reconcile and process it as a terminal FILLED order. Do not misclassify a successful terminal fill as a confirmed cancellation, and do not submit a duplicate replacement.

### Other terminal SELL outcomes

For FILLED, CANCELED, EXPIRED, and REJECTED orders, reconcile terminal status and all actual fills before taking another strategy action.

- FILLED does not by itself prove recovery completion. Distinct fill history must reconcile exactly to broker-reported executed quantity and original order quantity.
- A terminal CANCELED or EXPIRED order may be replanned only after its fills and commissions are reconciled and the remaining position is recalculated.
- A known REJECTED order has no assumed execution; verify any reported execution facts before a new valid intent.
- UNKNOWN status, unconfirmed cancellation, missing history, conflicting fills, or incomplete commission valuation pauses the pair and blocks replacement.

A replacement order never erases accumulated spent, net proceeds, or fill identities.

## 6. Recovery completion

Recovery is complete only when all of the following are true:

1. The relevant SELL order is authoritatively terminal and its complete distinct fill history reconciles to broker-reported execution facts.
2. Every BUY and SELL fill and every actual commission has been applied exactly once.
3. All exchange-sellable quantity above keepQuantity has been sold. Any remaining exchange-constrained dust is classified by exact quantity and limiting filter, then retained in addition to keepQuantity. The retained total is keepQuantity + dust (for example, 1.00 + 0.04 = 1.04); dust is not discarded, force-sold, or counted as sold.
4. Actual cumulative net SELL proceeds minus the full accumulated BUY spent are at least 0.01 quote currency.
5. The exact configured keepQuantity is preserved and is never sold.

Only after these conditions pass may keepQuantity plus any classified exchange-constrained dust be allocated as retained/free inventory, preserving the dust quantity and its accounting provenance, and the completed recovery basis be reset. If profit is below 0.01, fill history is incomplete, inventory accounting is inconsistent, or the full retained total cannot be preserved, fail closed and do not reset.

keepQuantity = 0 is permitted only after the complete workflow—including BUY, partial SELL, cancellation/reconciliation, terminal SELL, dust, profit verification, and exact-once completion—has passed end-to-end regression. Until then, fail closed at the precise unsupported boundary.

## 7. Workstation downtime and scope

Harvester runs on the owner's personal PC. 24/7 uptime is not required. Resting exchange orders may fill while the process is stopped; the stopped process cannot update in-memory state. This is expected, not a strategy defect.

Do not retroactively change historical shutdown snapshots. Safe process-restart reconstruction and reconciliation before new trading are a separate workstream in [#654](https://github.com/45s/coinzilla), outside this implementation scope.

No TESTNET order, cancellation, restart, or other exchange action is authorized by this specification.

## 8. Derived algorithm schema

The following Mermaid flowchart visualizes the rules above. If the diagram and prose ever differ, the prose in this specification controls.

\`\`\`mermaid
flowchart TD
  A[Confirmed BUY fill] --> B[Validate actual fill and commission facts]
  B --> C[Apply BUY quantity and full spent cost exactly once]
  C --> D{Recovery SELL open or partially filled?}
  D -- No --> H[Plan SELL from updated position and full accumulated cost]
  D -- Yes --> E[Request SELL cancellation; wait for acknowledgement if PENDING]
  E --> F[Reconcile terminal SELL state and complete canonical fill history]
  F --> G{Terminal state and every fill/fee reconciled?}
  G -- No --> X[Fail closed; no replacement]
  G -- Yes --> G2[Apply all raced SELL fills exactly once]
  G2 --> H
  H --> I[Calculate sellable quantity above exact keepQuantity]
  I --> J{Excess quantity satisfies quantity and minimum-notional filters?}
  J -- No --> K[Classify exact unsellable dust as retained bonus]
  J -- Yes --> L[Recover full accumulated spent plus at least 0.01 net]
  L --> M[Apply order-type-specific fee reserve and POST-ONLY checks]
  M --> N[Submit recovery SELL]
  N --> O{SELL event}
  O -- Partial fill; no new BUY --> P[Apply actual fill/fee; keep same order and same price]
  P --> O
  O -- New BUY fill while SELL open --> E
  O -- Terminal FILLED/CANCELED/EXPIRED/REJECTED --> Q[Reconcile terminal state and all actual fills/fees]
  Q --> R{Reconciliation complete?}
  R -- No --> X
  R -- Yes --> S[Update position quantity and cumulative net SELL proceeds]
  S --> T{Sellable quantity remains above keepQuantity?}
  T -- Yes --> H
  T -- No --> U{Only exchange-constrained dust remains above keepQuantity?}
  U -- Yes --> K
  U -- No --> W{Actual cumulative net profit at least 0.01?}
  K --> W
  W -- No --> X
  W -- Yes --> Y[Retain keepQuantity plus dust; complete once; preserve retained basis]
\`\`\`

**Change control:** Amend this document only when the owner explicitly changes a rule. Update implementation, tests, reference documents, and GitHub records to conform. Never create a competing Conservative rule definition.
