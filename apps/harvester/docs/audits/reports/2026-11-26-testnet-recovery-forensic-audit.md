# Forensic evidence report — 2026-11-26 Conservative TESTNET recovery ledger

**Prepared:** 2026-11-27  
**Repository:** `45s/coinzilla`  
**Evidence mode:** read-only review of the immutable 2026-11-26 durable-facts capture and its manifest.  
**Primary tracking issue:** #1898. Related work: #1895, #1896, #1897, #1856, #1893.

> This report is deliberately self-contained. It contains the evidence required by engineers who cannot access the private raw-evidence store. No private repository URLs or paths are required or included. The raw evidence remains immutable; this document is a human-readable transcription and analysis, not a replacement for the original bytes.

## 1. Executive findings

1. The trading-facts runtime is `4b827393-0738-4de0-a2a8-a3942e7b7bec`, with facts from **2026-11-26T18:21:14.543Z** through **2026-11-26T21:14:49.596Z**.
2. The durable ledger contains **97 facts**, sequence 0–96, and 97 manifest checkpoints. Sequence numbers are contiguous; each fact's `previousDigest` matches the prior fact's `digest`; the final fact digest equals the final manifest `lastCommittedDigest`.
3. Fact counts: 25 submission intents, 25 submission outcomes, 15 cancellation intents, 15 cancellation outcomes, 8 applied fills, 2 incomplete recovery-cycle facts and 2 market-pause facts, plus genesis/configuration/process/preflight facts.
4. Four Conservative markets (DOGE, ZRO, ADA, LINK) recorded new BUY submissions while recovery SELL orders were acknowledged OPEN. The historical behavior is confirmed by the durable facts. It violated the operator-required target contract; **PR #1899 subsequently implemented and merged the no-new-BUY-until-cycle-complete rule**.
5. DOGE and ZRO each recorded a profitable SELL, then a `CONTINUE_SELL_THROUGH` incomplete-cycle fact, immediately followed by `RECOVERY_CYCLE_COMPLETION_FAILED` market pause. The ledger does not contain historical exchange filters or a sell-through attempt, so the reason that follow-up selling did not occur remains unproven. Track #1896.
6. ADA and LINK end with recovery SELLs acknowledged OPEN and no later terminal fact. Their state after the final ledger record is unknown.
7. There is no `PROCESS_STOPPED` or durable shutdown-completed fact in this ledger. Five BUY orders have recorded shutdown cancellations; those cancellations do not prove full shutdown completion or process exit.
8. The selected process logs are from a different runtime that failed during startup. Matching DEBUG/TRACE logs, process identity, source commit and completion record for the trading-facts runtime are absent. Do not attribute the failed-startup process to the trading facts.
9. The archive command's source commit and the failed-startup process commit are not the trading runtime's source commit. **Trading runtime source revision is UNKNOWN.**
10. The initial account-wide open-order audit found nine unowned orders and recorded readiness BLOCKED. That classification is not, by itself, proof of a global trading stop; the configured `externalOrdersPolicy` and per-market gate determine its effect.

## 2. Runtime identity and evidence integrity

### Trading-facts runtime

- Runtime session ID: `4b827393-0738-4de0-a2a8-a3942e7b7bec`
- First fact: `2026-11-26T18:21:14.543Z`
- Last fact: `2026-11-26T21:14:49.596Z`
- First sequence: `0`
- Last sequence: `96`
- Record count: `97`
- Final digest: `5c28c5acf2b71c309a811065a79654e47a1e3d36dacce33a85fbb194a54fcc93`
- Trading runtime source commit: **UNKNOWN** (no matching process identity record).

### Ledger counts

| Fact type | Count |
| --- | ---: |
| LEDGER_INITIALIZED | 1 |
| CONFIGURATION_BASELINE | 1 |
| PROCESS_STARTED | 1 |
| ACCOUNT_SNAPSHOT_CAPTURED | 1 |
| ACCOUNT_OPEN_ORDERS_CAPTURED | 1 |
| ORDER_SUBMISSION_INTENT | 25 |
| ORDER_SUBMISSION_OUTCOME | 25 |
| ORDER_CANCELLATION_INTENT | 15 |
| ORDER_CANCELLATION_OUTCOME | 15 |
| EXECUTION_FILL_APPLIED | 8 |
| RECOVERY_CYCLE_NOT_COMPLETED | 2 |
| STRATEGY_MARKET_PAUSED | 2 |
| **Total** | **97** |

