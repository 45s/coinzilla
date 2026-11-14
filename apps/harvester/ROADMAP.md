# Harvester Roadmap

> **Living roadmap:** Current priorities and blockers are maintained at the top of this file. Historical audit and implementation records are preserved in [the roadmap history archive](./docs/audits/ROADMAP_HISTORY.md); do not append new session logs or historical evidence here.

## Current safety priorities — LIVE-session audit findings

The 2026-11-12/13 and 2026-11-13 LIVE session evidence is preserved in the [2026-11-12/13 audit](./docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md) and [2026-11-13 audit](./docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md). These findings are current safety priorities; historical reports remain immutable evidence.

### P0 — Shutdown recovery coverage integrity

- [ ] **Prevent COMPLETE shutdown with stale recovery SELL coverage** — [#1097](https://github.com/45s/coinzilla/issues/1097). The earlier LIVE session confirmed late BUY fills after stopping began; the stopping guard skipped SELL recalculation and CLOSING still reported COMPLETE. Acceptance: account for each fill exactly once; reconcile/replan owned recovery SELLs against final Position and RecoveryLedger; validate remaining SELL quantity and expected proceeds; otherwise close INCOMPLETE/BLOCKED with actionable reasons. No ownership bypass or blind retry. The separate 2026-11-13 session did not reproduce this race; see its [audit finding F-048](./docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md#findings-and-dispositions). Do not mark complete until offline regressions, Harvester suite and exact-head CI pass.

### P1 — Runtime configuration and order isolation

- [ ] **Effective runtime configuration integrity** — [#1101](https://github.com/45s/coinzilla/issues/1101), related historical finding [F-046](./docs/audits/reports/AUDIT_FINDINGS.md#f-046--adafdusd-was-enabled-at-runtime-while-disabled-in-the-tracked-config). Record a sanitized effective-config snapshot or deterministic digest, audit enabled-market selection against it, and fail closed or explicitly block unexpected markets when integrity is unknown. Historical override cause remains unresolved.
- [ ] **Same-symbol external-order isolation** — [#1102](https://github.com/45s/coinzilla/issues/1102), related historical finding [F-047](./docs/audits/reports/AUDIT_FINDINGS.md#f-047--same-symbol-external-wldfdusd-orders-coexisted-with-strategy-orders). Keep manual orders unowned and untouched; block only affected symbols when policy requires; preserve unaffected-symbol operation; re-evaluate only from authoritative snapshots and established durability/reconciliation. The 2026-11-13 session had zero PREFLIGHT open orders and did not reproduce the collision.

### P2 — Session evidence and operational observability

- [ ] **Record local order-submission deferral outcomes** — [#1104](https://github.com/45s/coinzilla/issues/1104). Close the durable request lifecycle when broker I/O is not attempted; distinguish local deferral from rejection and ambiguous broker outcome.
- [ ] **Surface Telegram delivery failures** — [#1103](https://github.com/45s/coinzilla/issues/1103). Preserve non-blocking delivery and expose accurate accepted/delivered/failed/overflow evidence.
- [ ] **Explain shutdown phase latency** — [#1105](https://github.com/45s/coinzilla/issues/1105). Investigate the 128.047-second interval between shutdown-start and first visible reconciliation activity without assuming a cause.

All items remain open. A documentation PR or a clean offline audit does not establish runtime safety or authorize another unrestricted LIVE session.

## P2 — External trading-pair configuration

- [x] **Separate exchange-derived market precision from strategy pair settings** — completed in [PR #1117](https://github.com/45s/coinzilla), merge commit `ed6da096ff00cd1c362dab05ebd61a91d8c36cb4`. Strategy decisions remain in the single `apps/harvester/cg-coin-grabber.js` `tradingPairs` map; `pricePrecision`/`quantityPrecision` live in `apps/harvester/token-specification.json`, grouped by base asset with exact per-market entries. `config:symbol` updates only this registry; `loadAppConfig` enriches runtime pairs and fails closed on missing or ambiguous metadata. All seven exact-head GitHub Actions workflows passed; read-only Binance TESTNET integration was skipped. No trading behavior or exchange account operations were performed.

## P3 — Operational State Store source naming — COMPLETE

- [x] **Consolidate the Harvester persistence implementation under Operational State Store naming.** Renamed the application port, filesystem adapter, canonicalization/projector modules, related recovery use cases and tests; updated consumers and current architecture documentation. Preserved the ADR-0001 record schema, persisted identities, file protocol, permissions, locking and runtime behavior. No runtime-data migration or exchange operation was performed. Merged in [PR #1108](https://github.com/45s/coinzilla/pull/1108) as `c94a5489c1cc9de721b37879701a96cedc6ae399`; all eight exact-head GitHub Actions workflows passed.

---

## Proposed strategy — Recovery Seller (RS)

**Status: PROPOSED — RS-2 domain accounting is in progress; RS is not implemented, registered, configurable at runtime, or executable.** The product direction is recorded in [Trading Strategies — Recovery Seller](./docs/trading-strategies.md#recovery-seller-rs--proposed-strategy), the [Recovery Seller Domain Specification](./docs/domain/recovery-seller-domain-specification.md), and the [Recovery Seller Implementation Roadmap](./docs/domain/recovery-seller-implementation-roadmap.md).

- **Goal:** progressively reduce explicitly authorized legacy Spot inventory through recovery cycles. Each cycle acquires recovery inventory and may sell it with a configured legacy quantity only when the independent recovery and legacy profitability gates both pass.
- **Accepted input direction:** per-pair `sellQuantity` plus `legacyPosition.invested` and `legacyPosition.quantity`; RS calculates average historical cost itself. Example: 100 USDT / 50 ZRO = 2 USDT/ZRO. The full logical legacy quantity need not remain in Spot; EARN-held inventory is unavailable for Spot SELL until returned and authoritatively reconciled.
- **Concurrent operation:** RS and CG may run at the same time, including on the same market when both are enabled. They use a shared Portfolio that supports multiple independent Positions per market, with stable strategy/Position ownership and centralized quote/base custody and reservations through the shared Trading Engine. Positions are independent accounting units, not separate wallets; aggregate spendable inventory remains bounded by authoritative exchange balances. No blanket strategy mutual-exclusion lock or mandatory handoff is allowed.
- **Delivery order:** RS-1 Conservative source audit is complete (audit only; no code moved); RS-2 TDD accounting/custody/profitability is in progress, with strategy-owned Portfolio Positions, aggregate custody foundations and CG ownership-scoped consumers implemented; RS-3 pure RS policy; RS-4 concurrent CG/RS Trading Engine integration; RS-5 offline lifecycle verification. Shared-function extraction is not a standalone phase: extract only when RS has a concrete need, with characterization tests and CG regression coverage in the same change.
- **Remaining implementation decisions:** exact `sellQuantity` target/cap and residual handling; legacy authorization and opening-inventory accounting; historical-basis/proceeds/fee allocation; minimum recovery profit and third-asset fee valuation; BUY cadence and risk limits; pause/disable/resume lifecycle; deterministic resource allocation/fairness when concurrent strategies compete.
- **Safety:** no runtime wiring or exchange operations until the RS domain contract and implementation phases are complete and reviewed. Existing CG behavior remains unchanged.

## P0 — Telegram Command Center (CC) — delivered

**Status: [x] COMPLETE — CC-4 merged into `develop` in [PR #1088](https://github.com/45s/coinzilla/pull/1088) as `966141fbc1217d38f40e6e5faf84629251894a8c`; CC-1 through CC-3 were previously merged in PRs #1079, #1081, #1086 and #1087. Required exact-head CI and external documentation links passed.** The initial engine/application foundation remains in [PR #1045](https://github.com/45s/coinzilla/pull/1045), disabled-by-default runtime wiring in [PR #1067](https://github.com/45s/coinzilla/pull/1067), and process-lifetime scope clarification in [PR #1065](https://github.com/45s/coinzilla/pull/1065). ADR-0001 process-restart recovery Steps 8–9 remain explicitly deferred and are not implied by CC completion.

**Current baseline:** Telegram remains optional/disabled by default. CC-1 through CC-3 are delivered in PRs #1079, #1081, #1086 and #1087. CC-4 is delivered in merged [PR #1088](https://github.com/45s/coinzilla/pull/1088): Telegram command menu, authorized inline navigation/refresh, confirmation-gated market pause/resume controls, callback authorization/idempotency/retry/shutdown hardening and the operator runbook. The operator pause remains process-lifetime only and is not restored after restart.

### Delivery phases

1. [x] **CC-1 — Operator essentials:** delivered transport-neutral immutable read-only status/market queries and Telegram `/start`, `/help`, `/status`, `/markets`, `/pause SYMBOL`, and `/resume SYMBOL`. Runtime readiness and blockers, per-market price timestamps/freshness, pause ownership and volatility protection are visible. Resume clears only the operator-owned pause and retains all safety/recovery/volatility blockers. First command slice: [PR #1079](https://github.com/45s/coinzilla/pull/1079); read-only queries and status/markets: [PR #1081](https://github.com/45s/coinzilla/pull/1081).
2. [x] **CC-2 — Trading visibility:** merged in [PR #1086](https://github.com/45s/coinzilla/pull/1086) as `e39dc1f70a83dbaadfd39d224000ee1a2e69eeec`: authorized immutable application queries and Telegram `/positions`, `/orders`, `/balances`; active/free inventory separation; recovery-ledger metrics; explicit Harvester/external order ownership; account balance source timestamp and age. All seven exact-head workflows passed.
3. [x] **CC-3 — Proactive alerts:** delivered in [PR #1087](https://github.com/45s/coinzilla/pull/1087): startup and subsequent user-data readiness transitions, reconnect-before-reconciliation and recovery-failure alerts, blocked recovery-cycle alerts, and Telegram delivery diagnostics. All eight exact-head workflows passed. Reuse `@coinzilla/notifiers`; delivery remains best-effort and never blocks trading transitions.
4. [x] **CC-4 — Usability and hardening:** merged in [PR #1088](https://github.com/45s/coinzilla/pull/1088) as `966141fbc1217d38f40e6e5faf84629251894a8c`. Delivers Telegram command-menu registration; allowlist-protected inline navigation/refresh; enabled-market pause/resume controls with five-minute, one-time confirmation; callback identity, malformed/replay rejection, best-effort menu registration, bounded pending-confirmation lifecycle and graceful shutdown. The operator runbook and all architecture/roadmap indexes are current. The exact PR head `afda070a565f42e546bfb0a76096939427451111` passed 1,479/1,479 Harvester tests, all required workspace unit/coverage/syntax/dependency/actionlint checks, and external documentation-link validation. No TESTNET/LIVE exchange operation was performed; the read-only integration workflow was skipped.

### Engineering and safety gates

- TDD/DDD: define application query contracts before transport formatting; keep Telegram as a thin adapter; do not read engine internals or call the broker from Telegram.
- Named exports only; no default exports. Reuse existing application workflows and notifier infrastructure; no speculative shared packages or command bus.
- Each implementation commit includes focused tests and relevant docs/roadmap updates. Each phase is a focused PR into `develop`; phase completion requires merge and successful required checks on the exact PR head.
- Telegram remains disabled by default; private-chat allowlist and actor authorization remain mandatory.
- No order placement, cancellation, adoption, arbitrary broker mutation, configuration editing, strategy mutation, or safety bypass.
- No TESTNET/LIVE exchange operation is authorized or needed for CC.
- ADR-0001 Steps 8–9 are deferred; the current operator-pause process-lifetime limitation remains explicit until a separate proven restoration change is completed.

## P1 — Outbound Telegram notification icons

**Status: [~] IMPLEMENTATION IN PROGRESS in [PR #1099](https://github.com/45s/coinzilla/pull/1099).** Apply the user's reviewed emoji choices to every producer-backed Harvester Telegram notification. The formatter must select order-failure icons from the mapped operation and side, and account-safety icons from the mapped category. Exact selected and retained icons are documented in [Architecture — operational notifications](./docs/architecture.md#operational-notifications).

- Keep the five notifications without a replacement selection on their existing icons; do not invent choices.
- Exclude formatter-only successful submission/cancellation, broker-connected, and `order.filled` vocabulary because the current bridge has no producer mapping for them.
- Preserve the current event producers, policy, optional delivery isolation, and all trading behavior.
- [ ] Complete exact formatter and end-to-end Telegram assertions, documentation updates, and required exact-head CI; mark complete only after merge into `develop`.

---

## Harvester source quality and domain-logic audit — issue #1090

**Status: [x] COMPLETE in [PR #1091](https://github.com/45s/coinzilla/pull/1091); [issue #1090](https://github.com/45s/coinzilla/issues/1090) closes on merge.** The source-driven audit covered the 307-file JavaScript inventory under `apps/harvester/`, reviewed the durable-facts filesystem/canonicalization boundary and restart projection, added test-first regressions for three concrete contract defects, and reconciled the affected architecture, evidence, test-inventory and roadmap documentation.

- **Correctness fixes:** injected clocks accept `Date` or canonical UTC ISO-8601 strings; genesis and append capture the clock once, and each append reuses its captured timestamp for future-time validation and the record envelope. The canonical JSON boundary rejects negative zero before JSON serialization can normalize it. The durable-facts restart candidate validates operator-pause session placement but does not replay process-lifetime `OPERATOR_MARKET_PAUSED` facts; durable strategy pauses and safety blockers remain projected.
- **Pure boundary:** `durable-facts-canonical.js` owns bounded canonical JSON cloning/serialization, SHA-256 record digests, timestamp normalization and canonical string validation, with direct unit tests. The store retains filesystem ownership, append ordering, fsync/manifest commit protocol, idempotency and uncertain-write fail-closed behavior.
- **RED/GREEN evidence:** GitHub Actions reproduced the injected-clock and negative-zero regressions on test-only commit `af111b10147b1f9cceda818c5cb001fd6fcdd7c4`. A third test-only regression demonstrated operator pauses incorrectly entering restart candidates before the projector correction. Harvester tests passed 1,489/1,489 on the pre-lint-fix head; final exact-head verification is recorded by PR #1091.
- **Lint inventory:** the initial Harvester-wide ESLint run found 359 findings across 73 files: 295 `curly`, 38 `no-nested-ternary`, 7 `no-unused-vars`, 5 `prefer-const`, 4 `no-useless-escape`, 7 `no-control-regex`, 2 `no-empty-pattern`, and 1 `preserve-caught-error`. The 295 brace findings were identified as safe autofix candidates; the other 64 require deliberate review. They are intentionally not bulk-rewritten as part of this correctness audit. Track that separate, behavior-preserving cleanup in [issue #1092](https://github.com/45s/coinzilla/issues/1092). The temporary diagnostic probe was removed after collecting the inventory; it is not a permanent lint gate.
- **Scope and safety:** the Conservative Domain Specification remains authoritative. No strategy economics, exchange configuration, shared packages or other applications changed. Tests remain offline and credential-free; no TESTNET/LIVE connection, order placement, cancellation or account mutation was performed.

---

## Harvester source, domain correctness and documentation audit — issue #1093

**Status: IMPLEMENTATION COMPLETE; ready for review in [PR #1094](https://github.com/45s/coinzilla/pull/1094); merge pending.** The audit starts from current `develop` baseline `9989fea9f77f9ce4b506d4658f2ff1ddef516d83` (309 Harvester JavaScript files: 162 production and 147 test files). The PR head inventory is 312 files (164 production and 148 test files), including two independently tested pure domain guards. The domain-only inventory is 35 production files and 30 test files. Scope is `apps/harvester/**` and Harvester/project documentation only; no shared package, other application, trading economics, or runtime trading configuration changed.

### Confirmed defects corrected test-first

1. **Third-asset commission baseline ordering was reversed.** The workflow previously persisted `EXECUTION_FILL_APPLIED` before the targeted `COMMISSION_BASELINE`. It now records each required fee-asset baseline first, then the fill fact, then commits the in-memory Portfolio/RecoveryLedger projection. A baseline persistence failure does not discard a valid fill; the later account audit still fails closed when required evidence is absent.
2. **Targeted commission-baseline facts accepted invalid snapshots.** The durable-facts schema now requires a complete audit and exactly one fee-asset balance; empty, multi-asset, and incomplete targeted baselines are rejected.
3. **Normal user-data SELL fills did not forward terminal order evidence.** The normal `order-event-workflow` completion path now forwards the exact reconciled canonical SELL. The cancellation/reconciliation race and exchange-constrained dust paths also pass their canonical terminal SELL.
4. **Recovery completion could be evaluated without a canonical terminal SELL.** A shared pure guard requires `CanonicalOrder`, SELL side, FILLED status, broker identity, exact executed/original quantity equality, and matching market. Both durable completion recorders use the same guard.
5. **Dust evidence was insufficiently validated.** Exchange filter thresholds must be positive and evaluated values must satisfy the reason-specific contract. `MIN_NOTIONAL` requires a positive evaluated notional when evaluated quantity is positive; `QUANTITY_INCREMENT` accepts a zero rounded quantity only when the actual residual is smaller than one full step. Valid zero evaluation for a `MIN_QUANTITY`-limited residual remains supported; contradictory evidence fails closed.
6. **Fill accounting and cycle completion could race.** Both transitions now share one queue. Completion waits for earlier durable fill updates, stages both immutable projections, persists the cycle outcome, and only then commits the paired in-memory reset.
7. **Canonical timestamp validation was inconsistent.** A pure `isCanonicalNonNegativeSafeInteger` helper now rejects negative zero, negative, fractional, unsafe, and non-number timestamps. MarketPrice, MarketBook, AccountSnapshot, VolatilityCandle, account snapshot reconciliation, account fact recording, and market-history coverage use the same contract.
8. **Symbol configuration generation was unnecessarily restrictive.** Binance metadata retrieval now preserves available order types and pair configuration validates only the mode selected by the configured maker policy: zero maker assumption requires `LIMIT_MAKER`; non-zero uses `LIMIT`.
9. **Invalid `TRADING_MODE` silently selected TESTNET.** The symbol generator still defaults to TESTNET when unset, but rejects any explicitly configured value other than `testnet` or `live`.
10. **Small exchange-aligned quantities could fail numeric conversion.** The generator now expands JavaScript exponent notation before exact decimal comparison, preserving small values without accepting precision loss.
11. **Market-history and account-baseline use-case coverage was thin.** Regression tests now cover invalid ports/inputs, malformed record collections, regressing verification time, reconciliation failure/mismatch, incomplete audit evidence, non-durable append, failed/mismatched readback, and invalid baseline inputs.

### Test-first and verification evidence

- Test-only RED runs reproduced the targeted commission-baseline schema defects, missing terminal SELL evidence, contradictory dust evidence, negative-zero MarketPrice/MarketBook timestamps, and the start-harvester terminal-order forwarding regression.
- The Harvester suite passed **1,512/1,512** on verification commit `af0f32f8494c0aa51b95472bdbc0d1ed832185e9`. The coverage workflow passed at **81.45% line, 81.23% branch, and 80.63% function coverage**. This report aggregates Harvester with imported workspace packages (brokers, entities, event-bus, journal, notifiers, and utils); it is not an isolated Harvester-only metric. The aggregate remains below the 90% branch target noted in project guidance; Harvester has no package-specific threshold. Isolating and enforcing a 90% Harvester-only branch gate is a separate scoped task; no threshold was weakened or changed.
- Changed-file ESLint/syntax checks passed; no lint rules were weakened. The full workspace's existing style-only ESLint baseline is not bulk-rewritten here; behavior-preserving cleanup remains tracked separately in [issue #1092](https://github.com/45s/coinzilla/issues/1092).
- All six required `develop` checks and the advisory external documentation-link check passed on exact verification head `af0f32f8494c0aa51b95472bdbc0d1ed832185e9`: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies, actionlint, and Check external documentation links. The optional read-only Binance TESTNET integration was skipped.
- The PR updates the Conservative Domain Specification, architecture/recovery flow, broker port/adapter contract, accounting invariant matrix, domain test inventory, symbol-generator instructions, and a dated audit report. Documentation describes the implemented source behavior rather than planned behavior.
- Large-file modularity review and staged extraction plans are recorded in Section 7 of the audit report; no broad state-machine or durable-store rewrite was bundled into this correctness PR.

### Scope and remaining work

### Follow-up — isolated Harvester coverage gate

The current coverage workflow includes shared workspace dependencies, so it cannot report a clean Harvester-only branch percentage. Add an app-local coverage report and enforce the 90% branch target for Harvester in a separate focused task. Start with uncovered branches in the account snapshot manager, conservative engine/workflow, broker metadata adapter, and operational recovery scripts; keep each change behavior-preserving and test-first. This PR intentionally does not modify shared packages to raise the workspace aggregate.

- The full Harvester JavaScript inventory was enumerated; named-export scanning, test inventory, and lint results were used to map structural/style debt. High-risk accounting, durable-facts, recovery, market-data, configuration, and operational-script boundaries received the detailed source review. The remaining style-only lint baseline is deliberately separated from these correctness fixes; do not mass-autofix unrelated modules or weaken strict rules.
- No strategy economics, trading configuration, broker behavior, shared packages, or other applications changed.
- No Binance TESTNET/LIVE connection, account query, order placement, cancellation, or account mutation was performed.

---

## Startup reliability — account PREFLIGHT Journal barrier

**Status: [x] COMPLETE — fix merged in [PR #1084](https://github.com/45s/coinzilla/pull/1084) as `2238e3f8e64544be7952bd8bce5301336128279e`.** A broker-connected startup could fail after the account snapshot succeeded but while the mandatory account-wide open-orders audit was flushed. When Telegram notifications were enabled and the audit was BLOCKED across multiple symbols, the notification bridge emitted `symbol: undefined`; the Journal correctly rejected that derived event under its lossless JSONL contract. The same optional-field defect existed for user-data subscription-failure alerts, which have no market symbol. The merged fix omits unavailable optional symbols while preserving both safety alerts and the mandatory durable Journal barrier. Exact PR head `d61f7cce52bf5a46a89ad47019d18edf1b02805a` passed the Harvester suite (1,444/1,444), coverage, targeted tests and required workspace checks.

- [x] Confirm the failure with a real EventBus + Journal regression: the pre-fix multi-symbol safety alert fails with `Journal source event contains unsupported undefined at $["data"]["symbol"]`.
- [x] Omit `symbol` when a BLOCKED account audit has zero or multiple symbols, and when a user-data subscription failure has no market.
- [x] Verify both safety alerts remain emitted/delivered and the Journal flush is durable on the final exact PR head.

**Implementation verification on code commit `d61f7cce52bf5a46a89ad47019d18edf1b02805a` (before the final documentation-only sync):** Harvester unit tests passed 1,444/1,444; Harvester coverage passed at 80.73% line / 81.19% branch / 80.02% function; Harvester targeted tests, workspace tests, workspace coverage, Utils tests, JavaScript syntax, dependency audit, and External Documentation Links all passed. The PR remains unmerged pending the normal review/merge gate. No exchange operation was performed.

- **Safety invariant:** keep the PREFLIGHT account snapshot and account-wide open-orders audit mandatory; keep unowned-order classification and safety notifications intact; keep Journal's strict serializer and fail-closed durability barrier unchanged. Disabling process-restart recovery skips only recovery-specific ledger/projection work.

---

## Operator control — initial Telegram pause

**Status: IMPLEMENTED AND MERGED in [PR #1067](https://github.com/45s/coinzilla/pull/1067); engine/adapter foundation merged in [PR #1045](https://github.com/45s/coinzilla/pull/1045); process-lifetime scope/docs clarified in [PR #1065](https://github.com/45s/coinzilla/pull/1065); tracking issue [#1066](https://github.com/45s/coinzilla/issues/1066) is closed as completed.** The accepted contract is [ADR-0002](./docs/architecture/decisions/0002-transport-independent-operator-control.md), with the initial process-lifetime scope clarified in [ADR-0003](./docs/architecture/decisions/0003-process-lifetime-operator-pause.md) and implementation detail in the [operator-control design](./docs/architecture/OPERATOR_CONTROL_DESIGN.md).

- Telegram Command Center commands: `/start`, `/help`, `/status`, `/markets`, `/pause <SYMBOL>`, and `/resume <SYMBOL>`. Read commands are immutable application snapshots; state changes remain limited to the existing safe pause/resume use cases.
- Pause is market-scoped and separate from safety/recovery pauses. It suppresses new strategy BUYs and trailing-BUY replacements only; existing exchange orders remain untouched and may still fill. Fill accounting, reconciliation and recovery SELLs continue.
- The engine commits an operator-control record to the Operational State Store (ADR-0001 append-only ledger) before applying in-memory state. Journal is not the control-state store.
- **Process-lifetime limitation:** operator pause state is not restored after a process restart. The process starts without the previous operator pause; reissue `/pause <SYMBOL>` if it must remain paused. This is an explicit scope boundary, not a claim that restart recovery is complete.
- Telegram accepts only private-chat messages from configured allowlisted user IDs, processes updates serially and uses stable update IDs for retry idempotency. Outbound notification policy remains independent.
- [x] Engine pause/resume boundary, application actor authorization and append-only commit ordering — PR #1045.
- [x] Telegram `/pause` parser, private-chat allowlist and serial polling adapter — PR #1045.
- [x] TDD RED/GREEN: configuration-boundary regressions cover disabled-by-default behavior, canonical allowlists and malformed configuration; startup regressions cover missing credentials/path and invalid Operational State Store verification — PR #1067.
- [x] Runtime composition: verify the initialized Operational State Store before broker connection; start the allowlisted Telegram poller before trading subscriptions; stop polling before broker shutdown; abort startup and retry poller cleanup on Telegram identity failure — PR #1067. Process-session identity is passed from the process composition root and regression-tested.
- [x] Exact-head workspace CI passed on PR #1067 head `baf21f7ca4a42b6622d2282dda53e7d5c7c03699`: workspace tests/coverage, Harvester regressions, syntax/lint, docs links, dependency audit, actionlint, and Linux/Windows process-lock checks. The optional read-only Binance TESTNET integration was skipped. PR #1067 merged at `96293daa5ee3b831e55c49b56af22ce1857f936c`; no exchange operation was performed.
- [x] Telegram CC-1 command expansion merged in PR #1079; roadmap status correction merged in PR #1080.
- [x] Read-only runtime/market application queries, serialized immutable engine market snapshots, Telegram `/status` + `/markets`, and bootstrap/adapter regression coverage delivered in PR #1081. No exchange operation is performed.

**Out of scope:** projecting operator facts into startup state and restoring a pause after restart. These remain part of the separate ADR-0001 / issue #654 Steps 8–9 workstream and do not block the delivered process-lifetime operator-control capability.

---

## High-volatility protection — issue #1016

**Status: PROTECTION IMPLEMENTED; regression matrix, exact-head CI, candle-stream freshness correction (PR #1049), and local offline calibration CLI (PR #1046) are merged; representative historical threshold calibration remains open.** This is the immediate Harvester safety priority. The canonical behavior and delivery contract are in [Volatility Protection](./docs/volatility-protection.md).

- Per-market protection; one volatile pair must not stop another.
- Use completed 1-minute UTC candles, ATR(14) with Wilder smoothing, NATR, and a current/reference ratio against the previous 60 completed NATR observations.
- Load approximately 100 completed candles per enabled market at startup; maintain the series from live Kline updates and backfill gaps after reconnect.
- Missing, stale, invalid, insufficient or discontinuous candle data blocks new strategy activity. It is never treated as low volatility.
- While protected, block all new BUY and non-recovery strategy actions. Cancel only Harvester-owned, acknowledged active BUYs through the existing durable cancellation and fill-reconciliation path.
- Preserve resting recovery SELLs without volatility-driven cancellation or repricing. Continue SELL fills/accounting and permit only recovery SELL lifecycle actions needed to recover invested capital.
- Enforce protection centrally immediately before broker submission; identify recovery SELL intent explicitly rather than allowing every SELL.
- Initial ratio thresholds (warning 1.5, protect 2.0, recover 1.3 for 3 completed candles) are provisional pending offline historical validation.
- Do not alter Conservative recovery economics or imply process-restart recovery is complete. No exchange operations are authorized.

### Delivery order

1. [x] Brokers: historical candle retrieval and live Kline subscription, normalized public contract and offline tests — [PR #1017](https://github.com/45s/coinzilla/pull/1017).
2. [x] Indicators: parameterized ATR, NATR and volatility-ratio calculations in @coinzilla/indicators — [PR #1018](https://github.com/45s/coinzilla/pull/1018).
3. [x] Harvester: expose historical/live candle methods through the application BrokerPort and Binance adapter — merged [PR #1019](https://github.com/45s/coinzilla/pull/1019).
4. [x] Harvester: startup warm-up, live candle maintenance, freshness/gap detection, bounded reconnect backfill and ATR/NATR measurement snapshots — merged [PR #1037](https://github.com/45s/coinzilla/pull/1037). This delivers data collection only.
5. [x] Harvester: per-market protection state, central order gate, explicit recovery SELL exception, owned-BUY cancellation and freshness monitoring — merged [PR #1041](https://github.com/45s/coinzilla/pull/1041). All seven required workflows passed on exact PR head `e20d726b6707a0dbee0e5ae188b462a4427a16c3`.
6. [x] Offline regression matrix and exact-head CI — PR #1041 covers per-market isolation, fail-closed history, thresholds/hysteresis, owned-BUY cancellation, uncertain outcomes, recovery-SELL exception and order-gate behavior; all seven required workflows passed on the exact PR head.
7. [x] Correct the candle-stream freshness window to one interval plus five seconds, add quiet-stream regressions, and synchronize the contract/docs — merged [PR #1049](https://github.com/45s/coinzilla/pull/1049). Initial ratio-threshold validation against representative offline history remains open.
8. [x] Synchronize living documentation and roadmaps with merged implementation and remaining calibration work.
9. [x] Add the local-only offline calibration CLI, exact runtime metric/state replay, CSV validation and candidate-threshold options — merged [PR #1046](https://github.com/45s/coinzilla/pull/1046) at `6d103fb044939f9bab9cde766a548957f3948f4e`; all required exact-head checks passed.
10. [ ] Run the analyzer against representative multi-symbol historical data, review threshold trade-offs and accept or revise the provisional values. This is not complete until real archive data has been analyzed.

---

## Submission deferral diagnostics — issue #1025

**Status: IMPLEMENTED AND MERGED IN PR #1026 (2026-11-12).** The Conservative submission gate now preserves stable reasons and safe context when it intentionally withholds broker I/O. The operational reason catalogue and missing-order investigation procedure are maintained in [Submission deferrals and missing-order diagnostics](./docs/operations/submission-deferrals.md).

- Preserve `ok` as execution-use-case success, not proof of broker submission; callers and logs distinguish `deferred`, `deferralReason`, and acknowledged `submittedOrders`.
- Recheck all submission gates after durable PENDING registration; if readiness changes, remove the local PENDING record and do not call the broker.
- Keep `LIMIT_MAKER` fail-closed for missing/stale book data and crossing prices. Volatility data/protection reasons are explicit; the recovery-SELL exception remains purpose-specific.
- Regression tests cover structured reason propagation, post-registration PENDING cleanup, no-broker-call guarantees, and post-only crossing/freshness checks.
- Implementation and exact-head CI evidence are recorded in [PR #1026](https://github.com/45s/coinzilla/pull/1026); the original incident's exact historical gate reason remains unproven in [issue #1025](https://github.com/45s/coinzilla/issues/1025).

---

## Adaptive price step — volatility-adjusted spacing

**Status: PROPOSED — STRATEGY POLICY NOT FROZEN; NOT IMPLEMENTED.** This is a strategy enhancement proposal, not permission to change current trading behavior. The configured `priceStepPercent` remains the strategy baseline. Harvester may derive an effective step from a normalized volatility coefficient supplied by the shared [Indicators package](../../packages/indicators/README.md). The package now provides parameterized ATR, NATR and volatility-ratio calculations; adaptive-step reference-window, coefficient bounds, baseline-floor and order-replacement policy remain open.

### Intended behavior

- At reference volatility, the coefficient is neutral (`1.0`) and the effective step equals the configured baseline.
- When current volatility is 1.5 times its reference level, the illustrative coefficient is `1.5`; a baseline of `0.5%` therefore produces an effective step of `0.75%`.
- The configured baseline is never overwritten. The strategy consumes a derived effective value for the decisions explicitly included in the final scope.
- Whether lower volatility may reduce the baseline, or whether the baseline is a hard floor, remains an open policy decision.
- Calculate volatility independently for each market. Do not compare raw ATR values across symbols with different price scales.
- The indicator calculation must not know about Binance DTOs, order placement, Harvester positions, fees or strategy policy.

### Proposed calculation model (illustrative, not yet accepted)

Normalize ATR to the instrument's price level:

`ATR% = ATR / Close × 100`

Compare a current normalized ATR value with a reference value for the same market and timeframe:

`VolatilityCoefficient = CurrentATR% / ReferenceATR%`

Then derive:

`EffectivePriceStepPercent = ConfiguredPriceStepPercent × VolatilityCoefficient`

Example: configured step `0.5%`, reference ATR `1.0%`, current ATR `1.5%`; coefficient `1.5`, effective step `0.75%`. This is an example of the intended relationship, not a frozen formula or parameter set. Raw ATR is an absolute price movement and must not be multiplied directly into a percentage-based `priceStepPercent`.

### Ownership boundary

- The `@coinzilla/indicators` package owns exchange-neutral, deterministic indicator calculations over normalized candle data (ATR, NATR and volatility ratio).
- Harvester owns the policy: candle timeframe and history requirements, reference window, coefficient bounds/smoothing, fallback behavior, configuration, which strategy decisions use the value, and when orders may be recalculated.
- Brokers owns exchange-specific market-data retrieval and DTO adaptation. Indicator code must not import broker or exchange SDKs.
- Existing orders must not be silently repriced when a new indicator value arrives. Any order replacement policy must be separately specified and tested.
- Exchange tick/step filters remain authoritative after strategy spacing is calculated.

### Design questions to resolve before implementation

1. **Consumer reference:** rolling reference window and how the baseline adapts across market regimes.
2. **Timeframe and cadence:** candle interval, refresh frequency and whether the coefficient is stable between closed candles.
3. **Reference:** rolling reference window and how the baseline adapts across market regimes.
4. **Timeframe and cadence:** candle interval, refresh frequency and whether the coefficient is stable between closed candles.
5. **Coefficient policy:** exact ratio, neutral point, smoothing/hysteresis and treatment of sudden volatility spikes.
6. **Bounds:** minimum/maximum coefficient and effective step; decide whether low volatility can reduce the configured baseline.
7. **Fallback:** behavior for missing, stale, insufficient, invalid or discontinuous market data. Never silently treat unavailable volatility as zero.
8. **Strategy scope:** Conservative/Aggressive applicability and the exact BUY/SELL decisions affected.
9. **Observability/configuration:** diagnostics for baseline, indicator inputs, reference, coefficient, effective step and fallback reason; opt-in/disabled-by-default rollout.
10. **Validation:** historical/offline evidence, multi-symbol behavior, restart/recovery interaction, precision/tick-size and a separately approved TESTNET plan.

### Proposed delivery sequence

1. [x] Define the package boundary, completed-candle contract and exact-decimal calculation behavior in the Indicators package.
2. [x] Create the Indicators workspace package and public API for ATR, NATR and volatility ratio — [PR #1018](https://github.com/45s/coinzilla/pull/1018).
3. [ ] Submit a separate Harvester consumer change for configuration, strategy policy and effective-step integration.
5. [ ] Add regression coverage for multiple markets, invalid/stale history, bounds, smoothing, order lifecycle and unchanged behavior when disabled.
6. [ ] Validate against historical/offline market data; consider TESTNET only under a separately approved bounded plan.

**Safety constraints:** this roadmap item changes no runtime behavior. No coefficient, timeframe, period, bound or fallback is finalized. The feature remains unimplemented and disabled until the design, tests and acceptance criteria are agreed. No TESTNET/LIVE operation is authorized by this planning work.

---

## Operator tooling — interactive trading-pair configuration generator

**Status: IMPLEMENTATION COMPLETE — delivered in [PR #1012](https://github.com/45s/coinzilla/pull/1012).**

**Problem:** manually adding a pair requires looking up exchange-specific precision and trading filters. Guessing tick size, quantity step, minimum quantity or minimum notional can produce invalid configuration and rejected orders.

**Command:** `pnpm run config:symbol` (also available from the repository root through `pnpm --filter @coinzilla/harvester config:symbol`).

**Canonical destination:** merge the generated pair into `apps/harvester/config/strategies/cg-coin-grabber.js` at `CG_COIN_GRABBER_CONFIG.pairs.<SYMBOL>`. `config/index.js` composes this named strategy export into the single application-wide `appConfig`; do not create parallel runtime configuration boundaries.

**Operator inputs:** symbol, quote investment budget, `keepQuantity`, maker percentage, taker percentage, minimum profit (quote units), and price-step percentage; both are required strategy inputs because their values are market-specific and must not be guessed. Derive `orderQuantity` from the quote budget and a current public ticker-price snapshot, rounded down to the exchange step and capped by active maximum quantity/notional bounds. Derive price/quantity precision from Binance filters and check the reference price against active minimum/maximum price bounds.

**Safety and validation:**

- Use public, read-only Binance Spot `exchangeInfo` and `ticker/price`; select TESTNET (`https://testnet.binance.vision`) or LIVE (`https://api.binance.com`) explicitly. Default to TESTNET unless the shell's `TRADING_MODE` is `live`; no API credentials or order endpoints. Generate against the same environment Harvester will use because symbols/filters can differ. Reject active symbol/exchange filters outside the currently validated LIMIT/LIMIT_MAKER subset; ignore only filters exclusive to unsupported order types. Account-specific `myFilters` remain a runtime startup check because this generator intentionally requires no credentials. The preview records the public metadata source and fetch timestamp.
- Require an existing, actively trading Spot symbol and the LIMIT/LIMIT_MAKER order types used by Harvester.
- Preserve exact decimal strings while parsing inputs and calculating order quantity. Reject malformed/negative/non-finite values, invalid percentages, a budget below minimum notional, quantities below minimum quantity, and `keepQuantity` not aligned to `LOT_SIZE.stepSize`.
- Keep maker/taker assumptions as separate operator inputs; do not treat public exchange metadata as account commission data.
- Generate a complete pair object and validate the merged application configuration with the runtime `validateAppConfig` contract.
- New pairs are enabled by default. Refuse an already configured symbol; never silently replace an existing pair.
- Serialize writes under an exclusive lock and atomically replace `config/strategies/cg-coin-grabber.js`; preserve all existing pairs and unrelated strategy settings. On errors, leave the original config intact and clean up temporary files/locks owned by this invocation.
- Show the generated pair and exchange constraints for operator review before writing. Declining confirmation changes nothing.

**Implementation and verification checklist:**

1. [x] Inspect/reuse the canonical config loader/schema and public decimal utilities; keep the CLI and Binance adapter at the application tooling boundary.
2. [x] RED/GREEN — symbol/input validation, percentage boundaries, exact decimal sizing, exchange precision and min/max/notional boundaries.
3. [x] RED/GREEN — mocked Binance exchange-info/ticker responses, unsupported symbols/status/order types, malformed/duplicate filters, HTTP/JSON/network failures.
4. [x] RED/GREEN — complete config generation, runtime-schema validation, enabled-by-default behavior and existing-pair preservation.
5. [x] RED/GREEN — interactive confirmation/cancellation, atomic persistence, lock contention, malformed existing config and cleanup on failure.
6. [x] Register the package command; document prompts, defaults, generated fields, safety behavior and operator invocation.
7. [x] Run Harvester tests/coverage and all required repository CI on the exact PR head. No TESTNET/LIVE order activity is needed or authorized for this feature.

**Verification:** exact PR head `a680ad6e612d088c3565beae9b039618f1496a20` passed the full Harvester suite (1,025/1,025), workspace package tests, Harvester/workspace coverage, JavaScript syntax, actionlint, production dependency audit, Utils tests and external documentation links. The optional read-only Binance TESTNET integration workflow was skipped; no live/testnet trading or order placement was performed.

**Acceptance:** the operator supplies strategy-owned inputs without guessing exchange filters; the generator obtains and validates Binance Spot metadata, creates a complete runtime-valid enabled pair in the canonical config, and cannot silently overwrite existing pair settings or leave a partial config after failure.

## Process-restart recovery — small-step delivery plan (#654)

**Status: IN PROGRESS — Steps 1–7 complete; Step 8 Operational State Store record producers/barriers and offline candidate projection merged in PR #1055; Step 8 projection/invariant parity and account-wide readiness remain open; Step 9 crash/restart proof is pending. Runtime restart restoration remains disabled.** This plan is intentionally incremental: one small, reviewable PR per step, each with RED → GREEN tests and exact-head CI. Do not combine phases or enable recovery early.

**Current runtime configuration:** `strategies.CG_coinGrabber.settings.recovery.enabled` is explicitly `false`. The production entry point skips Operational State Store creation/verification and does not pass a recovery store into runtime startup. Keep it disabled until the remaining projection, exchange-reconciliation and crash/restart acceptance work is complete.

**Scope for the first safe version:** one Harvester process, one enabled market, deterministic offline tests, offline candidate projection/reconciliation, and a closed runtime startup gate. Runtime restoration is not enabled until Step 9 is accepted. Keep existing trading/domain behavior unchanged unless a specific regression proves a correction is required. No Binance/LIVE operations are part of implementation verification; any TESTNET exercise requires a separately approved, bounded plan.

### Delivery sequence

1. **[x] Step 1 — Freeze the recovery contract (docs/design only; merged in PR #1003).**
   - **Accepted:** [ADR-0001 — Application-owned durable facts for process-restart recovery](./docs/architecture/decisions/0001-application-owned-recovery-facts.md) defines the authoritative append-only fact stream, global sequence and committed-head integrity, minimum durable fact set, acknowledgement/failure boundary, candidate-state projection, closed readiness gate, external-order policy, and legacy Journal treatment.
   - **Authority boundary:** the Operational State Store port is the future restart-recovery authority; Journal remains a separate operational observer. Existing mandatory Journal PREFLIGHT/CLOSING and pre-side-effect order/cancel barriers remain unchanged until a separately audited migration. Domain code remains independent of Journal/EventBus/storage.
   - **State model:** persist immutable execution/order/cycle/control facts; derive Portfolio, Position, RecoveryLedger, active/free inventory, and reservations through the existing canonical accounting workflow rather than persisting competing mutable totals.
   - **Legacy boundary:** existing Journal sessions are forensic evidence, not automatically trusted complete history. A one-time baseline requires explicit operator-assisted reconciliation; unknown market-universe or retention coverage remains a hard blocker.
   - **Scope:** this is a documentation/design decision only. No runtime source, tests, configuration, exchange behavior, or restart readiness changed. PR #1003 is merged; Step 2's deterministic harness is merged in [PR #1014](https://github.com/45s/coinzilla/pull/1014); Step 3's recursive legacy-session discovery and chronology validation are merged in [PR #1015](https://github.com/45s/coinzilla/pull/1015).

2. **[x] Step 2 — Build a deterministic recovery test harness (tests only; PR #1014).**
   - Added `apps/harvester/test-support/recovery/recovery-crash-fixtures.js`, building deterministic two-session fixtures with canonical entities and the same lifecycle DTO mappers used by production publication.
   - Added `apps/harvester/test/recovery/recovery-crash-matrix.test.js` for crash cuts after order intent, broker acknowledgement, partial/final BUY fills, recovery SELL fill, cycle completion, unowned-order evidence, and strategy-pause publication.
   - Every crash cut asserts complete restored state: order identities/status/executed quantities, active/free/total inventory, Position cost basis and quote cash flow, RecoveryLedger totals and fill identities, applied fills, completed-cycle identity, pauses, reconciliation requirement, and session cleanliness.
   - The fixtures intentionally use the legacy Journal observer envelope to exercise the retained offline projector/restore path. They are **not** ADR-0001 durable facts and do not make Journal the recovery authority. No production source or runtime behavior changed.
   - Exact PR-head verification: Harvester unit and coverage jobs each report 991 passed, 0 failed; targeted Harvester tests, JavaScript syntax, dependency audit and the remaining required checks must pass on the final PR head.

3. **[x] Step 3 — Assess legacy Journal sessions and ordering deterministically (F-035, F-040; PR #1015 merged).**
   - [x] Recursively discover nested process-session directories and preserve legacy flat-file compatibility for forensic review and any explicitly approved one-time baseline assessment ([PR #1015](https://github.com/45s/coinzilla/pull/1015)).
   - [x] Use explicit durable chronology where available; never use random session IDs or second-resolution filenames as ordering authority ([PR #1015](https://github.com/45s/coinzilla/pull/1015)).
   - [x] Reject missing, unreadable, duplicated, or ambiguously ordered sessions; never interpret an incomplete scan as an empty history ([PR #1015](https://github.com/45s/coinzilla/pull/1015)).
   - [x] Do not promote legacy Journal records to authoritative restart state merely because discovery and parsing succeed; apply the baseline/reconciliation rules in ADR-0001.

4. **[x] Step 4 — Make replay understand every relevant fact (F-043, F-044; [PR #1023](https://github.com/45s/coinzilla/pull/1023)).**
   - [x] Classify all 30 declared Harvester event names as replay facts or explicitly ignorable diagnostics; preserve unowned-order, invalid-fill, and accounting-failure facts as sticky blockers. Unknown or source-unclassified events fail closed; blockers are restored as durable/effective market pauses.
   - [x] Accept `RECOVERY` account/open-order snapshots only after `harvester.started`, preserving PREFLIGHT → RECOVERY → CLOSING order and existing timestamp monotonicity.
   - [x] Add DTO → projection → restore parity tests for all three execution safety events, plus fail-closed, diagnostic allowlist, pre-start snapshot and reconnect phase regressions.
   - Exact PR head `f06304f9`: **1,019 Harvester tests passed, 0 failed**; all seven required workflows passed, including package/workspace coverage and external documentation links. TESTNET integration was skipped.

5. **[x] Step 5 — Preserve accounting facts exactly (F-038, F-039, F-041; [PR #1024](https://github.com/45s/coinzilla/pull/1024)).**
   - [x] Restore Position cost basis and RecoveryLedger atomically, with exact active/free inventory allocation; completed cycles reset basis while explicit residual sell-through preserves active inventory and cost basis.
   - [x] Preserve third-asset commission amount, asset identity, and historical quote valuation end to end; reconciliation of the related asset balance is required evidence in the Step 7 operator audit; it remains fail-closed until supplied and verified for the target market.
   - [x] Represent cycle completion explicitly. A full SELL without a proven completed/not-completed outcome fails closed. `CONTINUE_SELL_THROUGH` preserves active inventory; `BLOCKED` restores a market pause. A subsequent full SELL is accepted only after an explicit continue outcome, and completion pairs with the latest SELL identity.
   - Exact PR head `bdc1e6f`: **1,024 Harvester tests passed, 0 failed**; all six required workflows passed. TESTNET integration was skipped.

6. **[x] Step 6 — Add verifiable durable-fact integrity (F-037, F-042; [PR #1027](https://github.com/45s/coinzilla/pull/1027) merged).**
   - Implement the smallest durable store/port needed by the agreed contract, with explicit durability acknowledgement before dependent state transitions proceed.
   - Detect missing/reordered/duplicated records using a monotonic decimal-string sequence, canonical JSON, SHA-256 previous-record digest, and an append-only committed-head manifest journal.
   - Require explicit one-time genesis initialization; normal startup/verify/append never creates a missing ledger. Exact duplicate fact identity/payload is idempotent; uncertain commits fail closed.
   - The fact stream is fsynced before its matching manifest checkpoint is appended and fsynced; startup verification flushes both streams before publishing the verified head. This avoids per-append directory fsync/rename dependencies and supports regular-file sync on Windows.
   - Do not claim legacy Journal files are complete when they lack integrity evidence; require reconciliation or operator resolution for ambiguous history.

7. **[x] Step 7 — Offline one-market reconciliation and guarded coverage confirmation implemented (audit primitives PRs #1034/#1036; orchestration/confirmation PR #1047; offline CLI/evidence matrix PR #1053).**
   - [x] Separate one-market page exhaustion from historical retention coverage; require a durable retention-baseline fact whose covered-from time is no later than the query start. Never treat a caller-supplied `marketUniverseComplete` boolean as proof.
   - [x] Keep external open orders unowned and untouched; include their exact remaining reservations and report symbol-scoped blockers without blanket-blocking unrelated markets.
   - [x] Require every baseline/current asset and canonical market identity needed by the audit; missing evidence is unresolved, never zero.
   - [x] Persist and project the `MARKET_HISTORY_COVERAGE_CONFIRMED` fact through ADR-0001; enforce a monotonic per-symbol coverage interval and bind it to the reviewed evidence digest/verifier.
   - [x] The operator confirmation use case gates the coverage append on a READY audit in merged [PR #1047](https://github.com/45s/coinzilla/pull/1047); no Telegram command is added as part of Step 7.
   - [x] The read-only orchestration use case composes canonical owned-order identity/status reconciliation, per-market fill history, account balances and account-wide open orders in PR #1047.
   - [x] Deterministic orchestration/confirmation tests were merged in PR #1047.
   - [x] The offline JSON context adapter and explicit audit-only/confirmation CLI merged in [PR #1053](https://github.com/45s/coinzilla/pull/1053) at `a6dd3412b21daa85b9767164e3619ad45a4de777`. The production-audit end-to-end matrix covers READY, SKIPPED, incomplete history, mismatched market evidence, unowned-order isolation, durable-ledger failure, retry/idempotency and conflicting baseline behavior. All required CI checks passed on the merged PR head; Step 7 is complete on `develop`.

8. **[~] Step 8 — Restore behind a closed readiness gate (durable producers/barriers and offline candidate projection merged in [PR #1055](https://github.com/45s/coinzilla/pull/1055); parity and account-wide readiness remain pending).**
   - [x] Define and enforce canonical `ORDER_SUBMISSION_INTENT` and `ORDER_SUBMISSION_OUTCOME` payloads and add application recorders; preserve exact canonical market/order identities and decimal strings. The executor supports paired durable callbacks, removes a locally registered PENDING order when the pre-broker intent barrier fails, and blocks local acknowledgement when outcome persistence fails. `startHarvester` verifies an injected ledger before broker connection and wires order/fill producers; it never initializes a missing ledger. Production `main()` now creates and verifies the store before Journal/runtime startup, injects it into `startHarvester`, and fails closed when the ledger is absent or corrupt. Genesis remains a separate explicit one-time command.
   - [x] Persist canonical execution-fill facts, including every commission identity and historical quote valuation, before committing Portfolio/RecoveryLedger references; failed durability leaves both projections unchanged. `startHarvester` accepts the initialized store through dependency injection; `main()` verifies/injects the store; only the explicit genesis command may initialize an empty ledger.
   - [x] Define strict canonical `ORDER_CANCELLATION_INTENT` and `ORDER_CANCELLATION_OUTCOME` payloads and application recorders that preserve the expected owned order state and distinguish NOT_SENT/unknown/confirmed results. All three engine-owned cancellation paths now commit intent before the broker RPC and classified outcome before registry mutation; failure remains fail-closed.
   - [x] Persist eligible recovery-cycle completion facts with a deterministic cycle identity, exact fill/accounting boundary, and validated exchange-constrained dust evidence before resetting Portfolio or RecoveryLedger; failed durability leaves both projections unchanged.
   - [x] Persist a secret-free configuration fingerprint and process-start boundary before broker connection; append a clean process-stop boundary only after runtime shutdown completes. Production `main()` verification/injection is implemented; the explicit one-time genesis command is never run automatically.
   - [x] Define strict `ACCOUNT_SNAPSHOT_CAPTURED` and `ACCOUNT_OPEN_ORDERS_CAPTURED` schemas and deterministic negative tests for exact free/locked/total parity, asset completeness/counts, duplicate identities, open-order quantities/statuses, and readiness consistency. Add application recorders with immutable phase/source-time identities and exact-retry idempotency.
   - [x] Wire account snapshot recorders into `createAccountSnapshotManager`: durable-fact append must succeed before the existing Journal publication/flush/readiness barrier; preserve the Journal contract and fail closed on an uncertain append.
   - [x] Define strict operator/strategy pause-resume and sticky safety-blocker raise/resolution schemas; add application recorders with stable identities, explicit scope/reason, evidence digests, and a committed-raised-fact prerequisite for resolution.
   - [x] Wire strategy pause persistence before the Journal pause event and persist sticky blockers from the serialized user-data failure boundary for terminal accounting failures and actual unowned executions. Passive external NEW/open-order observations do not create an account-wide sticky blocker.
   - [~] Integrate explicit safety-blocker resolution with authoritative reconciliation/operator workflows. A READY one-market audit now resolves only matching MARKET-scoped blockers using a separate evidence digest; ACCOUNT blockers and blockers for other markets remain active. Operator pause/resume writes its own strict control facts and cannot clear a safety blocker.
   - [~] Project durable facts deterministically into a candidate recovery state. Order intent/outcome and exact fill facts now rebuild canonical OrderRegistry/Portfolio/RecoveryLedger projections; active pauses/blockers and account snapshots are retained. Recovery-cycle and cross-session cancellation projection now have focused tests; replay keeps synthetic event order separate from durable global sequence, and a later-session fill cannot cross a completed-cycle reset. The full invariant matrix, crash/restart proof, and complete projection parity remain pending. Candidate restoration is offline-only and never marks READY.
   - [~] Add an offline candidate reconciliation wrapper around the existing read-only `reconcileRecoveredMarketState` use case. It requires a committed per-market history-retention fact, reconciles owned orders, account snapshot, account-wide open orders, and target-market trade history, and may certify only that one market. It never publishes runtime READY; account-wide market-universe completeness and every-market reconciliation remain pending.
   - [~] Missing/corrupt/unprojectable durable history and any prior process session now block startup before broker connection; no automatic restart is permitted, even after clean shutdown. Actionable operator resolution/diagnostics and the full ambiguity matrix remain pending. Never auto-adopt or auto-cancel external orders.

9. **[ ] Step 9 — Prove crash/restart behavior, then consider controlled TESTNET validation.**
   - Run the full crash-point matrix, duplicate/reordered event tests, missing-record/session tests, legacy-session tests, and restart-twice idempotency tests.
   - Verify no duplicate order, fill, reservation, cost-basis reset, or retained-inventory sale.
   - Review evidence and approve a separate small, bounded TESTNET plan before any exchange-connected validation. Live trading remains out of scope.

### Finding-to-step map

- F-035 → Step 3 (session discovery)
- F-036 → Steps 1 and 7 (external-order policy and reconciliation; not a blanket startup gate)
- F-037 → Steps 1 and 6 (durability contract)
- F-038 → Step 5 (atomic accounting restore)
- F-039 → Steps 5 and 7 (third-asset fee valuation and balance reconciliation)
- F-040 → Step 3 (chronological session ordering)
- F-041 → Step 5 (explicit cycle outcome)
- F-042 → Step 6 (record completeness/integrity)
- F-043 → Step 4 (event classification and sticky blockers)
- F-044 → Step 4 (RECOVERY snapshot parity)

**Implementation rule:** complete one numbered step, review its diff, run its focused RED/GREEN tests and required CI, update this checklist, then start the next step. No broad recovery rewrite, no speculative framework, and no enabling restart restoration until Step 9 is accepted.

---

## Conservative strategy correctness — prioritized fix plan (2026-11-11)

> **Status: PLANNED — findings require implementation and exact-head verification.** Scope: `apps/harvester`, Conservative strategy only. Financial correctness takes priority over trading availability. One behavior/invariant per PR; RED regression first, minimal GREEN correction second; focused tests and required CI on the exact final PR head. No Binance connection or TESTNET/LIVE operation is part of these steps. Do not enable unattended restart/resumption before its separate recovery gate is complete.

### Implementation order

1. **P0 — Prevent competing same-symbol orders when an external order is open** — [#985](https://github.com/45s/coinzilla/issues/985).
2. **P0 — Preserve exact fill accounting and commission valuation**, especially third-asset commissions and live/DTO/replay parity — [#654](https://github.com/45s/coinzilla/issues/654), finding F-039.
3. **P0 — Prove recovery SELL lifecycle and cycle completion** under partial fills, cancel/fill races, UNKNOWN outcomes and missing durable completion facts — [#654](https://github.com/45s/coinzilla/issues/654), finding F-041.
4. **P1 — Close residual quantity/notional/dust boundaries** and prevent unchanged invalid-order retry loops.
5. **P0 before unattended restart — Complete durable restore and exchange reconciliation** — [#654](https://github.com/45s/coinzilla/issues/654), umbrella [#626](https://github.com/45s/coinzilla/issues/626). This is a separate release gate; it does not authorize early resumption.

---

### P0.1 — Block new strategy orders when an unowned external order is open on the same symbol

**Problem:** the owned OrderRegistry is not the account-wide open-order set. A manually placed or otherwise unowned order can already be working while the strategy sees no owned order and submits a competing order. External orders must remain unowned and untouched, but must be considered by the strategy's safety gate. This is a symbol-level conflict, not a reason to disable unrelated markets.

**Tracking:** [issue #985](https://github.com/45s/coinzilla/issues/985).

**Relevant code:** [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js) (decision/order-intent gates); [create-account-snapshot-manager.js](./src/bootstrap/account/create-account-snapshot-manager.js) (authoritative account/open-order snapshot); [subscribe-to-user-data.js](./src/bootstrap/user-data/subscribe-to-user-data.js) (updates/reconnect). Inspect current tests before adding coverage.

**Steps:**

1. [ ] **RED — Reproduce conflict:** unowned open BUY/SELL on symbol A, no owned order in OrderRegistry, otherwise-valid strategy decision. Assert no competing strategy order. Control: symbol B remains eligible.
2. [ ] **GREEN — Add narrow symbol gate:** use a current authoritative account-wide open-order view; defer only the affected symbol while a conflicting unowned order is open. Never adopt, cancel, modify or claim ownership of it.
3. [ ] **RED/GREEN — Snapshot lifecycle:** startup snapshot, order update/terminal event, reconnect refresh, stale/missing snapshot and snapshot-read failure. Unknown/stale state must not mean “no open orders”.
4. [ ] **Regression — Isolation/diagnostics:** no duplicate intent; external order unchanged; unrelated symbols unaffected; actionable blocked-symbol reason.

**Acceptance:** no conflicting same-symbol order can be submitted while an unowned order is open; external orders stay untouched/unowned; unrelated symbols remain independent; inability to establish current open-order state fails closed for that decision.

**Session evidence (2026-11-12/13):** PREFLIGHT found four unowned WLDFDUSD BUY orders. The LIVE strategy still submitted and filled WLDFDUSD orders while those external orders remained open; all four were later reported cancelled as unowned events. This is consistent with the runtime IGNORE policy but confirms P0.1 is not yet implemented. No external fills or balance mismatch were observed. See [session audit F-047](./docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md).

---

### P0.2 — Preserve exact commission facts and quote valuation through fill accounting

**Problem:** live commission validation supports third-asset commissions when historical quote valuation is supplied, but the lifecycle fill DTO drops `quoteValue` and the restore helper rejects third-asset commissions. The configured-market-only account snapshot filter can omit the commission asset. A fill accepted live must remain reconstructable and reconcilable. Missing valuation must never silently become a zero fee or be recomputed from today's price.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), forensic finding F-039. Keep live-accounting correction and durable-recovery integration as separate PRs if their contracts differ.

**Relevant code:** [position-accounting.js](./src/domain/portfolio/position-accounting.js) (Position cost/proceeds); [recovery-fill-accounting.js](./src/domain/strategies/conservative/recovery-fill-accounting.js); [lifecycle-event-dtos.js](./src/application/events/lifecycle-event-dtos.js) (safe DTO); [create-portfolio-workflow.js](./src/use-cases/create-portfolio-workflow.js) (live apply/restore); [create-account-snapshot-manager.js](./src/bootstrap/account/create-account-snapshot-manager.js) (fee-asset reconciliation).

**Steps:**

1. [x] **RED — Third-asset DTO round-trip:** canonical fill has commission asset different from base and quote, exact commission amount and historical quoteValue. Assert serialization/deserialization preserves every field exactly; expose current quoteValue loss.
2. [x] **GREEN — Preserve valuation in safe DTO:** extend only the relevant DTO schema/mapping/validation. Keep decimal representation exact; never substitute current market price for historical valuation.
3. [ ] **RED — Live BUY/SELL accounting:** assert quote-denominated cost/proceeds for base-, quote- and third-asset fees; include multiple and partial fills. Verify fee amount, asset and valuation.
4. [ ] **GREEN — One canonical accounting path:** use existing domain accounting; no parallel fee calculator. Missing, malformed, negative or contradictory valuation fails closed, without treating fee as zero.
5. [x] **RED — Fee-asset balance:** commission asset is not a configured trading pair. Regression proves the current snapshot/reconciliation path misses its debit and accepts an unexplained balance movement.
6. [x] **GREEN — Include required fee assets:** persist a targeted `COMMISSION_BASELINE` only for a non-zero third-asset commission actually used. Keep unrelated wallet assets excluded; compare the exact fee debit and preserve the fee asset's pre-existing locked balance.
7. [x] **Parity — Live versus DTO/projection/restore:** exact BUY/SELL fills with base-, quote- and third-asset commissions now produce identical complete Position and RecoveryLedger values through live accounting and DTO → projection → offline restore.
8. [x] **Atomicity — Invalid fee evidence:** missing historical valuation and contradictory commission/valuation asset identities fail before either immutable accounting projection is committed; regressions compare complete pre-fill Portfolio and RecoveryLedger snapshots.

**Implementation update — PR #990:** the DTO → journal projection → offline restore segment is implemented test-first. The original test-only RED PR #989 reproduced three failures (DTO valuation loss, projection valuation loss, and third-asset restore rejection) and was closed as superseded after the roadmap update merged. PR #990 preserves the exact third-asset commission amount/asset ID/code and historical quoteValue amount/quote-asset ID/code; it rejects missing valuation for non-zero third-asset fees, non-positive valuation for non-zero fees, contradictory asset identity, and valuation in the wrong quote asset. Zero-amount third-asset commission entries remain valid without an invented quote valuation. The projector retains exact decimal strings. Restoration rebuilds a canonical Commission with the original fee Asset and historical quoteValue; legacy positive third-asset records without quoteValue fail closed. BUY restoration regression verifies Position spent/quote cash flow and RecoveryLedger buyCost include the exact historical valuation. Exact-head CI at `289fb39981b6f496c6f3efabdb315ea5d9c8ecbc`: Harvester 942 passed/0 failed; all package unit tests, targeted tests, JavaScript syntax, dependency audit, coverage workflow and external documentation links passed. No Binance/TESTNET/LIVE operations were performed.

**Implementation update — PR #995:** targeted fee-asset reconciliation is implemented test-first. The RED regressions demonstrated that an unconfigured BNB debit was not included in the audit delta and that an unexplained BNB balance movement could pass. The account snapshot manager now retains the original PREFLIGHT balances in memory and writes a separate `COMMISSION_BASELINE` event only for a third-asset commission actually applied; unrelated assets remain excluded. `createPortfolioWorkflow` requests the baseline before committing the fill's Portfolio/RecoveryLedger projections. Journal remains optional: baseline persistence failure does not block valid fill accounting, but `auditRecoveredAccountState()` fails closed when a required baseline is absent. The audit merges targeted baselines with PREFLIGHT, subtracts exact fee amounts, preserves existing locked fee-asset balances, compares only configured market assets plus actually charged fee assets, and requires the baseline event to precede the first applied fill. Tests cover exact BNB debit, unexplained movement, missing/late baseline, locked balance preservation, unrelated XRP exclusion, and non-blocking Journal failure. Harvester unit tests: 950 passed/0 failed at original implementation head `34ce098f543a58cbdb124710c45a9d61c54e9b04`; full package tests, targeted tests, JavaScript syntax, dependency audit and workspace coverage passed. Exact final PR-head CI is required after synchronizing this branch. No Binance/TESTNET/LIVE operations were performed.

**Implementation update — PR #1002:** completed the remaining live-accounting and parity gates test-first. The RED stage exposed two accepted-invalid-fact cases: a third-asset commission could reuse an asset ID with a different code, and a historical quote valuation could reuse the quote asset ID with a different code. The shared `validateFillCommissions()` path now validates ID/code identity consistently against market assets and across commission entries before Position or RecoveryLedger accounting. New regressions cover multiple BUY/SELL fills, multiple third-asset fee entries, exact historical quote values, and identical complete Position/RecoveryLedger state across live accounting and DTO → Journal projection → offline restore for base-, quote- and third-asset commissions. Invalid fee evidence is rejected atomically; complete pre-fill Portfolio and RecoveryLedger snapshots remain unchanged, and the live workflow does not persist a fee baseline for an invalid fill. Harvester tests passed 956/956 and all seven workflows (unit tests, workspace coverage, Harvester targeted tests, JavaScript syntax/actionlint, Utils tests, production dependency audit, and external documentation links) passed on tested head `8b1ea0259e3fe14113a99ca9088ba826bd18d2db`. The final documentation-only commit is also subject to exact-head CI before merge. No Binance/TESTNET/LIVE operations were performed.

**Acceptance:** every accepted fill retains exact commission asset, amount and historical quote valuation through supported lifecycle representations; live and replay results match; fee assets reconcile; unavailable valuation is an explicit unresolved safety condition, never zero.

---

### P0.3 — Prove recovery SELL accounting and cycle completion use reconciled fills

**Problem:** order status is not proof of financial recovery. Submitted, acknowledged, partial, canceled or UNKNOWN SELLs cannot complete a cycle. Cancellation can race with fills. A full SELL whose durable cycle outcome is missing can leave replay with stale cost basis or incorrect retained-inventory allocation. Preserve existing serialized transitions, fill reconciliation, minimum-profit checks, dust evidence and atomic Portfolio/RecoveryLedger completion; extend rather than replace them.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), finding F-041; [#1097](https://github.com/45s/coinzilla/issues/1097) tracks the confirmed shutdown-race evidence from the 2026-11-12/13 LIVE session. Check the current [Domain Test Inventory](./docs/domain/DOMAIN_TEST_INVENTORY.md) before adding duplicate tests.

**Relevant code:** [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js); [recovery-completion.js](./src/domain/strategies/conservative/recovery-completion.js); [recovery-ledger.js](./src/domain/strategies/conservative/recovery-ledger.js); [recovery-sell-plan.js](./src/domain/strategies/conservative/recovery-sell-plan.js); [position-accounting.js](./src/domain/portfolio/position-accounting.js); recovery projector/Journal replay paths under #654.

**Steps:**

1. [ ] **RED — Status is not completion:** SUBMITTED, NEW/OPEN, PARTIALLY_FILLED, canceled with residual, REJECTED and UNKNOWN must not reset Position basis or RecoveryLedger.
2. [ ] **GREEN — Fill-driven completion:** allow completion only after authoritative execution reconciliation and all domain preconditions pass.
3. [ ] **RED — Cancel/fill interleavings:** execution before/during/after cancel response; duplicate/delayed report; UNKNOWN cancel; stale terminal report. Each canonical fill once; replacement never overdraws.
4. [ ] **GREEN — Reconcile before replace/complete:** use existing serialized transition and authoritative reconciliation; never infer final remaining quantity from cancel response alone.
5. [ ] **RED — BUY during recovery SELL:** partial BUY while SELL is open, cancel race and replacement. Assert no conflicting commitments, oversell or premature cycle reset.
6. [ ] **GREEN — Preserve approved lifecycle policy:** make only the smallest correction supported by failing behavior; no blanket prohibition without evidence.
7. [ ] **RED — Missing cycle outcome:** replay a full SELL without explicit durable completed/not-completed outcome. Restore must not guess, reset basis or re-sell retained inventory.
8. [ ] **GREEN — Explicit outcome in projection:** persist/project the minimum cycle outcome required; unresolved full SELL fails closed. Preserve legitimate residual sell-through.
9. [ ] **RED/GREEN — Profit/inventory matrix:** exact minimum-profit equality and immediately below; keepQuantity zero/nonzero; fee-adjusted proceeds; retained quantity plus validated dust; residual sellable quantity; consecutive cycles.
10. [ ] **Atomicity regression:** Portfolio and RecoveryLedger either both complete the cycle or neither changes.

**Acceptance:** completion requires reconciled canonical fills, sufficient net recovery/profit and exact active/free/dust allocation. Unresolved orders or missing cycle outcome block the next cycle. Retained inventory cannot be sold accidentally.

**Session evidence (2026-11-12/13):** shutdown began at 03:51:04.844Z; 20 WLD and 30 ADA BUYs filled after the stopped flag was set. The stopping path skipped recovery-SELL recalculation, leaving the last-observed SELLs short by 20 WLD and 30 ADA. CLOSING still reported COMPLETE because open SELLs are allowed without checking their coverage against the final Position/RecoveryLedger. Add a deterministic offline regression for a BUY fill during shutdown's pre-cancellation reconciliation window, and require either a reconciled recovery SELL or an INCOMPLETE CLOSING audit. See [session audit F-045](./docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md).

---

### P1 — Prevent invalid residual orders and minimum-notional retry loops

**Problem:** after partial execution or filter changes, remaining quantity may fall below MIN_QTY/MIN_NOTIONAL although the original order was valid. Rebuilding the same invalid trailing BUY or recovery SELL repeatedly creates noise and can hide a lifecycle/accounting defect. Expected post-only rejection is not a fill and is not success.

**Relevant code:** [recovery-sell-plan.js](./src/domain/strategies/conservative/recovery-sell-plan.js); [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js); confirm current order-filter validator path before editing. Existing boundary work: [PR #929](https://github.com/45s/coinzilla/pull/929), [#930](https://github.com/45s/coinzilla/pull/930), [#932](https://github.com/45s/coinzilla/pull/932).

**Steps:**

1. [ ] **RED — Residual below MIN_NOTIONAL:** valid SELL partially fills, remainder is immediately below current minimum. Assert no invalid replacement is emitted.
2. [ ] **GREEN — Classify residual first:** retain it as explicitly classified inventory/dust or unresolved safety state under the existing contract; never discard or call it recovered.
3. [ ] **RED/GREEN — Exact boundaries:** below/equal/above min quantity and notional; max quantity/notional; step/tick rounding for BUY and SELL.
4. [ ] **RED/GREEN — No unchanged retry loop:** repeated identical market updates with unchanged price/rules/inventory do not repeatedly submit the same invalid order. Retry only after a relevant input changes and the new plan validates.
5. [ ] **RED/GREEN — Rejection classification:** post-only/LIMIT_MAKER rejection is distinct from unexpected broker failure; it creates no fill, does not clear unresolved intent/reset recovery, and is never logged as successful execution.
6. [ ] **Regression — Quantity conservation:** active, retained and dust quantities remain accounted for after every skipped/invalid replacement decision.

**Acceptance:** no invalid exchange order, no repeated identical invalid retry, residual inventory remains explicitly accounted for, and expected rejection never mutates fill/accounting state.

---

### P0 release gate — Complete restart restore and exchange reconciliation before unattended resumption

**Problem:** runtime startup currently creates fresh in-memory Position, RecoveryLedger and OrderRegistry; the offline restore path is not wired into runtime. Historical fills, fee valuations, unresolved intents and sticky blockers are not yet proven to survive restart. A fresh process with empty memory is not evidence of an empty exchange position.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), umbrella [#626](https://github.com/45s/coinzilla/issues/626).

**Detailed nine-step plan:** see “Process-restart recovery — small-step delivery plan (#654)” at the top of this roadmap. Its Step 5 and Step 7 depend on the commission work above: preserve third-asset valuation and reconcile its asset balance. Keep domain pure and Journal observer-only unless a deliberate contract decision changes that boundary.

**Acceptance before enabling restore:** complete chronological durable facts; exact DTO → projection → restore parity; explicit cycle outcomes; sticky blockers; all relevant balances/fees and owned orders reconciled; external orders remain unowned/untouched; ambiguous or missing history keeps readiness closed; crash/restart matrix and restart-twice idempotency pass. No exchange-connected validation without a separately approved bounded plan.

### Cross-step review checklist

- [ ] Confirm exact source path and existing test coverage before editing; roadmap paths are navigation aids, not proof.
- [ ] Identify authoritative domain fact/owner before adding state or abstractions.
- [ ] Add one narrowly scoped failing regression; record RED on exact test-only head.
- [ ] Implement minimal correction; record GREEN on exact final head.
- [ ] Assert complete immutable snapshots on failure paths, not just return values/logs.
- [ ] Run focused tests, full Harvester suite, required repository CI and relevant package coverage.
- [ ] Inspect final diff for unrelated refactors, config changes and unintended behavior.
- [ ] Update roadmap and linked issue with merged PR, exact merge SHA and verified test/CI evidence.
- [ ] Keep exchange-connected operations out of scope unless separately and explicitly authorized.

---

## Priority execution plan — current develop direction (2026-11-10)

### Critical runtime reliability — order acknowledgement and shutdown ownership (2026-11-10)

- [x] **Make incomplete-shutdown diagnostics actionable — PR [#977](https://github.com/45s/coinzilla/pull/977), merged as `597b01d3836d74d1c4a409005c844d76102e4a34`.** Preserve the pre-shutdown user-data status, report stage-specific reconciliation and cleanup failures, expose safe unresolved owned-order identities/quantities, and distinguish `SHUTDOWN_INCOMPLETE` from confirmed `STOPPED`. Existing fail-closed process-lock retention is unchanged. Exact-head verification: 935/935 Harvester tests; 75.83% line / 78.98% branch / 75.32% function coverage; all seven configured workflows passed. No exchange operations.

- [x] **Resolve UNKNOWN submissions from authoritative Binance NEW reports — issue [#962](https://github.com/45s/coinzilla/issues/962).** A matching exchange report carrying the original Harvester clientOrderId and assigned brokerOrderId is authoritative evidence that an ambiguous submission exists. Accept the first `UNKNOWN → OPEN` transition and attach the exchange ID; keep conflicting identities, stale terminal reports, and unresolved orders fail-closed. Regression coverage covers OrderRegistry and the Conservative engine.
- [x] **Prove shutdown cancellation after recovered acknowledgement.** The engine regression verifies that the recovered owned BUY is selected for cancellation using its exchange-assigned broker order ID. The existing runtime shutdown contract remains unchanged: reconcile before cancellation; cancel only acknowledged owned BUYs; keep user-data intake active for racing fills; reconcile again; preserve owned SELLs and external orders; and retain process locks when final reconciliation or the CLOSING audit is unresolved. No second cancellation pass or guessed broker ID.
- [x] **Report the actual exchange mode in startup status — issue [#963](https://github.com/45s/coinzilla/issues/963).** Pass the already validated `TRADING_MODE` value into user-data startup and use it for success and blocked-state messages. `NODE_ENV` must not select or relabel the exchange.
- **Broker dependency:** canonical Binance order placement requests `newOrderRespType: "RESULT"` to avoid the minimal default `ACK` for `LIMIT_MAKER`; broker-side implementation and documentation are tracked in [issue #960](https://github.com/45s/coinzilla/issues/960) and [PR #961](https://github.com/45s/coinzilla/pull/961).
- **Verification status:** all six required GitHub Actions workflows passed on synchronized PR #964 head `91d7d34f1b6c11e5a3b0513c91d974ffb93f977c`: workspace unit tests, workspace/package coverage, Harvester targeted tests, JavaScript syntax/actionlint, Utils tests and production dependency audit. The external documentation-links workflow was advisory and still running at merge. The read-only Binance TESTNET integration was skipped by workflow policy; no Binance TESTNET/LIVE connection or order mutation was performed. PR #964 merged at `ce7b5dfeddaaeed68f67ab8213520427b3777280`.

### In progress — domain logic test quality initiative

- [x] Establish the source-driven behavior-to-test inventory in [Domain Test Inventory](./docs/domain/DOMAIN_TEST_INVENTORY.md) — added and merged in PR #917.
- [~] Strengthen Conservative decision tests around blocked recovery SELLs before changing policy implementation; follow strict RED → GREEN → REFACTOR.
- [x] Conservative BUY-gating regression and correction merged in PR #917: a MAX_PRICE-blocked recovery SELL and PENDING/UNKNOWN recovery SELL prevent the next BUY; acknowledged OPEN/PARTIALLY_FILLED SELLs retain the approved coexistence behavior. Exact merged-head CI passed 872/872 Harvester tests and all required checks.
- [x] Conservative investment-cap equality and immediately-below boundary matrix merged in [PR #922](https://github.com/45s/coinzilla/pull/922). Exact PR head `8e234e2c18cb98b4b8562c62ef05d9f20f852102` passed 872/872 Harvester tests; coverage was 75.94% lines, 79.26% branches and 74.88% functions. All required CI checks passed.
- [x] Strengthen Portfolio multi-market isolation and conflicting-fill no-mutation assertions merged in [PR #924](https://github.com/45s/coinzilla/pull/924); exact-head CI passed.
- [x] Market trading-readiness quantity and minimum-notional boundary matrices merged in [PR #930](https://github.com/45s/coinzilla/pull/930); exact updated PR-head CI passed.
- [x] Exact inclusive pre-submission exchange-filter boundaries for MIN/MAX price, quantity and notional merged in [PR #932](https://github.com/45s/coinzilla/pull/932); existing immediately-outside rejection matrix retained.
- [x] Independent Conservative strategy fixture arithmetic merged in [PR #937](https://github.com/45s/coinzilla/pull/937); residual SELL quote totals and MAX_NOTIONAL expectations use independent exact values.
- [x] OrderRegistry complete-state and immutable-snapshot assertions merged in [PR #928](https://github.com/45s/coinzilla/pull/928); exact-head CI passed 874/874 Harvester tests.
- [x] Audit application-level Conservative engine coverage: 163 deterministic tests cover trailing BUY gates, stale/out-of-order events, serialized cancellation/fill races, retryable versus terminal failures and conflicting execution facts. No generation identity exists in the current contract; see Domain Test Inventory.
- [x] Extend OrderRegistry coverage for decreasing execution and stale timestamps; rejected reports preserve canonical state and commitment. Merged in [PR #927](https://github.com/45s/coinzilla/pull/927).
- [x] Precise account-snapshot failure classification, no partial result data and immutable input snapshots merged in [PR #931](https://github.com/45s/coinzilla/pull/931); exact-head CI passed 872/872 Harvester tests.
- [x] Cover equal broker trade IDs across different markets in the Conservative engine; the test harness deduplicates by canonical Fill ID. Merged in [PR #933](https://github.com/45s/coinzilla/pull/933).
- [x] Prove sequential Position inventory conservation across fee-adjusted BUYs, free allocation, a subsequent BUY and SELL commissions; also prove overdrawn SELL/commission and incomplete-commission failures preserve the complete Position snapshot. Merged in [PR #943](https://github.com/45s/coinzilla/pull/943); exact-head required CI passed, and all Position assertions include diagnostic failure messages.
- [x] Isolate exact exchange-filter equality boundaries with independent notionals and verify immutable market-readiness metadata. Merged in [PR #929](https://github.com/45s/coinzilla/pull/929) after all six required checks passed.
- [x] Complete focused offline test-quality PRs #943, #944, #947, #948 and #949. Exact-head required CI passed for each; see Domain Test Inventory for the 163-case application-level orchestration inventory and the explicit generation-isolation boundary.
- [x] Fix multiple UNKNOWN orders without broker IDs colliding during `OrderRegistry.applyUpdate()`; RED/GREEN regression and production correction merged in [PR #958](https://github.com/45s/coinzilla/pull/958), exact merged-head required CI passed (891/891 Harvester tests).
- [x] Reconcile account free balances with snapshot-relative total-Portfolio-base and active-order baselines — [issue #955](https://github.com/45s/coinzilla/issues/955), implemented in [PR #968](https://github.com/45s/coinzilla/pull/968) and merged as `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d`. Snapshot baselines capture Portfolio quote cash flow, total base (active plus retained free), and active BUY/SELL commitments by shared asset ID. Allocation applies only post-snapshot deltas; pair investment and pair-owned active SELL inventory remain separate. The retained-free regression corrected an active-only baseline mistake. The expanded matrix covers pre/post-snapshot BUY and SELL locks, partial fills, shared quote/base assets, wallet shortfall, unpriced active MARKET BUY fail-closed behavior, terminal-order exclusion, and recovery event-sequence recapture. Exact final PR head `d0d52dddb8f3c8d9e73f9f6dc484c6b3987e22f2` passed 914/914 Harvester tests; coverage was 75.80% lines, 79.23% branches and 75.19% functions. All seven configured workflows and workspace package coverage passed. Read-only TESTNET integration was skipped; no exchange operation occurred. Issue #955 is closed.
- [x] Harden `allocateOrderCommitments()` against internally inconsistent inventory and commitment totals. Test-first regressions cover pair active inventory versus total Portfolio base, pair SELL commitments versus active inventory, pair commitments versus shared account aggregates, and aggregate SELL commitments versus total tracked base. The existing post-snapshot SELL-lock fixture is corrected to use a valid active/total inventory relationship without changing its expected balance result. RED was confirmed on exact PR #971 test-only head `74a1a9e22161a924d3f380f6842ee361f502ecae` (914 passed / 5 failed). Production validation now rejects the impossible relationships before action allocation. GREEN was confirmed on PR #971 implementation/test head `cd7b8bae666326453cc196ea20c5b52dabaf0043`: 920/920 Harvester tests; 76.03% lines, 79.41% branches and 75.19% functions; all seven configured workflows and workspace coverage passed. A further regression verifies post-snapshot partial BUY net-base credit (0.4 gross less 0.004 base commission = 0.396).
- [x] Make recovery-cycle completion atomic across Portfolio and RecoveryLedger. A failure in the final ledger reset must not leave retained-inventory allocation or cost-basis reset committed by itself. RED was confirmed on exact test-only PR #972 head `9b57ae42cb52f72003d95b50dc39715046d4da55` (920 passed / 1 failed). The implementation stages the next Portfolio and next RecoveryLedger map before assigning either reference. GREEN was confirmed on exact implementation/test head `5a020a8930a3c528d5ec9188a8725a48440dfa85`: 921/921 Harvester tests; 75.83% lines, 79.35% branches, 75.25% functions; all seven workflows and workspace coverage passed.
- [x] Guard `RecoveryLedger.resetCycle()` with the configured minimum-profit precondition and authoritative `Position.spent` quote Money. A direct domain caller cannot erase outstanding recovery capital, use a divergent legacy `buyCost` mirror, or reset below `minProfit`; fill identities survive. RED was confirmed test-first; GREEN passed on final PR #973 head after the full Harvester suite and all required CI workflows succeeded.
- [x] Keep journal replay identical to live completion: the durable event records configured `keepQuantity` and `minProfit`; replay validates the threshold and dust evidence, allocates every active coin as `keepQuantity + dust`, leaves no sellable active residual, resets `Position.spent` and RecoveryLedger totals together, and preserves cumulative quote cash flow and fill identities. Invalid or incomplete completion records fail closed. GREEN passed on final PR #973 head with full Harvester tests and all required CI workflows.
- **Scope boundary:** deterministic domain/application tests only. No Binance TESTNET/LIVE activity, no configuration changes, and no resumption or implementation changes for paused issue #626.

### Completed — per-session log directory layout (PR #874, 2026-11-10)

- [x] Group each process's DEBUG, TRACE, development terminal capture and Journal JSONL file under one UTC/session-ID directory.
- [x] Keep append-only cumulative DEBUG, TRACE and terminal histories under `logs/cumulative/`; keep process ownership locks under `~/.coinzilla/harvester/process-locks/`.
- [x] Preserve legacy flat log and Journal files in place; do not migrate, truncate or delete existing history. The Harvester balance-reconciliation CLI reads both legacy root-level Journal files and new session directories.
- [x] No Journal record schema, durability barrier, replay behavior or trading behavior changes. Journal filename-reader compatibility was completed separately in PR #880.

This section is the authoritative implementation order for current work. It supersedes older "current direction", P0/P1 and future-work notes below wherever their status or ordering conflicts. Historical incident records remain evidence, not active tasks. Harvester is the only application currently in this workspace.

### Completed — explicit Binance trading-mode propagation (PR #841)

- [x] Harvester reads and validates only `TRADING_MODE=testnet|live`, passes the resolved value explicitly through its Binance broker adapter, and supplies TESTNET explicitly in offline replay/test harnesses. `NODE_ENV` remains application runtime metadata and cannot select exchange endpoints. LIVE selection requires no second confirmation or enable flag.
- **Boundary:** this is endpoint-selection/configuration completion, not exchange acceptance or restart safety. Hosted read-only TESTNET acceptance remains externally blocked/unverified; process-restart reconciliation remains a separate critical issue tracked by [#654](https://github.com/45s/coinzilla/issues/654).

### CRITICAL — complete before unattended operation

1. **[x] Make Conservative trailing-BUY replacement failure-safe — PRs #751 and #753 merged.**
   - **Why:** the current replacement path can cancel the standing BUY before the replacement is known to be valid. If exchange-filter validation or submission then fails (including the observed `MIN_NOTIONAL` rejection), the market can be left without its intended standing order and repeated market ticks can repeat the failure.
   - **Do:** build the candidate replacement from a single fresh market/trading-rule snapshot; validate quantity, price, notional, precision, freshness and POST_ONLY constraints before canceling the existing order. Preserve the old order until the candidate is known to be admissible. Where exchange semantics require cancel-before-submit, represent the gap explicitly, pause/defer the pair on rejection or unknown outcome, and reconcile by canonical client order ID before retrying. Do not silently swallow validation callbacks.
   - **Verify:** add RED/GREEN regressions for below-min-notional candidates, stale book/price, cancel rejection, submit rejection, timeout/unknown acknowledgement, partial fills during replacement, and duplicate market ticks. Assert no duplicate order, no lost reservation, and no unbounded retry loop.
   - **Implementation in PR #751:** the serialized replacement transition now evaluates and allocates the exact replacement decision, constructs pending canonical orders, and runs the existing exchange-rule and post-only readiness validation before cancellation. Validation/readiness failure leaves the standing BUY registered and untouched. After confirmed cancellation, an uncertain or rejected replacement remains represented as UNKNOWN and the pair is paused for reconciliation.
   - **Regression coverage in PR #751:** production-path tests cover MIN_NOTIONAL, quantity and price increments, stale price and book data, unavailable and incomplete trading rules, cancellation failure, post-cancellation submission failure, repeated market events, and the existing valid Conservative replacement behavior. Verified on PR #751 head `d394b60271e858f376c4df4402df895cb7e5b7c4`: Harvester targeted tests, full Harvester suite (786/786), workspace package tests, workspace coverage, JavaScript syntax, dependency audit, Utils tests, and actionlint all passed. PR #751 was merged into `develop` as `8b35eb5b09234784c661213a52459ef325d210d2`.
   - **Current-rule refresh hardening in PR #753:** each trailing replacement now fetches exchange filters again before preflight; the Binance adapter no longer reuses a process-lifetime filter cache. The refreshed canonical market and TradingRules are used by both preflight and actual submission. Failed, incomplete, or mismatched refreshes pause the pair without canceling the standing BUY. Tests cover exchange-rule changes after startup and unavailable refresh responses.
   - **PR #753 verification:** exact head `0a15f5b94845fe703717374611e5a6784a3ed9b9` passed Harvester targeted tests, full Harvester suite (789/789), workspace package tests, workspace coverage, JavaScript syntax, dependency audit, Utils tests, and actionlint. PR #753 was merged into `develop` as `536c3b24cfd14e7538ea4e3e14aae37af862527b`.

2. **Close #626 recovery reliability with evidence, not assumptions.**
   - **Why:** reconnecting the transport is not the same as restoring application readiness. A premature READY transition can allow decisions against stale order/account state; a permanently closed gate harms liveness but is safer than trading on uncertain state.
   - **Do:** preserve generation/subscription fencing, queued user-data event handling, single-flight reconciliation, canonical order/fill history checks, and durable RECOVERY audit barriers. The F-032 diagnostic-only `rpcError` readiness and cause-aware error-deduplication behavior is already fixed in PR #824; do not reopen it without new evidence. Investigate only newly reproduced state-machine failures. Keep the gate closed on incomplete history, failed audit flush, stale acknowledgement, or conflicting state.
   - **Verify:** cover first and second disconnects, stale and current generations, diagnostic-only `rpcError` followed by an actual close, distinct empty-message error causes, preservation of an already unresolved gate and its status, contradictory/missing metadata, repeated reminders, queued BUY/SELL fills, multiple subscribers, history/API errors, Journal write failures and acknowledgement ordering. TESTNET acceptance remains **PAUSED / UNVERIFIED** after the regional HTTP 451 restriction; do not retry the same hosted path or claim exchange acceptance.
   - **Offline follow-up — F-033 (implemented and verified in PR #906):** permanent Journal write failures propagate as terminal recovery metadata; only a failed flush with explicit healthy-writer status remains retryable. Unclassified Journal health fails closed. The exact implementation head passed Harvester unit tests (870/870), workspace unit tests, coverage, JavaScript syntax, dependency audit, targeted tests, and process-lock checks. TESTNET acceptance remains separately PAUSED / UNVERIFIED.
   - **Offline follow-up — F-034 (implemented in PR #909):** failures from asynchronous recovery stages are applied only while the attempt generation remains current. A terminal account-snapshot failure arriving after a newer disconnect is logged with its original error and both generations, then discarded without poisoning the process-lifetime accounting latch; the latest generation must perform its own reconciliation and durable account/open-order audits before acknowledgement. PR #909 merged as `dc17f1f2c1fa6e45c08035ae6ae736eb821b90a5` (reconciled exact head `46de0a6f891deb9dc7d3960c7b36d1de0fe72eee`). Harvester unit tests passed (871/871); exact-head Harvester coverage was 75.98% lines, 79.32% branches, 74.85% functions. Workspace unit tests and coverage, configured Harvester regression tests, JavaScript syntax/policy/Markdown, external documentation links, dependency audit, actionlint and Utils tests also passed. TESTNET acceptance remains PAUSED / UNVERIFIED; the read-only TESTNET integration job and Harvester endpoint probe were skipped.
   - **Offline fix — PR #824:** diagnostic-only RPC errors preserve existing readiness/generation state; malformed and contradictory metadata remain fail-closed; error deduplication distinguishes cause/stack context. Test-first RED is confirmed; exact-head offline CI is recorded by the PR checks. TESTNET acceptance remains separately PAUSED / UNVERIFIED.

**Completed — [#774](https://github.com/45s/coinzilla/issues/774), [PR #786](https://github.com/45s/coinzilla/pull/786) merged:** the broker proves when cancellation was never sent; Harvester preserves the known canonical order state only for exact `NOT_SENT` on `ok: false`, publishes the lifecycle outcome, and keeps the pair safety-paused. Missing/ambiguous results remain UNKNOWN until authoritative reconciliation. Offline regressions and exact-head CI passed. TESTNET acceptance remains separately PAUSED / UNVERIFIED.

3. **#654 process-restart reconciliation — active forensic phase; implementation remains separate.**
   - **Why:** current Portfolio, RecoveryLedger and OrderRegistry state is process-local. A restart after an order/fill can lose ownership and reservations while Binance still has open orders or later executions. Same-process reconnect recovery does not solve process death.
   - **Current phase:** evidence/documentation only. The tested PR #606 helper stack remains in the repository but is not wired into current startup. The old integration failed closed because `marketUniverseComplete` was false; current runtime bypasses that gate and starts fresh. Do not modify application source/tests or re-enable replay in this phase.
   - **Future DDD/TDD implementation:** resolve historical market-universe completeness, crash-consistent fill/pause persistence, and startup restoration using the existing projection/restore/account/trade-history helpers. Restore ownership and pause state, resolve UNKNOWN orders by canonical clientOrderId lookup, reconcile balances/open orders/fills, and keep READY closed on any incomplete or conflicting evidence.
   - **Verify:** crash/restart at every order-submit, cancel, partial-fill, full-fill and recovery boundary; prove idempotent accounting and no duplicate order placement. Do not claim exactly-once transport delivery.

### Selected process provenance work — issue #763

- [x] **Harvester process identity and Journal correlation — PR #770.** Harvester captures one immutable process identity (package version, Git branch/full and short commit, commit subject/date, working-tree state, metadata source, PID, UTC process-entry time, runtime-session ID), attaches its sanitized allowlisted DTO to shared Logger context before startup diagnostics, and publishes `harvester.process_started` after Journal subscriber readiness. It remains distinct from `harvester.started`. Configuration-only/no-broker startup does not wait for optional Journal readiness. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. Broker-connected startup admits the event before its existing PREFLIGHT flush; no new durability barrier, trading behavior, or process-restart recovery is introduced. If the Journal never becomes ready before process termination, trace-log context remains the immediate provenance evidence. Test-first RED was confirmed on PR #770's initial test-only commit. The final code-equivalent head passed all 29 GitHub check runs: workspace unit tests, workspace coverage, Harvester targeted tests and package coverage, Utils tests, JavaScript syntax, dependency audit, actionlint, and both process-lock platforms. The read-only TESTNET integration job was correctly skipped; no exchange operation was performed.

### IMPORTANT — improve correctness and operational confidence

- [x] **PR #866 — Journal startup diagnostics and operator error vocabulary (merged 2026-11-09).** Preserve the Journal package's fail-closed exclusive lock behavior while exposing the stable Harvester diagnostic identifier (`ErrorJournal001`) for `JOURNAL_DIRECTORY_LOCKED`. The [Error Vocabulary](./docs/error-vocabulary.md) documents the exact stale-lock verification/removal procedure and is linked from the operations indexes; the original machine-readable error code and cause remain intact. Exact PR head `3bba286588c930c65e4f6cedff0e707371b79821` passed all six required workflows, including 858/858 Harvester tests. The read-only TESTNET integration was skipped; no exchange operation or acceptance is claimed. Automatic stale-lock takeover remains unsupported.

4. **Keep Journal evidence complete without expanding trading-blocking behavior.**
   - **Why:** investigation requires decision, request, broker acknowledgement, execution, fee and account evidence to be correlated. Missing fields make incident analysis guesswork, but optional diagnostics must not become new trading gates.
   - **Do:** maintain the evidence coverage matrix and add only demonstrated gaps (including execution/trade IDs, per-fill commission amount/asset, last/cumulative quantities, order/client IDs and rejection/cancel outcomes). Preserve the existing mandatory PREFLIGHT/CLOSING and pre-side-effect durability barriers; keep additional evidence best-effort and explicitly report gaps.
   - **Verify:** fixtures and mapping/persistence tests cover populated, missing, malformed and sensitive fields, duplicate/replayed events and optional-write failure isolation. Issue #650 is completed by PR #652; do not reopen it without a newly demonstrated gap.

5. **Add consolidated trading-session statistics (C) as a separate reporting capability.**
   - **Why:** the operator needs a trustworthy post-session explanation of inventory, capital recovery, fees and realized result; current event logs and point-in-time Portfolio snapshots do not provide a complete session report.
   - **Do:** derive the report from confirmed, deduplicated fills and the existing Portfolio/RecoveryLedger accounting facts. Show BUY/SELL quantity and quote totals, actual commissions grouped by asset, invested quote, recovered net proceeds, outstanding recovery, realized net profit, retained inventory/dust and open/partial orders. Keep reporting read-only; do not create a second accounting source.
   - **Verify:** compare report values against deterministic fill fixtures, including partial/duplicate fills, multiple fee assets, retained inventory and exchange-constrained dust. Start with a concise CLI summary; persistence/export is a separate decision.

6. **H7/H8 — Conservative architecture decomposition and documentation reconciliation (P3) — COMPLETE in merged [PR #1075](https://github.com/45s/coinzilla/pull/1075).**
   - **Delivered:** the engine's read-only owned-order snapshot collection, per-market volatility-protection coordination, normalized user-data/order-event workflow and terminal fill reconciliation were extracted behind cohesive application workflows. The engine remains the single serialized composition boundary and retains strategy evaluation/commitment allocation, execution totals/recovery markers, owned-order cancellation/replacement and the central submission gate.
   - **Architecture outcome:** the engine was reduced from 3,335 lines at the verified pre-P3 baseline to 2,266 lines. Further extraction is not required merely to reduce line count; any future change must demonstrate a clearer ownership boundary and preserve the serialized transition queue and all durability/accounting barriers.
   - **Documentation outcome:** runtime composition, account-snapshot asset scope, audit phases, Journal operations, Trading First, TESTNET runbook and affected indexes were reconciled against source. Historical audit evidence remains preserved.
   - **Verification:** exact PR head `f8add4c783ae58e3d5808cfbbd438e76139e5f6a` passed all six required workflows; 1,440 Harvester tests passed, with 83.59% line, 81.21% branch and 80.12% function coverage. Optional read-only TESTNET integration was skipped; no exchange operations were performed.

7. **Complete the multi-market acceptance matrix when an eligible TESTNET environment exists.**
   - **Why:** offline fake-broker tests cannot establish exchange filter, shared-asset reservation and real acknowledgement behavior across markets.
   - **Do:** verify markets sharing quote assets and base assets, investment limits, per-pair order/fill isolation, fee handling and shutdown/reconnect. Keep the operator runbook and evidence redacted.
   - **Verify:** use read-only checks first and explicitly authorized bounded test orders only in a separately agreed session. This remains blocked by the current regional eligibility pause.

8. **Keep operational notifications optional and isolated.**
   - **Why:** operators need high-signal lifecycle and safety alerts, but a Telegram outage must never block trading or recovery.
   - **Do:** the Telegram integration through `@coinzilla/notifiers` is already implemented (PR #734). Keep both credentials optional, preserve the explicit event allowlist, bounded serialized delivery and shutdown drain. Do not add automatic retries or a durable outbox without a concrete requirement.
   - **Verify:** retain offline tests for absent/partial credentials, setup failure, queue overflow, transport failure and shutdown. A live smoke test is operator-controlled and is not a CI prerequisite.

9. **[x] Fill identity and commission-conflict regression coverage — merged in PR #921.**
   - **Why:** a reused Fill ID with a changed commission amount or asset must never be accepted as an identical duplicate by either Portfolio or RecoveryLedger. A rejected conflict must leave the complete immutable projection unchanged.
   - **Implemented:** Portfolio rejects the same Fill ID with a changed quote-commission amount; RecoveryLedger rejects the same Fill ID with a changed commission asset. Both tests compare the complete immutable projection before and after rejection. No production code changed.
   - **Verified:** exact PR-head CI passed 873/873 Harvester tests, 75.87% line / 79.13% branch / 74.85% function coverage, and all required checks. PR #921 merged into `develop` at `6c4b1d421aac46b391f2de894153947545879ba9`. No broker, network, or exchange activity.

### DEFERRED — only after the critical Conservative path is safe

9. **Aggressive strategy:** keep disabled until Conservative restart/recovery and exchange acceptance are proven. Then specify unresolved policy, implement pure intents, reuse the shared engine/accounting/safety gates, and test grid repricing, partial fills, reservations, risk fallback and handover before TESTNET.
10. **Further reporting/notification channels:** do not add strategy-specific accounting, email/Discord, persistent notification delivery or speculative dashboards until a real consumer and acceptance contract exist.
11. **Log rotation and retention:** add bounded size-based rotation, archive naming, retention limits and cleanup tests for cumulative and per-session diagnostic files. Cumulative DEBUG, TRACE and development-terminal files append indefinitely, while per-session files are preserved without automatic cleanup. This can eventually exhaust disk space during long-running or frequent development sessions. Implement retention only after selecting an operator-friendly policy and validating crash-safe rotation across all three file destinations; never introduce startup/shutdown deletion as a substitute for a retention policy.

### Status corrections

- #702 per-subscriber recovery acknowledgement and generation-fencing work is implemented in merged Brokers/Harvester PRs #732, #735 and #740; do not list it as open work.
- #650 evidence work is complete in PR #652; additional evidence changes require a newly demonstrated gap.
- #654 is an active forensic/release-readiness investigation; runtime implementation remains a separate DDD/TDD workstream and a blocker for unattended process restarts.
- Remove obsolete references to the deleted legacy application; no extraction or migration work remains for it.

## Current blockers and work selection — 2026-11-09

This section is the current operational status and supersedes older statements below that describe TESTNET acceptance as the immediate next action.

### TESTNET regional eligibility pause

- [~] **Paused — external environment restriction, not an application defect.** The hosted TESTNET validation attempt was rejected with HTTP 451 by Binance Spot API due to regional eligibility restrictions.
- The operator cannot change location to work around this restriction. Do not ask them to do so, and do not repeatedly retry the same hosted TESTNET path.
- No exchange acceptance is claimed. Keep TESTNET validation explicitly **UNVERIFIED / PAUSED** until an eligible, authorized environment is available.
- [~] **Runbook/config pair-scope mismatch — separate hard blocker.** The committed `config/index.js` enables LINKFDUSD and ZROFDUSD, while the controlled runbook still describes the earlier DOGEUSDT/ZROUSDT plan. No replacement session scope is recorded. Preserve the old plan as historical evidence; do not alter pair configuration or use the runbook for execution until pair scope, quote-currency/fee assumptions, and order limits are explicitly reconciled. The standalone ZRO market-sell helper is hardcoded to ZROUSDT and the account-wide cancel helper has no interactive confirmation; neither is an approved cleanup path while the runbook is paused. See [the controlled TESTNET runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md).
- Offline tests, source-level verification, and CI continue independently. This pause does not block code, documentation, or deterministic test work.
- No live exchange operations, credentials, order submissions, cancellations, or account-setting changes are authorized by this pause note.

### Portfolio stats and user-data lifecycle observability — 2026-11-08

- [x] Emit a compact Portfolio Stats snapshot only after a newly applied BUY/SELL fill changes inventory quantity. Include active, retained, and total base quantity plus exact quote-currency cost/recovery accounting. Do not mix exchange account balances into the in-memory Portfolio snapshot or refresh account balances after every fill.
- [x] Replace generic repeated user-data status logs with concise, deduplicated connected/disconnected/reconnecting/reconnected/subscription-restored/error transitions. Preserve actual broker error context and do not infer authentication expiry from an unspecified transport error.
- [x] Add deterministic offline regressions for partial BUY/SELL fills, duplicate fills, and repeated lifecycle status notifications; preserve existing readiness/recovery behavior.
- [x] Exact-head offline CI on PR #744 head `ae2b6435d0e038f53c8fb2a3869570a5fc2648e7`: Harvester unit tests 776/776, configured targeted tests 3/3, Harvester coverage, workspace coverage, JavaScript syntax, actionlint, Utils tests, and production dependency audit passed. Read-only Binance TESTNET integration was skipped; no exchange acceptance is claimed.

### Recovery contract work

- [x] **#702 — Broker per-subscriber recovery acknowledgement contract.** Owner decision approved on 2026-11-08; broker API and Harvester consumer integration are complete in PRs #732 and #735:
  1. Add an explicit per-subscriber acknowledgement result API while preserving the existing boolean API and its meaning.
  2. Distinguish accepted-but-pending, accepted-and-globally-completed, and stale/inactive rejection.
  3. Preserve one terminal `reconciled` notification per recovery generation for every still-active subscriber; disconnected subscribers receive none.
  4. Keep state-changing RPCs blocked until global recovery completion and keep reminder behavior bounded.
- [x] Implemented #702 with DDD/TDD in PRs #732 and #735: the Brokers Application owns the result contract, the Domain completion invariant is preserved, and Harvester readiness remains closed until the matching global reconciled status. The legacy boolean API remains compatible.
- [x] Follow-up generation fencing in PR #740: the broker emits a monotonic recovery-generation token; Harvester passes the token it reconciled to `acknowledgeRecoveryResult()` and requires the terminal status to match that token, its local recovery generation, and the active subscription ID. A missing token fails closed. The legacy no-argument boolean API remains available but cannot fence stale asynchronous work.
- [ ] **#626 — Harvester recovery reliability.** Offline code/test hardening is substantially complete. Keep the issue open for final acceptance traceability and the externally paused TESTNET acceptance; keep readiness fail-closed and preserve durable audit barriers. The bootstrap composition root is available for inspection and changes; the refactor is complete.
- [x] **PR #739 — 254-reminder recovery regression.** The offline Harvester integration test holds an owned-order canonical-history read pending, delivers 254 repeated `recovered` reminders for the same generation, queues a matching BUY fill, and proves single-flight reconciliation, one-time fill accounting, queued-event drain, durable RECOVERY account/open-orders audits before acknowledgement, one terminal completion, and readiness reopening. Existing failure and second-disconnect regressions remain in place. This does not claim a byte-for-byte replay of the full incident Journal.
- [x] **#667 — November 7 incident follow-up.** Closed after the owner-approved external-order policy and merged fixes for graceful shutdown (#663), unowned-order startup policy (#664), account-integrity BUY cancellation (#669), configured-asset snapshots (#670), Conservative dust/conformance (#653), and recovery-mode deferred evaluations (#673). TESTNET acceptance remains separately paused/unverified.

### Optional operational notifications

- [x] Integrate Telegram through the existing `@coinzilla/notifiers` package at the Harvester composition boundary. Harvester maps selected application events and owns Telegram message formatting; the notifier package provides generic bounded serialized delivery and Telegram transport.
- Telegram transport is constructed only when `notifications.telegram.enabled` is not false and both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured. Setup/delivery failures are isolated from trading. Shutdown drains accepted EventBus work before closing the notifier.
- [~] Add Harvester-owned `minimal`, `trader`, `verbose`, and `custom` profile identifiers in `config/notifications-tg-profiles.js`; select them from `config/index.js` and keep event overrides, market filtering, and non-disableable safety alerts in `appConfig.notifications.telegram`; depend on the Notifiers event-selection contract tracked by [#996](https://github.com/45s/coinzilla/issues/996).
- Delivery is best-effort, in-memory, and not a durable outbox. No trading behavior, exchange integration, or financial accounting rules are changed.

### Other active and deferred work

- [x] **#650 — Journal evidence completeness:** completed in PR #652; required evidence matrix and allowlisted evidence coverage merged and verified. Preserve mandatory durability barriers; additional diagnostics remain best-effort.
- [x] **#646 / #656 — Conservative conformance and dust:** completed in PR #653; exact-head offline CI passed. Issues #646 and #656 are closed.
- [ ] **#654 — process-restart reconciliation:** active forensic investigation; runtime implementation remains a separate DDD/TDD workstream and a blocker for unattended restarts. See F-031 and the current session report.
- **Legacy application removal:** complete. No extraction, migration or maintenance work remains; keep its former implementation and terminology out of current Harvester documentation.

> **Conservative Strategy authority:** [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authoritative rule definition. Roadmap items track implementation, evidence, and blockers only. Any older strategy-rule wording in historical sections is superseded and must not be used as current acceptance criteria. The canonical Mermaid flowchart is derived from the written specification and is not an independent authority.

**CURRENT DIRECTION — 2026-11-09: FORENSIC RESTART-RECOVERY PHASE.** The active task is to establish source/test evidence for #654, validate the retained PR #606 recovery helpers, document why current runtime wiring is absent, and resolve market-universe completeness and crash-consistency requirements. No application implementation or test changes are allowed in this phase.
>
> **Historical runtime decision — 2026-11-05:** durable Journal replay and process-restart recovery were intentionally disabled for the first Conservative TESTNET workflow. The user now explicitly requests forensic investigation, not implementation or replay enablement. Current `index.js` and `prepareOptionalJournal()` do not read prior sessions; `startHarvester()` creates fresh state. The separate PREFLIGHT/CLOSING account audit and pre-side-effect order/cancel intent flushes remain enabled. Any runtime integration must be a separate DDD/TDD phase after this investigation.
>
 > **Historical 2026-11-06 implementation snapshot — superseded by the current 2026-11-09 forensic direction stated above:** PR #513 and #515 established the incident lifecycle/accounting baseline. PR #545 added automatic account-wide PREFLIGHT auditing on every broker-connected startup; PR #546 corrected Binance WebSocket fill timestamps to use transaction time `T` for same-process reconciliation; PR #552 recorded the startup-audit completion; PR #553 reconciled the Journal durability policy; PR #554 fixed aggregate BUY/SELL commitment over-allocation; PR #559 added same-process canonical lookup and reconciliation for lost submission acknowledgements. All changes listed above are merged into `develop`; the remaining work is separately authorized TESTNET acceptance. PR-specific CI claims must be verified against each exact final PR head; historical green runs do not certify later commits.
>
> The startup audit is a required evidence gate: both full balances and account-wide open orders must be durably journaled before market subscriptions or trading-engine activation. Existing open orders are recorded as external/unowned but do not make the audit a trading-startup rejection. Broader Journal delivery remains asynchronous during trading; Journal is not trading-state authority.
>
 > At that time, the remaining critical milestone was joint Binance Spot TESTNET validation. Offline CI is not exchange acceptance. TESTNET remains paused/unverified under the regional eligibility restriction; this historical milestone does not supersede the current #654 forensic workstream.
>
> The historical twelve-BUY incident is established: twelve distinct 400 DOGE BUYs at 0.07598 USDT (4,800 DOGE / 364.704 USDT gross), client IDs `h-DOGEUSDT-32` through `h-DOGEUSDT-43`, all TAKER. The confirmed race was FILLED acknowledgements preceding canonical fill application. The merged engine awaits full execution reconciliation before releasing the serialized transition; offline regression coverage includes twelve sequential immediate fills and weighted execution-price references. TAKER execution alone does not explain the repeated BUYs.
>
> Actual TESTNET commission amounts/assets must be reconciled per trade. Historical fills reporting zero commission remain zero; never retroactively apply the later 0.1% setting. Existing account inventory (previous baseline: 517 non-zero assets, including 12,321 free DOGE) is not Harvester-owned by default.
>
> Older sections below are historical implementation notes. Where they conflict with this current post-merge status, follow this notice and the final handoff section at the end of this roadmap.

## Conservative domain rule extraction — PR #653

The Conservative policy now delegates its core state predicates to
`src/domain/strategies/conservative/helpers.js`. Each predicate has
a focused deterministic unit test in `helpers.test.js`; the policy
continues to own intent calculation and order economics, while the trading
engine continues to own broker lifecycle and I/O.

This is an internal organization change only. The canonical behavior contract
remains [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md);
no strategy behavior change or TESTNET acceptance is claimed. The focused
tests and full Harvester suite still require execution on the exact PR head.

## Future improvements — planned, not implemented

These items are intentionally recorded for future work. They are not current trading requirements, do not block the Conservative strategy, and must not be implemented as part of unrelated work without selecting them explicitly.

### C. Consolidated trading-session statistics

- [ ] Design and implement a clear per-session/per-market trading report using confirmed, deduplicated fills and actual commission amounts/assets as the source of truth.
- [ ] Report total BUY/SELL quantities and quote values, actual commissions by asset, total invested quote, recovered net proceeds, remaining recovery amount, and realized net profit.
- [ ] Report retained/free inventory separately from active strategy inventory, including any exchange-constrained dust.
- [ ] Show current/open order status and partial execution quantities without treating unfilled orders as executions.
- [ ] Keep calculations consistent with Portfolio and RecoveryLedger; do not introduce a second accounting source or mutate trading state for reporting.
- [ ] Provide a readable CLI/session summary first; decide on export/persistence only when that work is selected.

### D. Optional Telegram notifications

- [x] Integrate Harvester with the existing @coinzilla/notifiers package for optional Telegram notifications (PR #734; optional, bounded and failure-isolated).
- [x] Map low-volume Harvester lifecycle, broker, order, fill, recovery, and account-safety events to the shared notifier vocabulary; do not publish market ticks or routine strategy decisions. The expanded event contract is provided by Notifiers PR #997 and Harvester integration is tracked by [#998](https://github.com/45s/coinzilla/issues/998).
- [x] Keep notification delivery asynchronous and isolated: missing credentials, Telegram outages, formatting errors, or subscriber failures must never block order handling, accounting, startup readiness, or shutdown safety.
- [x] Reuse the Notifiers event-selection contract and event bus; do not add Telegram SDK logic to Harvester domain/use-case code or duplicate the notifier package.
- [~] Configure the named `minimal`, `trader`, `verbose`, and `custom` profile constants from `config/notifications-tg-profiles.js`, select the profile in `config/index.js`, and keep event overrides, market filters, and non-disableable safety alerts in `appConfig.notifications.telegram`; keep credentials environment-only. The default profile is `trader`, but Telegram transport is created only when both credentials are present and `notifications.telegram.enabled` is not false. Implementation and documentation are in [#998](https://github.com/45s/coinzilla/issues/998).

## Current work selection

- [x] Close the 2026-11-07/08 session follow-up: source-level findings are resolved by PRs [#653](https://github.com/45s/coinzilla/pull/653), [#663](https://github.com/45s/coinzilla/pull/663), [#664](https://github.com/45s/coinzilla/pull/664), [#669](https://github.com/45s/coinzilla/pull/669), [#670](https://github.com/45s/coinzilla/pull/670), and [#673](https://github.com/45s/coinzilla/pull/673). Tracking audit [#667](https://github.com/45s/coinzilla/issues/667) is closed; evidence: [AUDIT.md session report](./docs/audits/reports/AUDIT.md#2026-11-0708-binance-spot-testnet-session-audit--issue-667). TESTNET acceptance is separate and paused/unverified.
- [x] Graceful shutdown: cancel acknowledged `CG_coinGrabber` BUY orders only, preserve all SELL orders, keep user-data intake active through cancellation/fill reconciliation, and retain the existing CLOSING audit/process-lock guarantees. Implemented and merged in [PR #663](https://github.com/45s/coinzilla/pull/663).
- [x] Account-integrity safety halt: after an unowned/invalid execution or accounting failure closes global readiness, reconcile Harvester-owned order identities and cancel only acknowledged BUY orders; preserve SELLs and external orders; keep the gate closed if any cancellation/fill reconciliation is unresolved. Tracking incident [#667](https://github.com/45s/coinzilla/issues/667), implementation PR [#669](https://github.com/45s/coinzilla/pull/669).

The former blanket TESTNET acceptance gate is removed. Explicitly selected Harvester work may proceed independently of TESTNET acceptance. The #654 restriction against implementation applies only to restart-recovery work; the separately selected application-config/notification task must not alter restart recovery. Issue [#650](https://github.com/45s/coinzilla/issues/650) is the active Journal evidence workstream.

- [~] Unified application configuration and Telegram notification profiles: owner-selected implementation tracked by [#998](https://github.com/45s/coinzilla/issues/998), dependent on the shared Notifiers event-selection contract in [#996](https://github.com/45s/coinzilla/issues/996). This work does not change strategy, broker, exchange, order-execution, or restart-recovery behavior.

Trading safety requirements remain in force: the operator selects TESTNET or LIVE explicitly through `TRADING_MODE`; `live` means real Binance order execution. Keep order-safety protections, exact-order ownership, and the existing mandatory Journal durability barriers intact. Journal evidence beyond those barriers is bounded, allowlisted, and best-effort. Journal is not trading-state authority. Replay and process-restart recovery remain disabled unless separately requested.

## Strategy-scoped trading configuration

- [~] Move the single application-wide configuration object from JSON into named native ESM modules; keep Telegram profile constants named, preserve runtime validation, and retain safe `config:symbol` pair updates ([PR #1064](https://github.com/45s/coinzilla/pull/1064)).

- [x] Keep strategy-owned trading configuration under `strategies.CG_coinGrabber`, including the strategy enabled flag, settings, and all market pairs, within the single application-wide `config/index.js`.
- [~] Keep application-wide notification policy in the sibling `notifications.telegram` section; do not mix Telegram credentials or delivery logic into strategy configuration.
- [~] Keep Conservative and Aggressive mode toggles under `CG_coinGrabber.settings`; Conservative remains enabled and Aggressive remains disabled/deferred.
- [x] Update runtime consumers, validation/bootstrap tests, and configuration documentation together — completed in [PR #839](https://github.com/45s/coinzilla/pull/839).

## Journal evidence workstream

- [x] **#923 — Journal DTO compatibility:** implemented and merged in [PR #925](https://github.com/45s/coinzilla/pull/925). Non-negative safe-integer timestamps excluding negative zero, finite numeric diagnostics, structured mapper-failure reporting and no-publication-on-failure are enforced at the DTO boundary. Exact PR head `9329fe2dc2fb1af785548261f23dff4757e0282b` passed 875/875 Harvester tests; coverage was 75.62% lines, 78.94% branches and 74.95% functions. All six required checks passed; no TESTNET/LIVE activity occurred.

Issue [#650](https://github.com/45s/coinzilla/issues/650) is active independently of TESTNET acceptance. Expand investigation evidence within the bounded, allowlisted, best-effort contract in [JOURNAL_EVIDENCE_CONTRACT.md](./docs/JOURNAL_EVIDENCE_CONTRACT.md). Keep Journal replay and process-restart recovery disabled unless separately requested.

## Mission and delivery priority

**Mandatory execution order:** follow [Trading First](./docs/TRADING_FIRST.md). The first deliverable is a working Conservative TESTNET trading loop. Journal, durable persistence, comprehensive restart recovery/reconciliation, operational hardening, and Aggressive are secondary; do not make them blockers for the first working cycle. Implement only the minimum safety needed for a controlled TESTNET order flow.

**First priority: implement Conservative and make Harvester execute a complete, safe, repeatable trading cycle.** The Harvester-owned Conservative Domain Specification is the source of truth. Implement the strategy through Harvester's own domain and application boundaries. Strategy availability is configured in `config/index.js` under `strategies`: Conservative is enabled and Aggressive remains disabled until Conservative is working end to end on TESTNET. Application-wide notification policy is a sibling `notifications` section and does not change strategy or exchange selection. Architecture expansion, optional features, and optimization come after that.

The paragraph below was an earlier audit snapshot and is superseded by the current implementation status and checklist in this roadmap. On `develop`, Harvester now composes the Conservative trading engine when TESTNET trading is explicitly enabled, submits strategy intents through the engine, tracks owned orders, processes canonical fills, updates Portfolio/RecoveryLedger, and has fake-broker coverage for a complete recovery cycle. A real Binance TESTNET cycle is still unverified; do not treat the offline simulation as exchange proof.

### Definition of "Harvester can trade"

The Conservative runtime supports multiple explicitly enabled TESTNET pairs. Each enabled market is validated and subscribed independently; per-market strategy state is isolated while account-level asset balances and active-order commitments are shared by canonical asset identity. Multi-pair TESTNET acceptance still requires dedicated regression and exchange evidence.

A first-trading release is not complete until a TESTNET end-to-end scenario demonstrates:

1. Start from the documented command and load/validate configuration.
2. Connect to the selected broker and establish market-data and user-data streams.
3. Load account balances and exchange trading rules for every enabled pair.
4. Establish the minimum safe TESTNET starting state: fresh balances and exchange filters for enabled pairs and a known price. External inventory and orders remain unowned and are not silently adopted; a clean account is recommended for a controlled first-cycle run but is not a startup prerequisite. Comprehensive historical reconciliation and durable restart recovery are deferred.
5. Receive a valid market update and evaluate the selected executable strategy.
6. Convert the strategy decision into a validated order intent.
7. Apply shared risk, balance, reservation, precision, minimum-notional, and post-only checks.
8. Submit the order and track its acknowledgement or an unknown outcome.
9. Receive order updates and every partial/final fill; normalize, deduplicate, and account for actual quantities and commissions.
10. Re-evaluate the strategy from the latest consistent market, order, and Portfolio state and continue the cycle.
11. Pause new orders safely on disconnect, stale data, unknown order outcomes, unsupported commission, balance/risk violations, or other immediate execution hazards; resume only after the affected live state is refreshed and understood.
12. Shut down cleanly and do not report in-flight orders as completed. Durable restart recovery is a later hardening milestone.

`TRADING_MODE=testnet` selects Binance Spot TESTNET; `TRADING_MODE=live` selects Binance Spot LIVE and enables order execution without a separate trading-enable flag. The startup environment must explicitly contain one of these values; missing or invalid values must fail startup. TESTNET validation remains a separate evidence milestone and does not itself select LIVE.

## Runtime entrypoint hardening — current task

- [x] Remove public `runtime.placeOrder` and `runtime.broker` escape hatches.
      The broker port remains private to bootstrap and the Conservative engine;
      runtime consumers cannot submit orders outside the engine workflow.
- [x] Report the actual startup mode: Conservative TESTNET or LIVE trading enabled. Harvester requires an explicit `TRADING_MODE` and always connects to Binance; there is no read-only/no-broker runtime profile.
- [x] Add regression coverage for startup messages and the absence of public
      broker/order-submission methods.
- [x] Update the README and agent delivery rules in the same implementation
      commit as the code and tests.
- [ ] Run Harvester tests and repository CI on the PR head; do not treat source
      inspection or a successful GitHub write as test verification.

This hardening does not change strategy decisions or claim a successful real
TESTNET cycle. The next proof remains a controlled Binance TESTNET run.

## Historical implementation snapshot — initial TESTNET pair selection

> The default-pair statement in this snapshot records the earlier DOGEUSDT/ZROUSDT configuration. The committed config now enables only ZROFDUSD. This historical text is retained as evidence, not current operator guidance or TESTNET authorization.

At the time of this snapshot, the task branch had progressed beyond the initial `develop` audit described
below. The following first-cycle components were implemented and composed
when `TRADING_MODE=testnet` was selected:

- Conservative pure policy: initial/standing BUY and recovery SELL intents,
  exact tick/step rounding, duplicate suppression, partial-fill wait behavior,
  configured pair-investment limit, exchange-fee-aware recovery planning.
- Submission: local PENDING canonical order registration, exchange-rule
  validation, broker submission, canonical acknowledgement verification, and
  unknown-outcome pause behavior.
- In-process lifecycle: market prices invoke the policy; only registered
  Harvester orders are accepted; canonical TRADE fills update Portfolio and
  RecoveryLedger; terminal full fills trigger the next decision.
- Recovery completion: a fully filled SELL must satisfy the actual cumulative
  net-profit condition and leave at least `keepQuantity`; the retained amount
  moves to free inventory and the cycle ledger resets.
- Startup: explicit `TRADING_MODE=testnet` selection, one or more enabled pairs, and a fresh initial canonical account snapshot covering every enabled market's assets. Trading is enabled in either exchange mode; no separate trading-enable flag is used. External open orders and pre-existing inventory are not adopted; order checks use in-process cash flow, owned position quantity, and outstanding commitments. The then-current config enabled `ZROUSDT` and `DOGEUSDT`; FDUSD pairs were disabled.

Offline bootstrap coverage simulates the complete first recovery cycle:
initial BUY → actual full BUY fill → next BUY and recovery SELL → actual full
SELL fill → profit check → free-inventory allocation. This is a fake-broker
simulation, not evidence of exchange behavior by itself. Real Binance TESTNET
executions have since been observed, including a completed recovery SELL, but
the same run exposed rapid BUY re-submission and an invalid post-cycle
MIN_NOTIONAL intent. Reservations and the safe repeatable TESTNET acceptance cycle remain unfinished. Durable Journal replay/restart recovery is intentionally disabled and is not a blocker. Do not mark the first trading
milestone complete until the incident fixes, reconciliation, and required CI
checks pass.

## Automated TESTNET startup account audit

- [x] On every trading-enabled startup, fetch the full exchange account balance snapshot and durably journal the OPENING account event before the trading engine is activated.
- [x] Fetch open orders account-wide (`getOpenOrders({})`, no symbol filter), normalize the complete order facts into an allowlisted Journal event, and durably flush it before market subscriptions.
- [x] Fail closed if the open-order query is unavailable/malformed or any pre-existing open order is present. Do not adopt or cancel orders; restart ownership recovery is not implemented yet.
- [x] Add DTO and bootstrap regressions for full order facts, empty-account READY, pre-existing-order BLOCKED, and no market subscription/order activation after a block.
- [ ] Verify Harvester tests and repository CI on the feature branch.
- [ ] After merge, the user only needs to start Harvester; no repeated manual balances/orders output is required. Inspect the Journal automatically for account baseline and open-order audit results.

## Standalone read-only TESTNET account preflight

- [x] Add `pnpm run testnet:audit` to query account balances and account-wide open orders through the Binance WebSocket API without starting Harvester.
- [x] Journal and durably flush both account events with phase `PREFLIGHT`; keep the normal Harvester startup gate using phase `OPENING`.
- [x] Return READY when there are no open orders and BLOCKED (exit code 2) when any pre-existing order is found; never submit or cancel orders.
- [x] Add offline tests for full balance/order capture, blocked and ready results, TESTNET-only environment validation, query failure, and resource cleanup.
- [ ] Verify the standalone audit command and full repository CI on this PR head.

## P0 — Deliver the first working trading cycle

Work through these items in dependency order. Keep the scope limited to what is necessary to execute and verify the first strategy safely.

### P0.1 — Conservative strategy contract and implementation

- [x] Select Conservative as the first executable strategy; Aggressive remains deferred.
- [x] Establish one authoritative strategy contract: [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).
- [~] Align domain policy, application order lifecycle, configuration validation, and regression tests with that canonical contract.
- [~] Complete documentation consolidation under [the Harvester documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) and [repository-wide governance](../../docs/DOCUMENTATION_GOVERNANCE.md); preserve historical audit evidence and verify no active competing Conservative rule definitions remain. Tracking: [#795](https://github.com/45s/coinzilla/issues/795).
- [ ] Pass the focused regression matrix and all required exact-head CI checks before acceptance.
- [ ] Keep PR #653 open and unmerged until acceptance criteria pass and the owner explicitly authorizes merging.

### P0.2 — Trading rules, account state, and startup readiness

- [x] Load and validate exchange symbol filters for enabled markets: price tick, quantity step, min/max quantity, min/max notional, and supported order types. POST-ONLY orders require fresh best-bid/best-ask data and validate BUY below best ask / SELL above best bid at both submission gates; missing/stale/crossed books defer broker I/O. Binance Spot's exact definite POST-ONLY rejection is handled without pausing, while other/unknown failures remain fail-closed.
- [x] Normalize broker filters into a stable Harvester-owned domain/application shape; do not leak exchange SDK payloads.
- [~] Load account balances and distinguish free, locked, and total balances. A canonical free/locked account snapshot is loaded and checked for every enabled-market asset; in-process allocation aggregates Harvester-owned inventory and active commitments by canonical asset ID. Periodic account refresh and external account-change reconciliation remain.
- [x] Enforce configured per-pair investment against available quote balance while coordinating shared quote assets across enabled pairs (e.g. multiple USDT markets) through the exact-decimal allocator.
- [x] Seed Conservative TESTNET market state after subscribing: use the existing Binance `ticker.price` request/response snapshot when no fresh aggregate-trade event arrived during startup. Reject invalid snapshots, fail startup when neither source provides a usable price, and reject WebSocket prices older than 5 seconds (or more than 1 second in the future). Enforce cached-price freshness at both order-submission gates, including after PENDING registration and before each action in a multi-order decision; defer broker I/O when the price expires.
- [x] Subscribe to user-data events and surface connection status. Startup uses one canonical account snapshot and known enabled-pair filters. External inventory/orders remain unowned; a clean account is a controlled-test recommendation, not a launch gate. Disconnect/recovery and unknown outcomes remain fail-closed; comprehensive history reconciliation is deferred.
- [x] Implement minimum process readiness for the first TESTNET cycle. When `TRADING_MODE=testnet` is selected, startup requires at least one enabled pair, exchange rules for every enabled market, an active user-data stream, and a fresh account snapshot covering every enabled market's assets. External open orders and inventory are not adopted or treated as a startup prerequisite; genuine reconnect/reconciliation requirements still fail closed.
- [x] Enable order execution after the selected `TRADING_MODE` is validated and strategy configuration, enabled-pair exchange filters, a fresh account snapshot, and an active user-data stream are ready. `testnet` selects Binance Spot TESTNET; `live` selects Binance Spot LIVE. The policy prevents a new BUY from taking outstanding recovery capital plus its quote notional beyond the configured pair investment. Before submission the engine checks BUY quote notional against snapshot free quote adjusted by actual quote cash flow and active BUY commitments; SELL quantity is capped by Harvester-owned active base inventory and available free base after active SELL commitments. A balance-limited BUY is deferred while a valid recovery SELL may still proceed.
- [x] Replace legacy runtime profiles and `NODE_ENV`-based exchange selection with the single `TRADING_MODE=testnet|live` environment variable. Completed on [PR #841](https://github.com/45s/coinzilla/pull/841), merged 2026-11-09: Binance is the fixed broker; trading is enabled in either mode; missing or invalid mode fails startup; strategy and pair settings were stored in the previous configuration file at the time; the current single application-wide filename is `config/index.js`. All six required exact-head CI contexts passed; the optional read-only Binance TESTNET integration check was skipped. This completes explicit mode/endpoint selection, not live-trading or TESTNET acceptance.
- [x] Validate enabled pair configuration against exchange assets/filters at startup: `orderQuantity` is rounded down by the actual base-asset step and checked against supported min/max quantity; quote-asset `investment` is checked against minimum notional. The symbol must match the exchange market metadata. Actual price/quantity/notional validation remains at order submission.

### P0.3 — Order intent, safety checks, and reservations

- [~] Define canonical Harvester order intent/command contracts using existing `@coinzilla/entities` types wherever suitable. `createPendingCanonicalOrder` builds immutable PENDING canonical orders; the complete engine command contract and lifecycle integration remain.
- [~] Implement pure order construction and validation functions for price/quantity precision, tick/step rounding, min/max quantity, min/max notional, and post-only constraints. `validateOrderAgainstTradingRules` enforces exchange increments and supported price/quantity/notional bounds with exact decimal arithmetic. Fresh book-based POST-ONLY crossing validation is enforced at both submission gates; complete order construction wiring and other runtime checks remain.
- [~] Implement shared pre-trade safety checks: enabled pair and READY state are enforced at runtime; fresh price/book, available quote/base, pair investment headroom, and active-order commitments are enforced by the engine and exact-decimal allocator. The Conservative engine aggregates quote cash flow, owned base inventory, and active BUY/SELL commitments across markets by canonical asset ID. Periodic account refresh/external account-change detection, generalized per-pair risk policy, and strategy takeover remain open.
- [x] Implement in-process BUY quote and SELL base reservations using active canonical orders as the reservation source. The engine registers PENDING before broker I/O and derives remaining commitments from PENDING/OPEN/PARTIALLY_FILLED/UNKNOWN orders; confirmed fills reduce the remaining order quantity while Portfolio/RecoveryLedger apply actual execution facts.
- [x] Use canonical order lifecycle states as reservation states rather than introducing a parallel reservation entity. PENDING, OPEN, PARTIALLY_FILLED, and UNKNOWN retain commitments; confirmed terminal states release the unfilled remainder, while late FILLED updates remain reconcilable.
- [x] Register each PENDING canonical order before broker submission and serialize market/order/fill/cancellation transitions. Unknown submission or cancellation outcomes remain active/paused until authoritative reconciliation; commitments are not released on an unconfirmed outcome.
- [x] Allocate each decision's order intents sequentially against remaining quote balance, pair investment headroom (outstanding recovery plus active BUY commitments), exchange-available base, and Harvester-owned active base. The allocator rejects an overcommitted SELL batch before any broker write and defers BUY intents that exceed remaining quote or investment headroom. Regression tests cover aggregate BUY and SELL intents.
- [~] Treat timeout/disconnect during place/cancel as UNKNOWN, not failed; the current process keeps the order commitment and pauses without retrying. During same-process recovery/shutdown, Harvester looks up a broker-acknowledged order by its original clientOrderId, attaches only a matching brokerOrderId, then reconciles canonical order history and actual fills. If lookup/history/fills are incomplete or conflict, the order remains UNKNOWN and the pair stays paused. Durable Journal-backed registry recovery after process restart remains unimplemented; the runbook requires abort/stop and operator investigation rather than restart.
- [~] Generate Binance-compatible client order IDs with a per-executor 88-bit random namespace and monotonic local sequence. Same-process client-ID lookup now reconciles a lost acknowledgement without retrying. Durable restart recovery, idempotent retries, and automatic resume remain unfinished.
- [x] The Conservative cancellation/replacement paths await broker confirmation, reconcile fills that raced with cancellation, and calculate replacement quantities from the reconciled Portfolio/RecoveryLedger. Deterministic engine regressions cover BUY and recovery-SELL cancellation/fill races.
- [x] Unknown submission/cancellation outcomes pause the affected pair and are not blindly retried. Same-process lost-ack reconciliation uses canonical lookup by clientOrderId followed by canonical order history and fill verification. Durable restart recovery and automatic resume remain deferred.

### P0.4 — Live order and fill lifecycle

- [x] Normalize user-data order/execution events at the broker adapter boundary. Binance TRADE execution reports are converted into canonical `Fill` entities using cached symbol metadata; non-trade order events remain normalized broker events. Normalization failures now include execution context and close the user-data trading gate.
- [x] Normalize actual fills with stable execution IDs, market, side, executed base and quote quantities, timestamps, and exchange-charged commission amount/asset. Missing/invalid execution IDs and incomplete fee facts fail closed.
- [x] Reject malformed or incomplete fills visibly; validate aggregate base/quote commission bounds and surface Binance normalization failures with an actionable pause reason. Third-asset commission quote valuation or fail-closed behavior is defined in the canonical specification and remains an implementation verification item.
- [x] Deduplicate fills using stable exchange execution identity and conflicting-fact fingerprints; serialize user-data event handling and Portfolio/RecoveryLedger updates in process memory. Fingerprint tests cover every mutable canonical execution fact and commission-entry order. Durable deduplication is explicitly deferred; it is not a P0.4 prerequisite.
- [x] **Verify order ownership before accounting:** the in-process engine applies updates only to orders registered with Harvester; unknown/manual executions pause only the affected pair and are not accounted. Deterministic multi-market tests cover cross-pair isolation, duplicate fills, and stale out-of-order order updates.
- [x] Handle NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and exchange-specific terminal/unknown states. Adapter mapping, engine wait/pause/reevaluation behavior, and late FILLED-after-EXPIRED races have deterministic offline coverage.
- [x] Apply only incremental actual executions to shared Portfolio and Conservative RecoveryLedger in one immutable use-case transition; never apply requested order quantity or cumulative executed quantity twice. Regression coverage proves a rejected wrong-market fill cannot commit only the Portfolio projection.
- [x] Expose canonical per-order Binance WebSocket API history through the Harvester broker port. The application-owned broker port and Binance adapter forward the existing broker package's `CanonicalOrder[]` capability; reconnect-time reconciliation is tracked in the next item.
- [x] Reconcile WebSocket API trade history/open orders with user-data stream events to cover disconnect gaps and out-of-order delivery. After stream-level recovery, bootstrap reads WebSocket API request/response snapshots without blocking stream events, drains events received during those reads, then applies reconciliation of only in-memory owned orders in the serialized engine queue. It validates complete cumulative fill quantities, rejects WebSocket API history behind stream-updated order state, and requires every previously processed stream execution ID to appear in the WebSocket API history before applying missing fills through the existing idempotent accounting path. Incomplete/conflicting WebSocket API request/response state keeps the market paused and trading gate closed. External/manual orders are never adopted. Durable restart and balance reconciliation remain deferred.
- [x] Reconcile completed recovery SELL execution history before cycle completion: distinct actual fill quantities must equal both executed and original order quantity; missing/incomplete history pauses before free-inventory allocation or ledger reset.
- [x] Ensure cancel/fill races, duplicate events, late events, and out-of-order events cannot double-count fills or release commitments prematurely. BUY and recovery SELL cancellation fill races, duplicate events, and stale out-of-order reports have deterministic offline coverage. Active canonical order commitments remain until authoritative lifecycle/fill reconciliation; late FILLED updates remain reconcilable.
- [x] Feed successful fill/order transitions back into strategy evaluation. The engine emits a reevaluation outcome after a reconciled terminal full fill; bootstrap runs that evaluation from the serialized user-data event flow and deliberately waits after partial fills.
- [x] Ensure a completed BUY transition immediately evaluates and submits required orders without waiting for another market-price event.

### P0.5 — Trading Engine orchestration

- [x] Implement the first in-process Conservative trading workflow. `makeConservativeTradingEngine` connects market prices to the pure policy, order registry, validated broker submission, canonical order updates, ownership checks, fill accounting, and immediate reevaluation after terminal order updates. Bootstrap composes the user-data callback and account-readiness gate; in-process order-backed quote/base commitments are derived from active canonical orders. Durable restart and periodic account reconciliation remain separate work.
- [~] Inject strategy decision evaluation and trailing-BUY repricing through a broker-independent policy object composed by bootstrap. The engine no longer imports Conservative policy calculators; Conservative-specific order lifecycle sequencing remains in the engine and is not yet generalized.
- [~] Only the Conservative policy is currently composed for execution and startup rejects Aggressive enablement, so one strategy controls the first pair. A generalized strategy-ownership/takeover registry remains deferred.
- [x] Serialize concurrent market-price, book, user-data/order, fill, cancellation, and reconciliation transitions through the engine's process-local transition queue; bootstrap also serializes accepted user-data delivery. Deferred-promise regressions cover pending acknowledgements, cancellations, and concurrent market updates.
- [~] Enforce market-price and book freshness at evaluation and both submission gates, serialize transitions, and reconcile owned order/fill state before resuming. The startup account snapshot is not periodically refreshed for external account activity; the controlled one-pair run forbids manual account changes, and comprehensive account reconciliation remains open.
- [ ] Handle strategy takeover as a controlled workflow: stop outgoing intents, reconcile/cancel relevant orders, account for in-flight fills/reservations, then activate the incoming strategy.
- [~] Startup failure cleanup, process shutdown, and user-data recovery gates are observable and covered. Reconnect does not reopen trading until authoritative order/fill reconciliation succeeds; generalized pause/resume and durable restart recovery remain incomplete.
- [~] Replace the current price-only callback flow with the actual decision-to-order execution pipeline. A tested application use case now converts pure Conservative intents into registered, exchange-rule-validated broker submissions; bootstrap composition and event-driven lifecycle integration remain.
- [x] Do not expose `runtime.placeOrder` or `runtime.broker`; all order submission remains private to the composed Conservative engine and its broker port.

### Active forensic workstream #654 — Persistence, restart, and comprehensive recovery (implementation separate)

- [ ] Decide the minimum durable state required before enabling unattended trading: orders/client IDs, fills/deduplication IDs, reservations, Portfolio/Position, strategy control state, and relevant configuration/version.
- [ ] Reconnect and complete the existing PR #606 recovery helper pipeline in a separate DDD/TDD implementation phase after this forensic investigation; this is not implementation authorization for the current phase.
- [ ] Persist execution facts before acknowledging successful processing/recovery.
- [ ] On startup/reconnect, reconcile persisted state against exchange balances, open orders, and available order/trade history before READY.
- [ ] **History discovery:** enumerate all nested `logs/sessions/<process-session>/` directories and legacy flat Journal sessions. The current Journal reader scans only direct files in its configured directory; the new process-specific directory cannot discover prior sibling sessions.
- [ ] **Open-order readiness:** define and test the policy for unowned account-wide orders. Current PREFLIGHT can record `BLOCKED` while `subscribeToUserData()` still sets READY; same-symbol overlap must be tested with a market tick.
- [ ] **Operational State Store contract:** resolve the conflict between crash-safe fill/pause persistence and the current rule that additional Journal evidence must not block fill accounting. Evaluate a Operational State Store port before changing Journal's role.
- [ ] **History completeness:** do not override `marketUniverseComplete: false`; establish a provable owned-market/history scope and retention boundary, otherwise require operator reconciliation.
- [ ] **Recovery-cycle restoration:** replay must reproduce the live atomic completion transition: require exact `freeQuantity === activeQuantity`, allocate the complete retained inventory, reset `Position.spent`, and reset RecoveryLedger together. Current restore helper omits the Position cost-basis reset (F-038).
- [ ] Define behavior when exchange history is incomplete, retention-limited, or conflicts with local state; fail closed and require operator intervention where safe reconciliation is impossible.
- [ ] Test crash/restart at each order/fill transition and ensure no duplicate order or fill application.
- [ ] Do not claim exactly-once delivery; guarantee idempotent accounting through durable execution identity and reconciliation.

### Historical P0.7 — First strategy end-to-end verification (superseded status; evidence only)

- [x] Verify Conservative recovery SELL quantity/price rounding against actual base/quote commission fills at quantity-step, price-tick, and exact minProfit boundaries. Tests assert post-fill active inventory and realized net profit using exact decimal strings.

- [~] Add deterministic offline strategy-policy scenarios for initial BUY, duplicate suppression, combined standing BUY/recovery SELL intents, and missing exchange rules. Full broker-port lifecycle simulator scenarios remain.
- [ ] Add opt-in Binance TESTNET integration tests that place and cancel small, bounded test orders only when explicitly enabled.
- [~] Add a bootstrap-level TESTNET-mode fake-broker test that starts with a clean one-pair account, submits the initial Conservative BUY, applies its canonical full fill, and immediately submits the next BUY plus recovery SELL. The fake-broker bootstrap scenario now exercises the full first recovery cycle through BUY fill, simultaneous next BUY/recovery SELL placement, SELL fill, profit verification, and allocation of configured free inventory. A real Binance TESTNET run remains; the README now contains the controlled runbook, clean-account prerequisites, shutdown/restart warning, and expected order sequence.
- [ ] For end-to-end proof, exercise multiple enabled TESTNET pairs, including markets sharing quote assets and markets sharing base assets. Verify per-pair investment limits, account-level commitments, order/fill isolation, and that no pair can spend balances reserved by another.
- [~] Offline coverage verifies pre-submit quote/investment/base budget enforcement, min-notional and precision validation, fresh-book POST-ONLY crossing checks, stale price/book deferral, stream-loss trading gates, and unknown-outcome pause/no-retry behavior. Real Binance rejection, timeout, and recovery behavior remains NOT OBSERVED until the controlled TESTNET session.
- [ ] Verify loss protection and Conservative takeover do not force a loss-making sale or operate the same Position concurrently.
- [~] Provide a documented, reproducible TESTNET runbook and evidence for the first successful cycle. The runbook exists; a full recovery SELL fill and `recovery.cycle_completed` are now evidenced, but the same run exposed a rapid-BUY burst and a post-cycle MIN_NOTIONAL failure. A safe next-cycle BUY and repeatable cycle are not verified.
- [~] LIVE execution is explicitly selected by `TRADING_MODE=live` and uses real funds. This code path is implemented, but no live exchange activity is authorized or claimed by this PR; operator selection and separate operational approval remain required.

## P1 — Implement Aggressive after Conservative is proven

- [x] Keep Aggressive disabled through `strategies.CG_coinGrabber.settings.aggressive.enabled=false` in `config/index.js`; configuration validation rejects attempts to enable it. Conservative is the only default evaluator and the only strategy composed for order execution.

Aggressive work must not delay P0. Start this phase only after Conservative has completed and passed the documented TESTNET end-to-end cycle.

- [ ] Review the remaining Aggressive decisions in [Trading Strategies](./docs/trading-strategies.md), ask one plain-language product question at a time, and update the specification before implementing unresolved behavior.
- [ ] Implement the Aggressive policy as plain pure domain functions that return order intents; do not copy broker/runtime code from another app.
- [ ] Implement exactly one BUY grid per market, with all configured BUY levels placed together when the cycle starts.
- [ ] Preserve the agreed grid math: lower BUY levels remain fixed percentages from the grid reference; upward repricing steps compound from the previous level and advance only by fully crossed steps.
- [ ] Implement per-BUY-order cumulative fill thresholds: create a separate SELL only after that BUY order is more than 50% filled and eligible unreserved quantity is worth strictly more than $5 USD equivalent; otherwise wait for full fill or more quantity.
- [ ] Implement multiple independent SELL orders against one shared Position, with explicit reservations so the same base quantity cannot be sold twice.
- [ ] Implement the agreed partial-SELL threshold for considering a new BUY, including duplicate-trigger prevention.
- [ ] Implement risk fallback to Conservative when either the investment limit or maximum price-drop limit is reached: stop new BUYs, cancel/reconcile all active orders, and consolidate remaining inventory into one Conservative SELL without forcing a loss.
- [ ] Add deterministic domain tests for grid construction/repricing, partial fills, reservations, cancel/fill races, risk fallback, and strategy handover.
- [ ] Verify Aggressive end to end on TESTNET using the same shared Trading Engine, Portfolio, order lifecycle, and safety gates as Conservative.
- [ ] Add strategy-specific statistics only after shared Position accounting and attribution semantics are stable.

## P2 — Operational hardening and improvements

- [ ] Complete the staged operational Journal integration described in [Journal Integration Roadmap](./docs/JOURNAL_INTEGRATION_ROADMAP.md). Optional operational evidence must not add blocking I/O to strategy evaluation, market processing, broker-event handling or fill accounting. Preserve the existing required broker-connected PREFLIGHT and pre-order/cancel durability barriers. Process-restart recovery is separate under [#654](https://github.com/45s/coinzilla/issues/654); do not silently extend the Journal observer into trading-state authority or add a new fill-persistence barrier without an explicit architecture decision.
- [ ] Add actionable health/status reporting for process and each pair without exposing credentials or raw exchange payloads.
- [ ] Add bounded reconnect/backoff, timeouts, stream liveness/staleness detection, and resource cleanup tests.
- [ ] Add operator controls for pause/resume/stop and safe behavior when a pair is disabled while orders or inventory exist.
- [ ] Add alerts for unsafe states, rejected orders, reconciliation discrepancies, unsupported commissions, and repeated broker failures.
- [ ] Add performance optimization only after profiling a correct end-to-end implementation.
- [ ] Review dependency/security findings and shared package contracts as part of regular maintenance.

## Product and architecture decisions already recorded

- [x] Harvester is an independent Node.js process with shared engine and strategy-specific policies.
- [x] Domain, application use cases, infrastructure adapters, and bootstrap have explicit responsibilities.
- [x] Meaningful deterministic calculations and decisions MUST be plain pure functions in focused modules.
- [x] Classes are for domain concepts that own state and protect invariants (e.g. Fill, Position, Portfolio).
- [x] Use cases are dependency-injected functions; strategies decide and never perform broker I/O.
- [x] Harvester owns its application-facing broker port and adapts `@coinzilla/brokers`.
- [x] One shared CG-owned Position per market; Conservative and Aggressive share CG accounting, but only one CG mode controls the pair at a time. RS may own independent Positions in the same Portfolio.
- [x] Confirmed canonical fills, including exchange-charged commissions, are the only source of Portfolio holdings changes.
- [x] Third-asset commissions require reliable quote valuation or fail-closed handling; see the canonical Conservative specification.
- [x] BUY prices round down and SELL prices round up to exchange tick rules.
- [x] Live exchange tests are opt-in and TESTNET-only; default tests never need credentials or network access.
- [x] Use shared `@coinzilla/utils` decimal functions and `defaultLogger`; do not duplicate generic utilities or call global console from Harvester.

## Open product decisions

- [x] Conservative owner decisions are closed and recorded in the canonical specification. No additional Conservative product decisions are pending.
- [ ] Finalize shared application reservation timing/release rules for submitted, partially filled, cancelled, rejected, expired, and uncertain orders; do not duplicate Conservative strategy policy.
- [ ] Finalize cross-pair account balance allocation and quote-asset contention behavior.
- [x] Optional operational Journal evidence integration is implemented; it remains an observer and does not itself restore trading state. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) and [Journal Evidence Contract](./docs/JOURNAL_EVIDENCE_CONTRACT.md).
- [ ] Resolve the durable execution-fact source and fill/pause persistence contract for #654 without silently changing the Journal observer contract.
- [ ] Decide whether strategy-specific P/L attribution is required.
- [ ] Decide operator intervention behavior for unreconcilable exchange/local-state discrepancies.

## Delivery rules

- Follow repository root guidance and `apps/harvester/AGENTS.md`.
- Work from `develop` using a short-lived task branch and target PRs to `develop`; do not commit task work directly to `develop` or `main`.
- **Mandatory:** follow [Trading First](./docs/TRADING_FIRST.md); implement the next missing step in the actual trading loop before any secondary infrastructure work.
- Keep durable recovery, comprehensive reconciliation, and optimization separate from operational observability. EventBus/Journal lifecycle logging may proceed without waiting for a Conservative TESTNET cycle.
- Do not implement unresolved financial/risk behavior by assumption; close the decision first.
- Do not mark an item complete until implementation, meaningful tests, required checks, and documentation are complete on the target branch.
- Keep LIVE execution behind the explicit `TRADING_MODE=live` selection; never infer LIVE from `NODE_ENV` or a deployment profile.
- Report exact checks actually run; source inspection is not runtime verification.

### CI lockfile repair

The 2026-11-02 CI failure was caused by a malformed root importer in
`pnpm-lock.yaml`: after removing the Coin Farmer workspace, two dependency
entries were left indented under the empty root importer. This made the second
pnpm 12 lockfile document invalid YAML and blocked dependency installation,
unit tests, coverage, and audit. The root importer has been restored to the
empty form matching the root manifest; the full CI suite must be rerun on the
updated PR head before treating this repair as verified.

## Historical records archive

The detailed historical audit snapshots, implementation progress reports, incident notes, evidence corrections and completed delivery records have been preserved in [ROADMAP_HISTORY.md](./docs/audits/ROADMAP_HISTORY.md). The original section headings are retained below as compatibility anchors for existing links; the historical bodies live in the archive. These stubs are not current status or implementation guidance.

## Historical audit snapshot (superseded by the current implementation status above)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implemented and verified by source inspection

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Confirmed blockers / gaps found in the audit

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical P0.7 implementation record — superseded by the canonical Conservative specification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 implementation progress — CI passed; local TESTNET startup confirmed; awaiting first price

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical behavior summary — rules now defined only by the canonical specification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope A — Remove unnecessary execution-readiness barriers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope B — Reconcile recovery SELLs without cancelling PENDING orders

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope C — Diagnostics and failure classification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Required tests

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Out of scope for P0.7

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## P0.6 — Fix Binance order lifecycle race and diagnostic errors

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Problem statement and evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.1 — Reproduce and pin down the lifecycle ordering

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.2 — Serialize engine state transitions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.3 — Enforce cancellation identity and lifecycle preconditions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.4 — Make Error and AggregateError logging lossless

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.5 — Documentation and verification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance criteria

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implementation boundaries

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 implementation progress — engine transition serialization

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 implementation progress — cancellation eligibility

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 verification snapshot — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 ownership-failure diagnostics — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 ownership correlation comparison — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Order ownership audit — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### TESTNET rejected-event evidence — 2026-11-03 16:24

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### Additional adapter finding: Binance original client order ID is discarded

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### 16:24:48 TRADE event

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### Updated diagnosis and required evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Order identity alignment — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## DDD and Clean Architecture audit follow-up

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-01 — Audit documentation reconciliation (documentation)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-02 — Harvester domain glossary and context map

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-03 — Portfolio / RecoveryLedger consistency contract

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-04 — Extract accounting/recovery workflows from bootstrap

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Startup configuration and read-only policy extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Broker connection lifecycle extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market subscription coordinator extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Shutdown handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data subscription/startup gate extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data recovery coordinator extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data status/recovery handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data event handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market-data freshness policy extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market metadata loading extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Account snapshot manager extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Bootstrap resource-cleanup extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-05 — Decompose Conservative Trading Engine incrementally

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-06 — Executable architecture fitness checks

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-07 — Strategic boundary review (later, evidence-driven)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative next-BUY execution-price correction — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative BUY-completion submission ordering — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative recovery SELL completion reconciliation — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical commission and order-type policy decision — 2026-11-03 (superseded)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### POST-ONLY book-ticker subscription lifecycle regression — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET live progress — 2026-11-04 (initial partial snapshot; superseded by later incident record)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Runtime observations

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Later read-only open-orders snapshot

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Interpretation and remaining proof

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET incident and account snapshot — 2026-11-04 (supersedes earlier partial-progress status)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### What the run actually demonstrated

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Source remediation progress — PR #513

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Incident A — repeated BUY submissions around immediate FILLED acknowledgements

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical Incident B — residual-suppression defect (superseded by canonical sell-through)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Account reconciliation — still incomplete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Updated acceptance status and execution gate

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Follow-up source review — conflicting duplicate execution records

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### TESTNET commission configuration change — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Latest PR #513 review — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-04 TESTNET incident — investigation progress and blockers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Evidence established

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Source changes now made in PR #513

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Remaining investigation — actual blockers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance blockers before any TESTNET restart

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET incident — account balance audit implementation (2026-11-04)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## PR #515 offline follow-up progress — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Deterministic lifecycle acceptance evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## PR #515 finalization and controlled TESTNET handoff — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Branch synchronization correction — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Post-PR #515 TESTNET handoff — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Live reconciliation incident follow-up — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Findings and implementation status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### SELL 698745 cancellation — strategy path CONFIRMED; raw event identifier NOT REPRODUCED

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Preserved accounting evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Remaining evidence / status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### CI iteration — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acknowledgement recovery domain-state correction — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Accounting and Journal regression follow-up — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Post-review hardening — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Binance duplicate-fill timestamp parity — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Automatic startup account audit — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Journal restart recovery — runtime integration disabled 2026-11-05; forensic investigation resumed 2026-11-09

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Durable exchange-write intent barriers — retained P0 safety

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Single-writer process ownership — P0, 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## P0 — Durable restart recovery (#654; historical PR #606 helper stack, current runtime wiring disabled)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Standalone TESTNET order-cancellation operator tool — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Scoped development logging — explicitly authorized 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical Conservative strategy evidence audit — 2026-11-06 (evidence snapshot; contract superseded)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit closure sequence — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 0 — evidence integrity

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 1 — reconstruct each order

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 2 — accounting

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 3 — canonical contract and documentation consolidation (#646)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 4 — canonical Conservative regression coverage (#648)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 5 — user-data recovery (#626)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 6 — release decision

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 original-log verification update

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit — 2026-11-06 post-CLOSING trade-history update

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Audit continuation checkpoint — 2026-11-06 11:57 UTC

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Evidence correction — previously supplied balances and open-orders snapshot (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical account snapshots from the original Journal

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Operator-supplied latest open-orders snapshot

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Corrected evidence classification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Evidence chronology correction — post-CLOSING DOGE/ZRO executions (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative owner decisions — canonical reference only

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy audit — current implementation gate (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Documentation consistency gate — PASS (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implementation and regression gate

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Current CI baseline

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Operator workstation lifecycle clarification — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical audit continuation — source-verified residual and restart blockers (2026-11-06; superseded status)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Residual sell-through — implementation IN PROGRESS

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Current audit work ordering

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Deferred — process-restart recovery (last roadmap item; not an active audit blocker)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy audit — canonical authority and current status (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative accounting conformance follow-up — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy — actual DOGE/ZRO outcome conformance (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Execution order

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Known starting arithmetic (exchange evidence, not yet a full strategy verdict)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 — actual DOGE/ZRO conformance checkpoint

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 lifecycle audit — partial BUY while recovery SELL is open

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Lifecycle audit refinement — partial BUY replacement path (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — partial BUY policy regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — dust plus subsequent BUY regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit finding — dust disposition is not durably recorded

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — conflicting partial-BUY lifecycle assertion

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — lifecycle regression precision

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative lifecycle audit continuation — 2026-11-06 21:05 +02:00

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit — F-011 test coverage added (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Current Conservative audit status — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy owner clarification — dust is a retained keep bonus (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy implementation audit closure — 2026-11-07

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### CI regression fixes — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Bootstrap composition follow-up — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Harvester recovery hardening follow-up — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Completed offline recovery regressions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Confirmed risks and remaining proof gaps

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 second-disconnect Harvester lifecycle proof — complete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 F-017 malformed REST-envelope regression follow-up

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 PR #688 account-wide open-orders timeout regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 F-016 native broker Error-cause preservation — complete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 recovery roadmap closeout — PR #719 merged

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 forensic follow-up — November 8 evening session

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### 2026-11-09 current forensic findings — #654

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 forensic restart-recovery status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 — F-023 failure-classification TDD

- Added RED regressions for a matched owned order whose downstream recovery-SELL cancellation fails, permanent ownership/accounting-integrity failures, terminal fill-history REST timeout classification, and the exact `recovered → executionPending (both broker flags false) → owned BUY event` interleaving.
- Added recovery-coordinator regressions proving a queued retryable transition failure blocks acknowledgement until a later authoritative retry, while a permanent accounting-integrity mismatch remains terminal.
- These test-first changes belong to [#769](https://github.com/45s/coinzilla/issues/769) under recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626). Production behavior is unchanged in this commit.

## 2026-11-09 — F-023 failure-classification implementation

- Ported the test-first recovery classification work onto a branch based on current `develop`, including the newer Journal publish/close changes; the stale PR #788 branch remains untouched.
- Bootstrap retries only recognized retryable categories with a non-empty stage and matching retry policy. Missing or malformed metadata becomes terminal `ACCOUNTING_INTEGRITY`.
- Engine snapshot collection distinguishes explicit broker REST read failures from malformed successful payloads and ownership/accounting contradictions. Unknown snapshot errors default terminal, not retryable.
- Account snapshot and account-wide open-order reads, both RECOVERY durability barriers, and broker-generation acknowledgement have explicit failure stages.
- No TESTNET or live exchange operations. Exact-head CI and review remain required.

## 2026-11-09 — F-023 failure-classification implementation

- Ported the test-first recovery classification work onto a branch based on current `develop`, including the newer Journal publish/close changes; the stale PR #788 branch remains untouched.
- Bootstrap retries only recognized retryable categories with a non-empty stage and matching retry policy. Missing or malformed metadata becomes terminal `ACCOUNTING_INTEGRITY`.
- Engine snapshot collection distinguishes explicit broker REST read failures from malformed successful payloads and ownership/accounting contradictions. Unknown snapshot errors default terminal, not retryable.
- Account snapshot and account-wide open-order reads, both RECOVERY durability barriers, and broker-generation acknowledgement have explicit failure stages.
- No TESTNET or live exchange operations. Exact-head CI and review remain required.

## 2026-11-09 recovery failure-classification closeout — PR #794 merged

- [x] **[#769](https://github.com/45s/coinzilla/issues/769) — distinguish accounting-integrity failures from order-transition/reconciliation failures.** Implemented test-first and merged in [PR #794](https://github.com/45s/coinzilla/pull/794), merge commit `ff061dd6b73b4d1ba9a314c1e75ddf447814f4bc`.
- [x] Exact synchronized PR head `fcfa8c4c282b414ccd616b69a54b6e3a8ada5681): all six required offline CI workflows passed. TESTNET integration was skipped intentionally; TESTNET acceptance remains PAUSED / UNVERIFIED.
- [x] Unknown/malformed failure metadata defaults terminal; only explicitly classified retryable REST, order-transition, and durability failures may retry after a complete fresh authoritative recovery. Queued-event failures block broker-generation acknowledgement.
- **Safety:** no TESTNET/live exchange operations were performed. Recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626) remains open for independent work.

## 2026-11-10 independent process-restart audit continuation — F-039–F-044 (#654)

- **F-039 — HIGH:** the live commission validator supports third-asset commissions with historical quote valuation, but the fill DTO drops `quoteValue` and the restore helper rejects third-asset commissions. The configured-market-only account snapshot filter also omits an unconfigured third commission asset. Recovery cannot safely reconstruct all currently accepted Fill accounting. Preserve historical quote valuation and reconcile the related asset balance before any replay integration.
- **F-040 — HIGH:** process identities retain millisecond `startedAt`, but session directory/file names truncate it to seconds. The Journal reader sorts same-second sessions by random UUID suffix; the Harvester recovery projector does not re-sort by the process-start timestamp. Sequential starts within one second can be replayed in reverse chronology. Add deterministic offline coverage and reject ambiguous ordering.
- **F-041 — HIGH:** if a full SELL is followed by an eligible in-memory cycle reset but `RECOVERY_CYCLE_COMPLETED` is lost, the projection retains an unmatched full SELL but does not reject it at end-of-input. Restore then keeps the old cost basis and fails to allocate retained inventory to the free bucket; wallet reconciliation compares total base quantity and quote net cash flow, so it cannot detect either mismatch. Record an explicit durable cycle evaluation outcome or fail closed on unresolved full SELLs; preserve the legitimate residual sell-through case.
- **F-042 — HIGH:** Journal records use random IDs and timestamps without a monotonic sequence, previous-record digest or committed manifest. Deleting one complete valid JSONL line can leave a structurally valid file that reads successfully with no evidence of the gap. The authoritative recovery store needs sequence/integrity validation; legacy records without it are not proven complete.
- **F-043 — HIGH:** the recovery projector silently skips known Harvester safety events including unowned-order, invalid-fill and accounting-failure evidence. If the separate pause event is missing, recovery may not restore a sticky blocker. Add explicit event classification and fail closed on unknown Harvester events.
- **Architecture decision before implementation:** keep domain pure. Prefer a minimal application-owned durable-fact port with explicit fsync acknowledgement, monotonic sequence and integrity chain; keep Journal observer-only unless its contract is deliberately revised. Persist canonical fills before in-memory application, explicit completed/not-completed cycle outcomes before basis transitions, and sticky safety blockers. Recursively discover sessions, reconcile all owned orders/fills/assets and fail closed on any unproven history.
- **F-044 — HIGH:** DTOs and the same-process recovery handler emit account and open-order snapshots with phase `RECOVERY`, but the recovery projector rejects that phase in both validators. Any normal reconnect session can therefore make restart projection fail. Add phase-parity regression coverage and define RECOVERY snapshot ordering/semantics.
- **Next audit gates:** inspect all remaining recovery DTO/domain projection parity, session ordering and schema migration paths; prove each accounting fact survives DTO → projection → restore without information loss. No source or test modifications are authorized. #654 remains OPEN; no TESTNET/LIVE validation is authorized by this audit.
- **Baseline:** exact `develop` HEAD `3ffaaa21c6543cc042087307b01c40630320e903`; PR #974 merged documentation-only. This update is an audit proposal, not implementation acceptance.

### External open-order strategy isolation — #985

- [x] Keep unmatched account-wide open orders unowned and untouched; publish their symbols to the strategy guard only after the open-orders audit is durably flushed.
- [x] Defer Conservative evaluation and broker submission only for affected symbols; unrelated enabled markets remain eligible.
- [x] Refresh or clear the symbol guard only from authoritative startup/reconnect snapshots after their durable Journal barrier.
- [x] Remove the unused `blockOnExistingOrders` recovery argument and cover snapshot lifecycle, symbol isolation, and the final submission race with offline regressions.
- [ ] Merge after final-head CI passes.

### Per-pair external-order policy — PR #1062

**Configuration cleanup — PR #1069:** named `EXTERNAL_ORDERS_POLICIES` constants now define the supported values, operator-control defaults are isolated in named `OPERATOR_CONTROL_CONFIG` and composed into the single `appConfig`, and config tests validate schema invariants without freezing deployment-specific enabled symbols.

The owner-approved follow-up separates manual/external orders from orders previously generated by Harvester. The default is to ignore manual Binance Web/CScalp orders without adopting them or changing Harvester Portfolio/RecoveryLedger. A pair may opt back into same-symbol blocking with `externalOrdersPolicy: "block"`. The reserved Harvester `h-` client-ID namespace remains fail-closed across process boundaries until #654 restart restoration can reconcile those orders and fills.

- [x] Add RED regressions for config validation, default-ignore behavior, explicit block behavior, and unresolved Harvester identities.
- [x] Implement per-pair policy in evaluation, final submission, user-data processing and durable startup/reconnect open-order classification.
- [x] Update pair generator, checked-in config and living documentation.
- [x] Pass focused tests, full Harvester tests/coverage, workspace CI and documentation/agent policy on the implementation head (all checks passed; no TESTNET/LIVE actions).
- [x] No TESTNET/LIVE operations; no automatic restart recovery is enabled.

## 2026-11-11 — Exchange constraint safety / issue #957 (historical decision)

The initial #957 proposal treated every applicable but locally unvalidated dynamic/account/exchange filter as a readiness blocker. That policy was superseded by merged PR #1020. Keep this historical entry for decision provenance; do not use its fail-closed readiness proposal as the current contract. The current policy preserves those filters as diagnostics without blocking readiness solely because they are present. Supported static rules and complete, well-formed authoritative metadata still fail closed. Binance remains authoritative for constraints Harvester does not evaluate locally.

The current rationale, filter mapping, deliberately excluded order-type-specific filters, limitations and readiness flow are documented in [Exchange trading constraints](docs/exchange-trading-constraints.md).

## 2026-11-11 — Unsupported exchange filters no longer block startup

- [~] Update the #957 readiness contract: complete Binance metadata may contain applicable filters that Harvester does not evaluate locally. Preserve those descriptors for diagnostics, but do not block enabled-market startup solely because they are present.
- [ ] Continue validating supported static rules (price tick, quantity step, min/max quantity, min/max notional) and required order-type support. Missing or malformed authoritative metadata remains a startup failure.
- [ ] Binance remains authoritative for unsupported dynamic/account/exchange constraints. Definite exchange filter rejections must be surfaced as `DEFINITE_EXCHANGE_FILTER_REJECTED`, remove only the definitely rejected PENDING order, and never be confused with an ambiguous/UNKNOWN outcome.
- [ ] Verify the readiness, bootstrap, and refreshed trailing-order paths with offline regression tests and exact-head CI. No TESTNET or LIVE exchange operations are part of this change.
