# Harvester Incident Audit Playbook

**Status:** Required for Harvester incident investigations, runtime-session audits, and post-incident engineering work.

**Authority:** This playbook defines the evidence-handling and investigation method. Trading behavior and exchange-safety decisions remain governed by [TRADING_FIRST.md](./TRADING_FIRST.md), the domain specifications, broker contracts, and the owning issue. This document does not authorize exchange activity.

## Principles

1. **Evidence before explanation.** Preserve what each source actually says. Separate observed facts, source-level behavior, calculations, inference, and unresolved hypotheses.
2. **No silent loss.** Inventory every supplied artifact, parse it completely, report parse failures, and preserve meaningful information in the audit report, issue, or PR.
3. **One incident, one coherent workstream.** Reuse the existing issue and PR where scope and ownership match. Do not create duplicate tracking for the same root cause. Split only when ownership or independent acceptance criteria require it.
4. **Safety first.** Audit work is read-only with respect to the exchange. Never restart the bot, place/cancel/replace orders, change account settings, remove a process lock, or use live credentials as an investigative shortcut.
5. **Exact arithmetic.** Preserve decimal strings and commissions by asset. Never use binary floating-point for financial reconciliation.
6. **Fail-closed claims.** Transport reconnection is not application recovery. A green unit suite is not exchange acceptance. An incomplete audit remains incomplete.

## 0. Scope and safety preflight

- Read root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, the applicable task checklist, Harvester `AGENTS.md`, `ROADMAP.md`, `TRADING_FIRST.md`, architecture/domain specifications, broker contracts, configuration guidance, and relevant runbooks/tests. Follow applicable references recursively.
- Read the existing incident issue, prior audit, linked PRs, and relevant comments. Recover explicit user decisions before proposing policy changes.
- State the exact scope: affected process/session, symbols, mode, expected behavior, and actions explicitly out of bounds.
- Do not infer permission to interact with TESTNET or production from the presence of credentials, an uploaded log, or a runbook.

## 1. Evidence inventory and preservation

For **every** supplied artifact, record:

| Field | Required value |
|---|---|
| Original filename | Exact uploaded name |
| Type | Journal JSONL, DEBUG log, TRACE log, lock metadata, screenshot, export, etc. |
| Size | Exact bytes |
| Integrity | SHA-256 of original bytes |
| Coverage | Record/line count and first/last timestamps where available |
| Parse result | Valid, partial, malformed, or unsupported; include exact counts |
| Treatment | Full parsed, relevant sections extracted, sanitized, or excluded with reason |

- Read originals without editing them. Calculate hashes before normalization or redaction.
- Do not assume similarly named log files cover the same process. Logs may contain several sessions; establish the session boundary before correlating them.
- Parse every JSONL line and every structured log line. Report malformed lines; do not silently skip them.
- If a lock or diagnostic file contains a token, credential, API key, signature, or other sensitive value, preserve the original hash and non-sensitive facts but redact the secret from committed documentation.
- Do not commit multi-megabyte raw logs merely to claim preservation. Record their exact hashes, complete parse counts, relevant line ranges, structured summaries, and all decision-relevant facts. Keep raw artifacts in the original evidence source. If the repository has an approved evidence store, use it without exposing secrets.
- Never use a guessed path or reconstructed artifact as if it were the original.

## 2. Parse and normalize

- Parse Journal records as structured events, not as free-form log text.
- Parse DEBUG and TRACE independently. They are complementary evidence and must not be conflated.
- Retain original timestamps and normalize comparisons to UTC. Record the operator's local timezone separately; do not silently convert or discard offsets.
- Preserve event names, status values, identifiers, quantities, prices, commissions, errors, causes, and stacks exactly.
- Produce an event inventory: total records, counts by event name/status/level, unique execution identities, duplicate notifications, parse failures, and first/last timestamps.
- Identify gaps, truncation, repeated records, clock/source-time differences, and any mismatch between Journal and diagnostic logs.
- Treat a source-provided `sourceTime` as source metadata, not as local capture time, unless the broker contract explicitly defines it otherwise.