All 25 submission outcomes are `ACKNOWLEDGED/OPEN`. All 15 cancellation outcomes are `CANCELED/CANCELED`. No submission rejection or unknown submission outcome is recorded.

### Chain validation performed

- Parsed 97 JSONL fact records and 97 JSONL manifest records.
- Fact sequences are contiguous from 0 through 96.
- Every fact carries the same trading runtime ID.
- Every fact's `previousDigest` matches the preceding fact's `digest`.
- Manifest record counts advance from 1 through 97.
- Final manifest checkpoint `recordCount=97` and `lastCommittedDigest` match the final fact's sequence and digest.
- This is a structural chain/manifest consistency check. It is **not** an independent recomputation of every SHA-256 digest.

### Configuration and process start

- Strategy name: `Harvester`.
- Enabled markets: ADAUSDT, DOGEUSDT, LINEAUSDT, LINKUSDT, ZROUSDT.
- Trading enabled: true.
- Configuration fingerprint: `56c553b6dbb8b9d1f58cb71c0635886472e6c49426f9dbd0fd4fba7c41e2f6d8`.
- Provider: Binance Testnet; provider instance: `binanceTestnet`; account: `binance-primary`.

### Initial account snapshot (seq 3)

Audit status `COMPLETE`, six assets:

| Asset | Free | Locked | Total |
| --- | ---: | ---: | ---: |
| ADA | 2439.2 | 0 | 2439.2 |
| DOGE | 25567.663 | 4385 | 29952.663 |
| LINEA | 32432 | 0 | 32432 |
| LINK | 56.346 | 4.08 | 60.426 |
| USDT | 7583.02784613 | 5.225 | 7588.25284613 |
| ZRO | 317.87 | 199.57 | 517.44 |

At seq 4, account-wide open-order audit recorded `orderCount=9`, `readiness=BLOCKED`, reason `UNOWNED_OPEN_ORDERS:9`:

| Market | Side | Quantity | Executed | Price | Broker order |
| --- | --- | ---: | ---: | ---: | --- |
| DOGEUSDT | SELL | 1196 | 0 | 0.07206000 | 1317237 |
| DOGEUSDT | SELL | 797 | 0 | 0.07169000 | 1323350 |
| DOGEUSDT | SELL | 1196 | 0 | 0.07170000 | 1333893 |
| DOGEUSDT | SELL | 1196 | 0 | 0.07111000 | 1377298 |
| LINKUSDT | SELL | 7.97 | 3.89 | 10.71100000 | 2213258 |
| ZROUSDT | BUY | 5 | 0 | 1.04500000 | 1052701 |
| ZROUSDT | SELL | 64.86 | 0 | 1.53600000 | 919870 |
| ZROUSDT | SELL | 64.86 | 0 | 1.45000000 | 957563 |
| ZROUSDT | SELL | 69.85 | 0 | 1.38400000 | 962249 |

The audit's BLOCKED value describes unowned-order readiness. The facts contain no `SAFETY_BLOCKER_RAISED` event in this run. Do not infer that the account-wide readiness label globally disabled all markets; verify the effective `externalOrdersPolicy` and the per-market startup gate before making that claim. No unowned order was adopted or modified.

## 3. Market-by-market order and fill evidence

### DOGEUSDT — CG_coinGrabber

Order progression (client suffixes are shortened only in prose; full stable prefix is shown):

