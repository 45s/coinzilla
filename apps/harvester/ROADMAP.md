# Harvester roadmap

**Scope:** current Harvester priorities only. Issue threads own task details and status; domain specifications and ADRs own behavior.
**Last reviewed:** 2026-11-27

> Historical delivery notes and the pre-cleanup roadmap are preserved in [the consolidated roadmap archive](../../docs/archive/roadmap-history-2026-11-26.md#harvester-roadmap). Earlier extracted history remains in [the audit roadmap history](docs/audits/ROADMAP_HISTORY.md).

## Current priorities

| Priority / area | Canonical issue | Current status |
| --- | --- | --- |
| Conservative no-new-BUY-until-cycle-complete admission | [#1895](https://github.com/45s/coinzilla/issues/1895) | Implemented and merged in [PR #1899](https://github.com/45s/coinzilla/pull/1899), merge commit `95d9ab2d25aba6dee18f258ff1c8caac1312d865`; all six required workflows passed on exact PR head `6e903a822bbd3539e8f7168fab81278a0d4d7315`. |
| 2026-11-26 Conservative TESTNET residual sell-through | [#1896](https://github.com/45s/coinzilla/issues/1896) | Journal write-only durability capability is merged via [PR #1911](https://github.com/45s/coinzilla/pull/1911) (`106906176c63f7a1dbcffa665371b0c878c626d2`). PR #1909 exposes the separate Harvester `flushWrites()` adapter, requires durable recovery-decision/deferral evidence before completion or broker submission, and supplies replay write-only-flush fixtures. It also uses the write-only Journal barrier for durable order/cancellation intents and rejects pending asynchronous publication without draining optional EventBus observers and verifies that an outstanding recovery SELL survives restart reconciliation without a duplicate submission. Exact-head validation and remaining forensic/evidence review are in progress. Historical error/filter snapshot remain unavailable; no historical root cause is claimed. |
| 2026-11-26 matching trading-runtime logs | [#1897](https://github.com/45s/coinzilla/issues/1897) | Source implementation and regression coverage are committed on `fix/harvester/1897-runtime-log-correlation-20261127-v2`; exact-head CI validation is pending: test-first regressions cover exact runtime matching, absent/ambiguous matches, independent sessions, duplicate source hashes/provenance, missing process/source identity, and incomplete capture. Durable PROCESS_STARTED provenance is included in scope. |
| Conservative ownership and shutdown incident | [#1856](https://github.com/45s/coinzilla/issues/1856) | Current ownership/shutdown fix merged in [PR #1858](https://github.com/45s/coinzilla/pull/1858). Persistence-boundary restart coverage and ADR clarification are ready for review in [PR #1917](https://github.com/45s/coinzilla/pull/1917) (exact-head checks passed before this roadmap-only update). Historical startup cause, exchange identity, and old-run STOP/process/lock outcome remain UNKNOWN; do not infer them from current implementation tests. |
| Shutdown cleanup deadlines and process-lock release | [#1186](https://github.com/45s/coinzilla/issues/1186), [#1479](https://github.com/45s/coinzilla/issues/1479) | Implementation is merged in [PR #1891](https://github.com/45s/coinzilla/pull/1891) (head `f32781cf3ab532dd3f9a27984f3cb40a0f4e36e3`). Bounded outer cleanup, Journal-backed STOPPED fallback, and explicit lock-release acknowledgements passed the recorded regression/process-lock checks. Remaining work is operational acceptance and historical process-exit/lock-release evidence in the issues; do not treat merge/CI as proof of a real shutdown. |
| Conservative exhaustive scenario coverage | [#1763](https://github.com/45s/coinzilla/issues/1763) | Active source-mapped scenario matrix and exact-head evidence. |
| Recovery Seller terminal SELL acceptance | [#1842](https://github.com/45s/coinzilla/issues/1842) | Non-FILLED terminal SELL STOP fix merged in [PR #1875](https://github.com/45s/coinzilla/pull/1875). Its merge-commit coverage run exposed an uncovered missing-broker-ID guard in terminal fill reconciliation; this test-only follow-up covers absent and whitespace-only IDs without changing runtime behavior. |
| Multi-provider execution and market-data routing | [#1339](https://github.com/45s/coinzilla/issues/1339) | Harvester-owned cross-provider backlog; keep provider contracts and routing boundaries explicit. |
| Relational trading-history startup diagnosis | [#1854](https://github.com/45s/coinzilla/issues/1854) | Diagnostic evidence merged in [PR #1855](https://github.com/45s/coinzilla/pull/1855). The exact operator-database migration failure remains unconfirmed; preserve fail-closed migration behavior. |
| Debug archive evidence identity handling | [#1893](https://github.com/45s/coinzilla/issues/1893) | Completed by merged [PR #1894](https://github.com/45s/coinzilla/pull/1894): independently valid log and recovery-facts sources are published with explicit identity-mismatch metadata. The separate matching-runtime log-selection gap is tracked in [#1897](https://github.com/45s/coinzilla/issues/1897). |
| Binance historical order identity evidence | [#1851](https://github.com/45s/coinzilla/issues/1851) | Identity correction merged in [PR #1849](https://github.com/45s/coinzilla/pull/1849); original historical row pairing remains unproven. |
| Account-wide safety blocker resolution | [#1828](https://github.com/45s/coinzilla/issues/1828) | Offline operator workflow in [PR #1886](https://github.com/45s/coinzilla/pull/1886): OS-account-authenticated identity, structured durable action metadata, exact idempotent retries and per-blocker readback. Producer provenance owns resolution: explicit user-data facts with the reserved Recovery Seller reason fail closed; legacy untagged Recovery Seller facts retain the dedicated resolver. The production offline market audit is injected at the CLI boundary. Remains offline-only; external evidence provenance and controlled restart/fresh-snapshot acceptance remain open. |
| Reliability engineering baseline | [#1639](https://github.com/45s/coinzilla/issues/1639) | R0 baseline and incident triage; use the dated report for findings and evidence gaps. |
| Volatility protection calibration | [#1016](https://github.com/45s/coinzilla/issues/1016) | Multi-symbol synthetic CLI regression is in PR #1871; historical threshold calibration remains outstanding. |

## Reliability engineering baseline — issue #1639

The source-backed [2026-11-26 reliability baseline report](docs/audits/reports/2026-11-26_harvester-reliability-engineering-baseline.md) owns the audit findings and evidence; [issue #1639](https://github.com/45s/coinzilla/issues/1639) owns the umbrella execution plan, fault-domain model and R0–R6 gates.

- **R0 — baseline and incident triage.** The report records a 300.10-second Harvester Targeted Tests timeout in the inspected PR #1858 head; its root cause remains unconfirmed. The current `develop` commit `fcfc11107ea077f96ee4af635ed66db8e01a4ea8` has six successful workflow runs, including Harvester Targeted Tests and Harvester Process Lock. Treat the timeout as unresolved historical evidence, not a current failing check or a proven fix.
- **Readiness review.** PR #1861 merged, but the baseline report records `action_required` workflows and calls for independent review of readiness-report/startup composition; those runs are not passing validation evidence.
- **Persisted account blockers.** PR #1833 merged the shared final submission gate and synchronous account STOP latch; PR #1867 merged the non-recovery startup restoration gate. The broader #1828 matrix remains open for all ACCOUNT-scoped producers and durable-resolution paths. This follow-up covers the user-data producer's no-symbol ACCOUNT blockers for both unowned executions and terminal accounting failures, and proves the in-memory gate remains closed while persistence is pending, returns non-durable, or throws; no runtime behavior change is intended.
- Do not claim coverage percentages or branch-protection guarantees without exact-current-SHA measurements/readback. This baseline does not authorize LIVE exchange mutations.

## Scenario Runner / GC Strategy Lab

Foundation [PR #1837](https://github.com/45s/coinzilla/pull/1837) is merged. It does **not** make the Scenario Runner production-ready or executable.

The current [Runner roadmap](../../apps/dashboard/docs/features/gc-strategy-lab/RUNNER_ROADMAP.md) remains the feature-specific plan. Keep execution blocked until:

- production user-data event transition and terminal-fill reconciliation are exercised for profitable partial CANCELED and adverse fully FILLED SELLs in [PR #1887](https://github.com/45s/coinzilla/pull/1887);
- under-target FILLED SELL STOP, STOP-persistence failure, and STOP buy-only admission runtime scenarios are implemented in PR #1887; other infrastructure-failure scenarios remain outstanding;
- a trusted OS-level sandbox and matching attestation are available and verified;
- source/build/runtime/input replay provenance and exact-head checks are complete.

Current scenarios use simulated infrastructure and run-local state. No real broker/exchange access, credentials, live account state, or production persistence is authorized.

## Recently merged fixes — follow up only through their open acceptance/evidence issues

- [#1826](https://github.com/45s/coinzilla/issues/1826) — WebSocket large-frame handling; [PR #1830](https://github.com/45s/coinzilla/pull/1830) merged and issue closed.
- [#1827](https://github.com/45s/coinzilla/issues/1827) — recovery SELL idempotency implementation merged in [PR #1831](https://github.com/45s/coinzilla/pull/1831); issue remains open for historical incident evidence.
- [#1828](https://github.com/45s/coinzilla/issues/1828) — account-scoped STOP admission fix merged in [PR #1833](https://github.com/45s/coinzilla/pull/1833); [PR #1867](https://github.com/45s/coinzilla/pull/1867) closes the non-recovery startup persisted-blocker gap. [PR #1880](https://github.com/45s/coinzilla/pull/1880) and [PR #1881](https://github.com/45s/coinzilla/pull/1881) merged terminal identity and account-scoped producer regression coverage; [PR #1883](https://github.com/45s/coinzilla/pull/1883) merged durable user-data producer provenance and the fail-closed resolution use-case. Offline account-wide operator CLI and production reconciliation are implemented in [PR #1886](https://github.com/45s/coinzilla/pull/1886); the synchronized exact head passed Harvester Targeted Tests, workspace unit tests, critical-module coverage, Repository Quality, documentation links and Dependency Audit; balance-discrepancy, structured-resolution ownership and Recovery Seller STOP producer-isolation regressions are added for exact-head verification: it audits every configured market, appends resolution facts only after durable readback, and leaves readiness BLOCKED for controlled restart/fresh snapshot. #1828 remains open until the end-to-end restart/admission matrix passes.
- [#1749](https://github.com/45s/coinzilla/issues/1749) — owned BUY cancellation on safety pause merged in [PR #1755](https://github.com/45s/coinzilla/pull/1755); issue closed.
- [#1747](https://github.com/45s/coinzilla/issues/1747) — guarded local reset and DEV-only archive merged in [PR #1748](https://github.com/45s/coinzilla/pull/1748); issue closed.

## Canonical behavior and documentation

- Follow the [Conservative Domain Specification](docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for strategy behavior.
- Follow accepted Harvester ADRs and architecture/domain documents for decisions and contracts.
- Keep detailed implementation plans in the owning issue or scoped plan; this page is only the active priority index.
- Never use this roadmap as authority for strategy rules, API contracts, or acceptance evidence.

- Recovery Seller non-FILLED terminal SELLs require a durable account STOP after canonical fill reconciliation. Partial CANCELED/EXPIRED and zero-fill REJECTED outcomes remain unresolved under the account-wide STOP; canonical terminal accounting may release the terminal order reservation after all fills are reconciled. Profitable partial proceeds do not relax the STOP rule.

## Scenario Runner Linux sandbox implementation — 2026-11-27

PR #1913 now composes the RS simulation-only process adapter behind explicit `HARVESTER_SCENARIO_SANDBOX=linux-bubblewrap`. The launcher verifies trusted Bubblewrap/prlimit/shell/Node binaries and capabilities, then applies user/network/PID/IPC/UTS namespaces, seccomp network/child-process restrictions, a read-only runtime allowlist, a trusted Node installation directory bound read-only at its canonical host path, worker IPC preservation, RLIMIT_CPU, and a per-run delegated cgroup v2 (256 MiB hard memory, swap disabled, one CPU quota, 64 pids/threads). Seccomp allows Bubblewrap's initial `execve` to start Node while denying fork/vfork, non-thread clone, and execveat. The API remains fail-closed when the host lacks delegated cgroup controllers or any binary/capability check fails.

Runtime scenarios are eligible for isolated simulation only; they remain PARTIAL and are not production-accepted. Required remaining gates: end-to-end adversarial OS isolation acceptance on a trusted delegated Linux runner, trusted build-artifact provenance/replay, production operational-state persistence acceptance, and the independent RS lifecycle correction in issue #1842.

## Linux sandbox adversarial acceptance harness — 2026-11-27

A manual self-hosted workflow `.github/workflows/harvester-scenario-sandbox-e2e.yml` now runs the real Linux sandbox boundary test on a runner labeled `scenario-sandbox`. It verifies namespace separation, secret non-forwarding, read-only filesystem, network denial, child-process denial, and the per-run cgroup hard limits. It requires a trusted Linux runner with Bubblewrap/prlimit/Node root-owned and delegated cgroup v2 `memory`, `cpu`, and `pids` controllers. It is intentionally not run on the ordinary GitHub-hosted runner. Do not close the isolation acceptance gate until the manual workflow passes on the intended deployment class.

## Production RS process-adapter sandbox acceptance — 2026-11-27

The manual Linux sandbox E2E exercises both an adversarial OS-boundary probe and the actual production RS process adapter/runtime evaluator inside the sandbox. It verifies a passing simulation-only SELL scenario with one simulated broker call and run-local intent/outcome facts. This is not production trading acceptance or RS domain-matrix verification; it remains pending a successful run on the trusted delegated Linux runner and trusted build provenance.

## Scenario Runner cgroup lifecycle follow-up — 2026-11-27

The cgroup setup leak is fixed on `fix/harvester/scenario-runner-cgroup-cleanup`: argument construction is guarded by cleanup; cgroup removal errors are surfaced; the process adapter withholds success and retains/retries cleanup. Regression tests cover pre-spawn failure and runtime cleanup confirmation. Exact-head CI is pending. Trusted Linux sandbox E2E, production state durability, trusted artifact provenance/replay and runner-specific retry/idempotency acceptance remain separate open gates.