## 3. Establish the exact session boundary

Correlate, in order:

1. Process-lock metadata (PID, host, start time; redact token).
2. Journal session start and end.
3. Runtime log start/stop and process lifecycle records.
4. Configuration identity, enabled symbols, strategy mode, and broker mode.
5. Any process restarts or multiple Journal sessions in the same diagnostic logs.

Use the intersection of these facts to define the incident window. Older log lines may provide background but must be labeled as prior sessions. Do not attribute an event from another process/session to the incident.

## 4. Reconstruct the lifecycle chronologically

Build a UTC timeline covering:

- Configuration validation and startup gates.
- Broker connection and trading-rule validation.
- User-data and market-data subscription establishment.
- PREFLIGHT account snapshot and account-wide open-order audit, including durable Journal flush.
- Trading-engine activation and readiness transitions.
- Every strategy decision, order intent, broker submission, acknowledgement, order update, cancellation, and replacement.
- Every execution/fill, accounting result, duplicate/replay result, and commission.
- Disconnect/reconnect attempts, recovery generations, REST reconciliation stages, queued events, acknowledgement, and readiness.
- Pair/process pauses, safety halts, shutdown cancellation, CLOSING audit, broker disconnect, lock retention/release, and final process outcome.

For each transition, record the triggering event, prior state, resulting state, and whether the transition is confirmed by Journal, DEBUG/TRACE, or both. Distinguish transport-ready from application-ready.

## 5. Build the order and execution ledger

For every Harvester-owned order, record:

- `clientOrderId`, broker order ID, symbol, side, type, price, original quantity, executed quantity, remaining quantity, and status.
- Submission intent time, broker acknowledgement time, terminal event time, cancellation intent/result, and any UNKNOWN state.
- The exact reason for each action (for example, INITIAL_BUY, RECOVERY_SELL, BUY_FILLED_RECALCULATE_RECOVERY_SELL).
- Every associated fill: exchange trade ID, order ID, side, price, base quantity, quote quantity, commission amount/asset, commission status, and execution timestamp.
- Whether the fill was first applied or recognized as a duplicate. Count duplicate notifications separately from unique fills and applied fills.

Keep external/unowned orders in a separate ledger. Never merge them into Harvester ownership because their symbol matches. Never assume an order was canceled because a request was sent; require authoritative terminal confirmation and fill reconciliation.

## 6. Reconcile account balances exactly

For each configured asset, compare PREFLIGHT and CLOSING free, locked, and total balances.

Calculate independently from unique applied fills:

- Base-asset delta: BUY quantity less base-asset BUY commissions, less SELL quantity, plus/minus any base-asset SELL commission as applicable.
- Quote-asset delta: SELL gross quote proceeds less BUY gross quote cost and quote-asset commissions, plus/minus any other confirmed quote movements.
- Third-asset commissions and transfers separately; do not silently convert them without an authoritative quote valuation.
- Locked balances against known open external orders and unresolved Harvester-owned orders.

Use decimal arithmetic and show formulas. Explain every difference using exact trade/commission facts, transfers, fees, open orders, or known external activity. If a closing open-order payload is absent, do not claim the final exchange order state is confirmed merely because locked balances appear consistent.

Accounting reconciliation and trading-lifecycle recovery are separate verdicts. Exact balances do not prove the bot resumed trading; an incomplete order audit does not by itself prove that fills were lost.

## 7. Inspect source and contracts

- Trace the complete event path from broker transport/session through adapter, bootstrap queue, application use case, domain transition, Journal, and readiness.
- Inspect callers and consumers, not only the function named in the error stack.
- Compare actual call arguments and state predicates with the existing contract and issue acceptance criteria.
- Inspect adjacent failure paths: queue ordering, concurrency, retries, timeouts, stale generations, duplicate events, rejected promises, resource cleanup, and shutdown.
- Verify what a broker status means. A transport `recovered` reminder is not proof that subscriber acknowledgement or application reconciliation completed.
- Compare implementation behavior with runbook, architecture, roadmap, and explicit user decisions. Record contradictions rather than silently choosing one source.
- Do not label an inferred cause as confirmed. State the exact evidence and confidence level.