| Sequence | Event | Order details |
| --- | --- | --- |
| 9–10 | BUY acknowledged | 400 @ 0.05685; broker 2076859; later canceled by trailing reprice (15–16) |
| 17–18 | BUY acknowledged | 400 @ 0.05696; broker 2076924 |
| 19 | BUY fill | 400 @ 0.05696; fill `binance:DOGEUSDT:309371`; 0.4 DOGE base commission |
| 20–21 | Recovery SELL acknowledged OPEN | 398 @ 0.05733; broker 2076944 |
| 22–23 | **New BUY acknowledged OPEN while SELL remained OPEN** | 400 @ 0.05693; broker 2076945 |
| 52 | BUY fill | 400 @ 0.05693; fill `binance:DOGEUSDT:309401`; 0.4 DOGE base commission |
| 53–54 | Prior SELL canceled | broker 2076944; reason `BUY_FILLED_RECALCULATE_RECOVERY_SELL` |
| 55–56 | Replacement recovery SELL acknowledged OPEN | 797 @ 0.05723; broker 2077476 |
| 57–58 | **New BUY acknowledged OPEN while SELL remained OPEN** | 400 @ 0.05690; broker 2077477 |
| 59 | BUY fill | 400 @ 0.05690; fill `binance:DOGEUSDT:309405`; 0.4 DOGE base commission |
| 60–61 | Prior SELL canceled | broker 2077476; reason `BUY_FILLED_RECALCULATE_RECOVERY_SELL` |
| 62–63 | Replacement recovery SELL acknowledged OPEN | 1196 @ 0.05719; broker 2077504 |
| 64–65 | **New BUY acknowledged OPEN while SELL remained OPEN** | 400 @ 0.05687; broker 2077505 |
| 74 | SELL fill | 1196 @ 0.05719; fill `binance:DOGEUSDT:309425`; gross 68.39924 USDT; quote commission 0.06839924 USDT |
| 75 | Recovery incomplete | activeQuantity 2.8; keepQuantity 1; buyCost 68.316; netSellProceeds 68.33084076; realizedNetProfit +0.01484076 USDT; `CONTINUE_SELL_THROUGH` |
| 76 | Market paused | `RECOVERY_CYCLE_COMPLETION_FAILED` |
| 91–92 | Shutdown BUY cancellation | broker 2077505; acknowledged CANCELED |

The three BUY fills were each 400 DOGE gross, with 0.4 DOGE base commission each. The final SELL was 1196 DOGE. The recovery fact reports 2.8 DOGE residual above keepQuantity 1. No contemporaneous exchange filter snapshot exists to prove whether the 2.8 DOGE was executable at that time.

### ZROUSDT — CG_coinGrabber

| Sequence | Event | Order details |
| --- | --- | --- |
| 7–8 | BUY acknowledged | 5 @ 1.072; broker 1060482; later canceled by trailing reprice (24–25) |
| 26–27 | BUY acknowledged | 5 @ 1.083; broker 1060555; later canceled by trailing reprice (36–37) |
| 38–39 | BUY acknowledged | 5 @ 1.084; broker 1060566 |
| 40 | BUY fill | 5 @ 1.084; fill `binance:ZROUSDT:16341`; 0.005 ZRO base commission |
| 41–42 | Recovery SELL acknowledged OPEN | 4.98 @ 1.092; broker 1060669 |
| 43–44 | **New BUY acknowledged OPEN while SELL remained OPEN** | 5 @ 1.083; broker 1060670 |
| 45 | SELL fill | 4.98 @ 1.092; fill `binance:ZROUSDT:16344`; gross 5.43816 USDT; quote commission 0.00543816 USDT |
| 46 | Recovery incomplete | activeQuantity 0.015; keepQuantity 0.01; buyCost 5.42; netSellProceeds 5.43272184; realizedNetProfit +0.01272184 USDT; `CONTINUE_SELL_THROUGH` |
| 47 | Market paused | `RECOVERY_CYCLE_COMPLETION_FAILED` |
| 89–90 | Shutdown BUY cancellation | broker 1060670; acknowledged CANCELED |

The 0.015 ZRO residual is above keepQuantity 0.01. The facts contain no contemporaneous minQty, stepSize or minNotional evidence, so whether it was executable is UNKNOWN.

### ADAUSDT — CG_coinGrabber

- BUYs 50 @ 0.1492 (broker 869693), 50 @ 0.1497 (869771), and 50 @ 0.1502 (869987) were acknowledged then canceled during trailing repricing.
- BUY 50 @ 0.1507 was acknowledged (broker 870308, seq 68–69) and filled at seq 77; fill `binance:ADAUSDT:156191`; quote cost 7.535 USDT and base commission 0.05 ADA.
- Recovery SELL 49.9 @ 0.1522 was acknowledged OPEN (client `h-97ad040c6389483382e534-21`, broker 870419, seq 78–79).
- A new BUY 50 @ 0.1502 was then acknowledged OPEN while that SELL remained OPEN (client `...-22`, broker 870420, seq 80–81).
- The BUY was canceled during shutdown (seq 93–94).
- No terminal fact for recovery SELL broker 870419 exists in this ledger. Its state after the final record is UNKNOWN.

### LINKUSDT — CG_coinGrabber

