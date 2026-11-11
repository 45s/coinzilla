# Harvester Volatility Protection

- Status: **Protection implementation merged in PR #1041; initial ratio thresholds remain provisional pending offline historical validation**
- Tracking: [Harvester high-volatility protection #1016](https://github.com/45s/coinzilla/issues/1016)
- Related implementation: [Harvester candle history and ATR/NATR measurements PR #1037](https://github.com/45s/coinzilla/pull/1037) (data collection only)
- Related follow-up: [ATR-based adaptive price step #1013](https://github.com/45s/coinzilla/pull/1013)
- Owner: Harvester, with Brokers and Indicators package work

This document is the behavior and safety contract for Harvester's volatility protection. It does not change the authoritative [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md), recovery accounting, or existing order lifecycle rules.

## 1. Goal

When volatility becomes unusually high, Harvester must stop all new strategy activity for that market except the recovery SELL lifecycle.

It must:

1. Block new BUY orders and every non-recovery strategy action.
2. Cancel only Harvester-owned, acknowledged active BUY orders.
3. Preserve already resting recovery SELL orders exactly as they are; volatility alone must not cancel or reprice them.
4. Continue processing SELL fills, commissions, Portfolio/RecoveryLedger accounting and recovery completion.
5. Permit only the recovery SELL actions needed to protect and recover already-invested capital.
6. Resume ordinary strategy activity only after market data is reliable and volatility has remained below the recovery threshold for multiple completed candles.

Protection is per market. A volatile DOGEUSDT market must not pause an unrelated ZROUSDT market.

## 2. Protection states

| State | New BUY | Non-recovery strategy action | Recovery SELL | Meaning |
| --- | --- | --- | --- | --- |
| NORMAL | Allowed by normal strategy rules | Allowed by normal strategy rules | Allowed | Market data is ready and volatility is below the protection threshold. |
| PROTECTED | Blocked | Blocked | Allowed | High volatility or unreliable candle data has activated protection. Owned BUY cancellation/reconciliation is required. |
| RECOVERING | Blocked | Blocked | Allowed | Volatility is below the recovery threshold, but the required stable-candle count has not yet completed. |

PROTECTED and RECOVERING are distinct from the existing full strategy/accounting pause. Reusing the existing full-pause gate would also block recovery SELL submissions, which is explicitly not the intended behavior.

A market starts protected until its required candle history is loaded, validated, current and gap-free. A missing or invalid data condition immediately returns the market to PROTECTED and resets its stable-candle count.

## 3. Initial volatility model

The first Harvester consumer uses:

- Candle interval: **1 minute, UTC**.
- Closed candles only for indicator calculations and state transitions. Updates to the currently forming candle are not decision inputs.
- ATR period: **14**, using **Wilder smoothing**.
- Normalized ATR: **NATR = ATR / Close × 100**.
- Reference: the mean of the **previous 60 completed NATR observations**, excluding the current observation.
- Volatility ratio: **current NATR / reference NATR**.
- Startup history: retrieve approximately **100 completed candles per enabled market** to cover ATR warm-up and the reference window.

Illustrative initial thresholds, subject to offline historical validation before production enablement:

| Condition | Ratio | Action |
| --- | ---: | --- |
| Warning | >= 1.5 | Record warning diagnostics; trading remains subject to the pause threshold. |
| Protection | >= 2.0 | Enter PROTECTED; block new non-recovery actions and cancel owned active BUYs. |
| Recovery | <= 1.3 | Count one stable completed candle while all data remains valid. |
| Resume | <= 1.3 for 3 consecutive completed candles | Transition to NORMAL after cancellation/reconciliation is resolved. |

The thresholds are initial policy candidates, not calibrated production guarantees. They must be tested against representative historical data before the feature is enabled for unattended trading. A ratio between the recovery and protection thresholds does not resume a protected market; it resets the stable-candle count.

NATR is retained in diagnostics as well as the ratio. Raw ATR values must never be compared across symbols with different price scales.

## 4. Candle data pipeline

    Binance WebSocket API: klines (historical)
                     |
                     v
            @coinzilla/brokers
                     |
                     +-------------------------------+
                     |                               |
                     v                               v
          normalized historical candles     Binance @kline_1m stream
                     |                               |
                     +---------------+---------------+
                                     |
                                     v
                     Harvester candle history service
                       - validate / sort / deduplicate
                       - accept completed candles only
                       - detect gaps and stale data
                       - backfill after reconnect
                                     |
                                     v
                        @coinzilla/indicators
                          - ATR(14), Wilder
                          - NATR
                          - volatility ratio
                                     |
                                     v
                       Harvester protection policy
                        - per-market state
                        - thresholds / hysteresis
                        - central order-submission gate

### Broker capability delivered

The public @coinzilla/brokers API exposes historical and live candles through merged PR #1017. Harvester's application-owned BrokerPort and infrastructure adapter expose them through merged PR #1019. The runtime composes per-market history and indicator collection in merged PR #1037. The per-market protection state machine, central order gate and owned-BUY cancellation are implemented in PR #1041, pending merge. The normalized methods are:

- **getCandles({ symbol, interval, limit, startTime?, endTime? })** for historical data.
- **subscribeForCandles({ symbol, interval, onCandle })** for live updates.

The Brokers implementation uses the existing native WebSocket API klines request for history and the public Kline Streams subscription for live data. It uses Binance server time to determine whether a historical candle was closed at query time. No REST fallback or third-party SDK is used.

The normalized candle contract preserves symbol, interval, open/close timestamps in milliseconds, exact OHLCV decimal strings, and an isClosed flag. Historical completion is determined using Binance server time fetched immediately before the history request, not the local machine clock. Historical results must be validated and returned in ascending time order. The live stream may update a forming candle; Harvester commits it to indicator history only when Binance marks it closed.

### Indicators calculation capability

The Indicators package provides `calculateAtrSeries`, `calculateNatrSeries` and `calculateVolatilityRatio`. ATR uses a high-low first True Range, a simple-average seed and Wilder smoothing; NATR is ATR divided by the matching candle close times 100. Inputs are completed contiguous candles, with exact decimal-string prices and explicit interval milliseconds. Output scale and rounding are caller-configurable. The package does not select Harvester's reference window or thresholds. See the [Indicators API contract](../../../packages/indicators/README.md) and [roadmap](../../../packages/indicators/ROADMAP.md).

### Data integrity rules

- Deduplicate by market, interval and candle open time. Identical repeats are idempotent; conflicting facts for one candle identity fail closed.
- Require consecutive 1-minute open times. A gap or out-of-order sequence blocks new strategy activity until authoritative history backfills the gap.
- On stream disconnect, candle silence longer than one 1-minute interval plus a 5-second grace, malformed candle, or failed backfill, enter PROTECTED. This candle-feed window is separate from the 5-second market-price and order-book freshness gates; an order still requires fresh price and book data.
- After reconnect, backfill from the last accepted completed candle before treating the series as current.
- Never replace missing candles with zeros, interpolate OHLC values, or treat unavailable history as low volatility.
- Re-evaluate protection only on completed candles. A forming candle cannot count toward the three-candle recovery requirement.

### Runtime candle-history behavior

The current Harvester data service (merged PR #1037) subscribes to each enabled market's one-minute Kline stream before requesting 101 historical candles. It accepts only completed bars into the bounded 100-candle history and buffers live events during warm-up. A market needs 74 contiguous completed candles to produce 61 NATR observations: the current observation plus the 60-observation reference. The reference is the arithmetic mean of the previous 60 NATR values; the ratio is current NATR divided by that reference.

A valid current partial Kline update refreshes stream freshness but never enters indicator history. It can still reveal a missing completed interval: the service immediately marks that market unavailable, requests the exact bounded backfill, and restores readiness only after every missing completed candle is present. The forming candle itself is never appended. Closed candles are appended idempotently. Delayed events older than the retained history are ignored without refreshing freshness. Invalid history, a conflicting duplicate, unresolved gap, insufficient history, zero reference NATR, missing subscription or a candle stream older than one 1-minute interval plus a 5-second grace produces an unavailable per-market snapshot. The candle timeout is intentionally distinct from the 5-second price/book freshness checks used by the trading engine. Runtime consumers read it through `getVolatilityData({ symbol })`. During shutdown, the service stops accepting new callbacks and drains already-accepted candle/backfill work before broker disconnect; an unsubscribe error is still propagated, but cannot skip that drain.

Merged PR #1041 adds the per-market protection state machine, central submission gate, recovery-SELL purpose marker, owned-BUY cancellation/reconciliation and one-second freshness monitor. The candle-history service allows one 1-minute interval plus a 5-second grace before declaring the Kline feed stale; the independent 5-second market-price and order-book gates remain unchanged. The protection implementation is active in the runtime, but its initial ratio thresholds still require validation against representative offline history before unattended trading.

## 5. Order and accounting behavior while protected

### BUY cancellation

Use the existing Harvester-owned order registry and durable cancellation workflow:

1. Select only registered, acknowledged BUY orders in cancellable active states (OPEN or PARTIALLY_FILLED).
2. Do not cancel external/unowned orders.
3. Do not send cancellation for PENDING or UNKNOWN orders without first resolving their identity and authoritative state.
4. Durably record the cancellation intent before broker I/O.
5. Require canonical terminal order facts and reconcile all fills, including fills racing with cancellation.
6. If cancellation outcome, terminal status, fill history or accounting is uncertain, remain protected. Never assume the BUY was canceled and never blindly retry an uncertain request.

Volatility-specific cancellation behavior: a definite NOT_SENT result leaves the owned order OPEN and may be retried no more than once per five seconds (or on a new completed candle). An unconfirmed outcome is recorded as UNKNOWN and is not blindly retried; the market stays protected until authoritative reconciliation resolves it. If the registry cannot record UNKNOWN, or fill/accounting reconciliation fails, the existing full account-integrity pause remains in force. Otherwise, volatility protection does not activate the global pause, so known recovery SELL management can continue.

### Recovery SELL exception

- Existing recovery SELL orders remain resting at their current exchange price and quantity. Volatility protection alone does not cancel, replace or reprice them.
- Continue to process every SELL execution and actual commission exactly once.
- If cancellation of a BUY reveals additional executed quantity, account for it and permit the required recovery SELL.
- If a recovery SELL becomes terminal before recovery is complete, permit the normal reconciled recovery-SELL continuation/replacement required by the Conservative contract.
- Do not allow arbitrary SELL actions merely because their side is SELL. The strategy intent must carry an explicit recovery purpose through validation and the final submission gate.
- Do not alter the Conservative recovery price, fee reserve, keepQuantity, minProfit, dust or completion rules.

This means "pause trading" is not "stop managing risk": only the recovery SELL lifecycle remains active.

## 6. Central submission gate

Protection must be checked in the shared order-execution path:

- Check before pending-order registration.
- Check again immediately before broker submission.
- Cover every strategy/controller path, including future Aggressive, trailing and grid strategies.
- Require an explicit recovery-purpose marker for the SELL exception; do not infer permission from side alone.
- Keep normal exchange filters, account commitments, ownership checks and Journal durability barriers in force.

A strategy decision created before protection activates must not bypass the gate. If the gate defers it, do not leave a phantom PENDING order or release commitments incorrectly.

## 7. Resume rules

A protected market can return to NORMAL only when all conditions hold:

1. Candle history is sufficiently warmed up, current, valid and gap-free.
2. Three consecutive completed 1-minute candles have a volatility ratio at or below 1.3.
3. Owned BUY cancellation and any resulting fill reconciliation are resolved.
4. No unknown order outcome or accounting-integrity failure remains.

A new data gap, stale stream, invalid candle or ratio above the recovery threshold resets the stable-candle count and keeps protection active.

Volatility state is process-local in the first implementation. It is not a substitute for the separate [process-restart recovery workstream #654](https://github.com/45s/coinzilla/issues/654). Startup must warm and validate candle history before allowing new strategy activity; this feature does not make unattended process restarts safe.

## 8. Required regression tests

- Per-market isolation: one protected symbol does not stop another healthy symbol.
- Startup blocks BUYs until 100 valid completed candles are available.
- Correct ATR(14), Wilder smoothing, NATR and ratio against independent reference examples.
- Warning, activation, hysteresis, three-candle recovery and threshold-boundary behavior.
- Missing, stale, malformed, duplicate-conflicting, out-of-order and gapped candles.
- Stream disconnect/reconnect, historical backfill and repeated candles.
- Central gate blocks BUY and non-recovery SELL intents before and immediately before broker I/O.
- Explicit recovery SELL remains permitted while protected; arbitrary SELL is rejected.
- Only owned active BUYs are canceled; external orders and recovery SELLs are untouched.
- Partial BUY fills and cancel/fill races are reconciled and accounted exactly once.
- Unknown cancellation/submission outcomes keep protection active.
- Recovery SELL fills, commissions, replacement after terminal state and cycle completion continue correctly.
- Restart/warm-up behavior does not infer safety from absent prior process-local state.

## 9. Delivery order

1. [x] **Brokers:** normalized historical-candle and live-candle public contract, Binance adapters, and offline protocol/normalization tests — [PR #1017](https://github.com/45s/coinzilla/pull/1017).
2. [x] **Indicators:** reusable ATR, NATR and volatility-ratio API — [PR #1018](https://github.com/45s/coinzilla/pull/1018).
3. [x] **Harvester broker port:** application-owned historical/live candle methods — [PR #1019](https://github.com/45s/coinzilla/pull/1019).
4. [x] **Harvester market data:** startup history, bounded completed-candle series, freshness/gap detection and reconnect backfill — [PR #1037](https://github.com/45s/coinzilla/pull/1037).
5. [~] **Harvester protection:** per-market states, thresholds/hysteresis, freshness monitor, central submission gate, explicit recovery-SELL purpose and owned-BUY cancellation — [PR #1041](https://github.com/45s/coinzilla/pull/1041), pending exact-head CI and review.
6. [ ] **Verification and calibration:** complete the full regression matrix and validate the initial thresholds against representative offline historical market data before unattended production use.

No TESTNET/LIVE order, cancellation, restart or other exchange operation is authorized by these implementation steps. A separate controlled validation requires explicit operator approval.

## Related specifications

- [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) — authoritative recovery and order lifecycle rules.
- [Journal Operations](./JOURNAL_OPERATIONS.md) — existing durability and owned-order cancellation behavior.
- [Harvester roadmap](../ROADMAP.md) — current implementation priority.
- [Brokers README](../../../packages/brokers/README.md) and [Brokers roadmap](../../../packages/brokers/ROADMAP.md).
- [Indicators README](../../../packages/indicators/README.md) and [Indicators roadmap](../../../packages/indicators/ROADMAP.md).
- [Process-restart recovery #654](https://github.com/45s/coinzilla/issues/654) — separate, still-unimplemented workstream.
