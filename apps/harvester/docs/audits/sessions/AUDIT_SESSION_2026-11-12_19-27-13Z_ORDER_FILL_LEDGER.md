# Critical order and fill ledger — 2026-11-12/13 LIVE session

Source journal SHA-256: eda24e8de6beb553377f63ba1bb807fb3e71cb549ad0052fe289c53418c911ca

The journal contains the full 110-order / 59-fill event history. This ledger records the decision-critical orders, fills, cycle outcomes, and unowned preflight orders. The raw journal hash above is the replay source for every other order transition.

## Last-observed Harvester orders at shutdown

| Market | Broker order | Side | Price | Original quantity | Executed | Remaining | Last state |
|---|---:|---|---:|---:|---:|---:|---|
| LINKFDUSD | 616636435 | SELL | 9.99 | 19.99 | 0 | 19.99 | OPEN |
| ADAFDUSD | 780132095 | SELL | 0.172 | 359.9 | 0 | 359.9 | OPEN |
| WLDFDUSD | 341640866 | SELL | 0.2978 | 219.9 | 0 | 219.9 | OPEN |

All three are LIMIT_MAKER orders. The closing account snapshot locked exactly 19.99 LINK, 359.9 ADA, and 219.9 WLD. No final open-orders payload was supplied, so OPEN is the last journal state, not a claim about current exchange status.

## Shutdown-racing BUY fills

| Market | BUY order | Trade ID | Price | Quantity | Quote | Fill UTC | Existing recovery SELL not recalculated |
|---|---:|---:|---:|---:|---:|---|---:|
| WLDFDUSD | 341640869 | 5779724 | 0.2885 | 20 | 5.77 FDUSD | 2026-11-13 03:51:24.400Z | 341640866 |
| ADAFDUSD | 780132097 | 16096399 | 0.168 | 30 | 5.04 FDUSD | 2026-11-13 03:51:25.088Z | 780132095 |

Shutdown started at 03:51:04.844Z. No cancellation request was recorded for either BUY or either affected SELL after shutdown began. Both fills were applied.

## Partial-fill reconciliation example

LINKFDUSD SELL order 616622279 filled in two trades:
- Trade 31352397: 2.59 LINK at 10.153; 26.29627 FDUSD.
- Trade 31352398: 3.40 LINK at 10.153; 34.52020 FDUSD.
- Total: 5.99 LINK and 60.81647 FDUSD; order reached FILLED.

## Order and cancellation totals

| Market | Submitted | Filled orders | Cancelled orders | Last-observed open |
|---|---:|---:|---:|---:|
| LINKFDUSD | 40 | 22 | 17 | 1 |
| ADAFDUSD | 43 | 22 | 20 | 1 |
| WLDFDUSD | 27 | 14 | 12 | 1 |
| **Total** | **110** | **58** | **49** | **3** |

- 49 cancellation requests had 49 matching confirmations; all had zero executed quantity at cancellation.
- 16 trailing-BUY cancellations were confirmed before the replacement BUY was submitted.
- 33 recovery-SELL cancellations were requested and confirmed during normal operation.
- 59 unique fills were applied once; 177 duplicate-fill notifications were recognised as duplicates (three per unique fill).
- All 59 broker execution reports show maker execution and BNB commission 0.00000000.

## Completed recovery cycles

| Market | Cycle completion UTC | Reported and fill-recalculated profit | Retained quantity |
|---|---|---:|---:|
| ADAFDUSD | 2026-11-12 19:52:21.301Z | 0.01272 FDUSD | 0.1 ADA |
| LINKFDUSD | 2026-11-12 19:52:51.012Z | 0.01112 FDUSD | 0.01 LINK |
| WLDFDUSD | 2026-11-12 19:53:25.045Z | 0.01174 FDUSD | 0.1 WLD |
| LINKFDUSD | 2026-11-12 20:46:18.319Z | 0.01087 FDUSD | 0.01 LINK |
| ADAFDUSD | 2026-11-12 21:26:53.482Z | 0.01261 FDUSD | 0.1 ADA |
| LINKFDUSD | 2026-11-12 21:35:40.236Z | 0.01056 FDUSD | 0.01 LINK |
| LINKFDUSD | 2026-11-12 23:34:22.484Z | 0.01039 FDUSD | 0.01 LINK |
| ADAFDUSD | 2026-11-12 23:46:02.871Z | 0.01252 FDUSD | 0.1 ADA |
| ADAFDUSD | 2026-11-13 00:52:50.892Z | 0.01242 FDUSD | 0.1 ADA |
| LINKFDUSD | 2026-11-13 00:53:50.401Z | 0.01247 FDUSD | 0.01 LINK |
| **Total** | **10 cycles** | **0.11742 FDUSD** | |

Each completed-cycle profit equals its SELL quote proceeds minus BUY quote cost from the journal fills. The remaining ADA/WLD/LINK cycles were still active at shutdown.

## Preflight unowned open orders

| Broker order | Client order ID | Market | Side | Price | Quantity | Preflight status |
|---|---|---|---|---:|---:|---|
| 341582782 | x-WEV89FW3VpEhIQEo6E2Ubwnmf1WKMQ | WLDFDUSD | BUY | 0.299 | 20 | NEW |
| 341582941 | x-WEV89FW3XQDRcUWLM0iHOtsR6HYJw | WLDFDUSD | BUY | 0.298 | 20 | NEW |
| 341582947 | x-WEV89FW3630XYjZpXEifXtuiuUn4LA | WLDFDUSD | BUY | 0.297 | 20 | NEW |
| 341582957 | x-WEV89FW3SH3VH79GSUyU7m9lBDSm3A | WLDFDUSD | BUY | 0.296 | 20 | NEW |
| 219411190 | h-2daf4e425a5247d0af4f45-147 | ZROFDUSD | SELL | 1.617 | 4.99 | NEW |

The four WLDFDUSD orders were later reported cancelled between 21:56:48.959Z and 21:57:06.590Z as unowned external events. The supplied files do not identify who cancelled them. The ZROFDUSD order had no cancellation event; 4.99 ZRO remained locked in the CLOSING balance snapshot.

For the four external cancellations, Binance execution reports use a generated cancel-request clientOrderId (web_...) and retain the preflight order ID in originalClientOrderId (x-WEV...). The unowned-order projection records the generated ID; brokerOrderId is the stable join key used here.