- BUY 2 @ 9.209 (broker 3262388) and BUY 2 @ 9.244 (3262568) were acknowledged then canceled during trailing repricing.
- BUY 2 @ 9.272 was acknowledged (broker 3264224, seq 72–73) and filled at seq 82; fill `binance:LINKUSDT:339840`; quote cost 18.544 USDT and base commission 0.002 LINK.
- Recovery SELL 1.98 @ 9.426 was acknowledged OPEN (client `h-97ad040c6389483382e534-23`, broker 3264818, seq 83–84).
- A new BUY 2 @ 9.244 was acknowledged OPEN while that SELL remained OPEN (client `...-24`, broker 3264819, seq 85–86).
- The BUY was canceled during shutdown (seq 95–96).
- No terminal fact for recovery SELL broker 3264818 exists in this ledger. Its state after the final record is UNKNOWN.

### LINEAUSDT — RS_recoverySeller

- RS `RECOVERY_BUY` 7000 @ 0.001632; client `h-71402cfb36a9478682eb78-1`; broker 729691; acknowledged OPEN at seq 13–14.
- No fill is recorded.
- Shutdown cancellation intent/outcome at seq 87–88 records CANCELED.
- No LINEA sell or cycle-completion fact exists.

## 4. Financial totals and limits

| Market | Recorded realized net recovery profit | Residual active quantity | keepQuantity | Cycle state |
| --- | ---: | ---: | ---: | --- |
| DOGEUSDT | +0.01484076 USDT | 2.8 DOGE | 1 DOGE | Incomplete; sell-through requested, then paused |
| ZROUSDT | +0.01272184 USDT | 0.015 ZRO | 0.01 ZRO | Incomplete; sell-through requested, then paused |
| ADAUSDT | No SELL fill | Not terminally classified | Not established by cycle completion | Recovery SELL OPEN at last fact |
| LINKUSDT | No SELL fill | Not terminally classified | Not established by cycle completion | Recovery SELL OPEN at last fact |
| LINEAUSDT | No fill | N/A | N/A | Recovery BUY canceled |

Combined recorded realized net recovery profit for DOGE + ZRO: **+0.02756260 USDT**. This is not total account PnL. It excludes valuation of residual inventory, other account holdings, external orders and any unrecorded activity. Neither DOGE nor ZRO cycle is recorded as completed.

## 5. Separate selected startup-failure process — do not correlate

The selected log artifacts belong to runtime `9da4dfdf-d8d5-4087-b5cb-502e7606af44`, not the trading-facts runtime.

- Started: `2026-11-26T04:57:46.934Z`.
- Completed: `2026-11-26T04:57:49.365Z`.
- Exit code: 1.
- Runtime duration: approximately 2.4 seconds.
- Branch: `develop`.
- Source commit: `ef5f5e25b0994f244eb6b29b62f5d48235df4544`.
- Working tree: dirty.
- Startup error: `PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED`.
- Cause: `DURABLE_FACTS_COMMIT_UNCERTAIN`.
- Message: `Operational State record exists beyond the committed-head manifest journal`.

Stack:
- `verifyProcessStore` — `prepare-process-operational-state-store.js:110`.
- `prepareProcessOperationalStateStore` — same file, line 161.
- `acquireProcessStartupResources` — `src/index.js:627`.
- `runMainStartup` — `src/index.js:1164`.

The selected `harvester.log.gz` and `trace.log.gz` have identical compressed size (944 bytes) and identical SHA-256 (`7fde9f3a1fc96f1b0ef39d57bb1881b7f5ea6c44ac32d96a0297b17ba5a8fdac`). They decompress to the same single structured startup-failure record. This is a duplicate artifact, not an independent trace stream. The terminal capture is 190 compressed bytes and contains a truncated startup-failure line.

There is no matching log session, process identity or process-completed record for trading runtime `4b827393-0738-4de0-a2a8-a3942e7b7bec`. Do not infer that the startup failure caused the trading ledger's recovery behavior. Do not attribute either process's source commit to the other.

## 6. Shutdown and end-state evidence

The last five BUY orders were canceled with explicit intent/outcome pairs:

- LINEA broker 729691: seq 87–88.
- ZRO broker 1060670: seq 89–90.
- DOGE broker 2077505: seq 91–92.
- ADA broker 870420: seq 93–94.
- LINK broker 3264819: seq 95–96.