## 8. Classify findings

Every finding must include:

| Field | Required content |
|---|---|
| ID and severity | Stable finding ID; Critical/High/Medium/Low/Informational |
| Verdict | CONFIRMED, PARTIAL, UNVERIFIED, CONTRADICTED, or NOT A DEFECT |
| Evidence | File hash, Journal event index, log line/time, code path, test |
| Expected vs actual | Observable contract and observed behavior |
| Root cause | Confirmed source-level cause, or explicitly UNKNOWN |
| Impact | Trading, accounting, ownership, availability, observability, or operator risk |
| Containment | Existing fail-closed behavior and safe next action |
| Fix | Smallest cohesive implementation/documentation change |
| Regression | Deterministic test and exact RED/GREEN evidence |
| Closure | Remaining CI, TESTNET, operator, or policy acceptance |

Do not turn user-reported context into a verified technical fact. Do not call an intentional safety halt a defect. Do not call an unresolved UNKNOWN order a confirmed open or canceled order.

## 9. TDD and implementation

For runtime behavior changes, follow strict RED → GREEN → REFACTOR:

1. Add a deterministic offline regression that reproduces the observable defect.
2. Run it against the unmodified implementation and preserve the expected failure reason.
3. Implement the smallest cohesive fix.
4. Re-run the regression and affected tests; verify the failure changes to the expected pass.
5. Cover relevant boundaries, failures, races, duplicate events, and cleanup.
6. Run the owning package suite/coverage and required workspace CI on the exact PR head.
7. Never claim a test passed unless its exact command/run and result are available.

Do not weaken, delete, or skip existing tests to get green. Every assertion in new or materially edited tests requires a detailed plain-English failure message. Exchange integration remains opt-in and TESTNET-only; default tests stay offline and credential-free.

## 10. Documentation, issue, and PR packaging

- Preserve the complete evidence inventory and all decision-relevant findings in a durable audit document. Link it from `AUDIT.md` and the owning issue.
- Update the findings register and roadmap status. Correct runbook/architecture contradictions only when the governing policy is explicit and verified.
- Reuse the existing incident issue. Add a new issue only for a distinct owner, contract, or independent acceptance criterion.
- Prefer one PR when implementation, regression tests, audit evidence, and required documentation form one cohesive domain change. Split only when a separate owner or independently deployable fix makes one PR misleading.
- The PR description must include: incident window, evidence filenames/hashes/parse counts, concise timeline, order/fill/accounting results, confirmed root cause, safety boundaries, changed files, RED/GREEN test evidence, exact-head CI, Documentation impact, and unresolved acceptance.
- Link related prior PRs/issues and explicitly state what is not being changed (for example, external order ownership, durable process-restart recovery, or live trading).
- Do not mark a roadmap item complete when a PR is merely open. Do not merge or close the incident until required gates and acceptance are satisfied.

## 11. Final audit checklist

- [ ] Every attachment inventoried, hashed, parsed, and represented in the evidence report.
- [ ] Session boundary proven; earlier sessions excluded or clearly labeled.
- [ ] UTC timeline covers startup through shutdown.
- [ ] External and Harvester-owned orders are separated.
- [ ] Every unique fill and commission is recorded; duplicates are distinguished from applications.
- [ ] PREFLIGHT/CLOSING balances reconciled with exact decimal formulas.
- [ ] Transport recovery and application recovery are separately evaluated.
- [ ] Source-level root cause is evidenced; unknowns remain explicitly unknown.
- [ ] Safety gates, unresolved orders, and lock state are documented.
- [ ] Regression tests show RED then GREEN; exact-head CI is recorded.
- [ ] Audit, findings register, roadmap, runbook, issue, and PR are consistent.
- [ ] No unauthorized exchange action or secret disclosure occurred.
- [ ] Final verdict and remaining acceptance requirements are explicit.