No durable `PROCESS_STOPPED`, `SHUTDOWN_COMPLETED`, final account snapshot, final open-order audit or terminal process-exit proof exists in this 97-fact ledger. Two recovery SELLs (ADA 870419 and LINK 3264818) have no terminal outcome. Therefore:
- cancellation of the five BUYs is confirmed;
- final state of the two recovery SELLs is unknown;
- completion of all shutdown participants is unknown;
- durable process stop and OS process exit are not proven.

## 7. Issue ownership and required next work

### #1895 — no-new-BUY-until-cycle-complete

The old runtime confirms the previous behavior: four CG markets submitted new BUYs while their recovery SELLs were acknowledged OPEN. The operator-required rule is now reflected in the authoritative domain specification and was implemented in merged PR #1899 (merge commit `95d9ab2d25aba6dee18f258ff1c8caac1312d865`). PR tests cover strategy policy, final application submission gate, pre-existing BUY/late-fill races, repeated/re-entrant evaluation and DOGE/ZRO/ADA replay. The PR reports all six required workflows passing on exact head `6e903a822bbd3539e8f7168fab81278a0d4d7315`. This source fix does not retroactively change the historical ledger.

### #1896 — residual inventory and sell-through

For ZRO, seq 46 records activeQuantity 0.015, keepQuantity 0.01 and `CONTINUE_SELL_THROUGH`; seq 47 pauses the market. For DOGE, seq 75 records activeQuantity 2.8, keepQuantity 1 and `CONTINUE_SELL_THROUGH`; seq 76 pauses the market. The ledger has no filter snapshot, evaluated residual notional, dust classification, or follow-up SELL intent. Determine why continuation did not execute or whether filters made the excess unsellable. Preserve exact historical unknowns.

### #1897 — matching runtime logs

The selected logs belong to the unrelated 2.4-second startup-failure runtime. The facts runtime has no matching DEBUG/TRACE, process identity or completion record. Duplicate Harvester/trace artifacts have identical hashes. Update archive tooling to select matching sessions or report matching logs unavailable; preserve independently valid mismatched evidence without correlating it.

### #1856 — separate startup verification failure

The 04:57 startup failure is a distinct runtime with a distinct source revision and no connection proven to the 18:21–21:14 trading facts. Investigate the uncertain-commit restart scenario in isolated fixtures. Do not repair or rewrite the original Operational State Store.

### #1479 / #1362 / #1743 / #1827

Use this evidence to reassess shutdown terminal-proof requirements, recovery lifecycle completion, operational-state projection integrity and duplicate-SELL safeguards. Do not close these issues based solely on this ledger; map each claim to its own source-level cause and regression tests.

## 8. Confirmed facts versus unresolved questions

**Confirmed from durable facts / manifest**
- Runtime identity, timestamps, 97 fact/manifest records, sequence continuity and matching final committed digest.
- Submission/cancellation counts and outcomes.
- All order details, broker IDs, fill IDs, quantities, prices, commissions and cycle/pause facts listed above.
- DOGE/ZRO continuation facts immediately followed by market pauses.
- ADA/LINK recovery SELLs lack terminal facts in the ledger.
- No process-stopped/shutdown-completed fact exists in the ledger.
- Nine unowned orders were present in the initial account-wide audit.

**Confirmed from the selected other-runtime process artifacts**
- Runtime ID, process start/completion, source commit, dirty worktree, exit code, startup error and stack.
- Harvester and trace compressed files have identical hashes/content.

**Unknown / not established**
- Trading-facts runtime source commit and matching logs.
- Why the residual sell-through continuation led to a pause.
- Historical exchange filter values and whether 2.8 DOGE / 0.005 ZRO excess was sellable at the relevant time.
- Current exchange status of ADA SELL broker 870419 and LINK SELL broker 3264818.
- Final account snapshot, complete shutdown participant outcomes, durable STOPPED fact, process exit and lock release.
- Total account PnL.

## 9. Safety and immutability

This was a read-only forensic review. No exchange account query, order submission/cancellation, process restart/termination, lock deletion, database repair, facts rewrite, manifest rewrite or operational-state mutation was performed. Do not perform any such action without explicit operator authorization.

## 10. Recommended issue execution order

1. #1896 — trace continuation-to-pause and prove filter/dust handling; the no-new-BUY fix is already merged.
2. #1897 — improve future archive runtime matching and explicit missing-log reporting.
3. #1856 — separately reproduce and fix the uncertain durable-facts startup verification case.
4. Reassess #1479, #1362, #1743 and #1827 using only their relevant evidence and source-level tests.
