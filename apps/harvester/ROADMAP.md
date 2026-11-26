# Harvester roadmap

**Scope:** current Harvester priorities only. Issue threads own task details and status; domain specifications and ADRs own behavior.
**Last reviewed:** 2026-11-26

> Historical delivery notes and the pre-cleanup roadmap are preserved in [the consolidated roadmap archive](../../docs/archive/roadmap-history-2026-11-26.md#harvester-roadmap). Earlier extracted history remains in [the audit roadmap history](docs/audits/ROADMAP_HISTORY.md).

## Current priorities

| Priority / area | Canonical issue | Current status |
| --- | --- | --- |
| Conservative ownership and shutdown incident | [#1856](https://github.com/45s/coinzilla/issues/1856) | Fix merged in [PR #1858](https://github.com/45s/coinzilla/pull/1858). Issue remains open for historical exchange-identity and original-runtime evidence; do not claim the old run's final STOP/process/lock outcome without its evidence. |
| Conservative exhaustive scenario coverage | [#1763](https://github.com/45s/coinzilla/issues/1763) | Active source-mapped scenario matrix and exact-head evidence. |
| Recovery Seller terminal SELL acceptance | [#1842](https://github.com/45s/coinzilla/issues/1842) | Non-FILLED terminal SELL STOP fix merged in [PR #1875](https://github.com/45s/coinzilla/pull/1875). Its merge-commit coverage run exposed an uncovered missing-broker-ID guard in terminal fill reconciliation; this test-only follow-up covers absent and whitespace-only IDs without changing runtime behavior. |
| Multi-provider execution and market-data routing | [#1339](https://github.com/45s/coinzilla/issues/1339) | Harvester-owned cross-provider backlog; keep provider contracts and routing boundaries explicit. |
| Relational trading-history startup diagnosis | [#1854](https://github.com/45s/coinzilla/issues/1854) | Diagnostic evidence merged in [PR #1855](https://github.com/45s/coinzilla/pull/1855). The exact operator-database migration failure remains unconfirmed; preserve fail-closed migration behavior. |
| Binance historical order identity evidence | [#1851](https://github.com/45s/coinzilla/issues/1851) | Identity correction merged in [PR #1849](https://github.com/45s/coinzilla/pull/1849); original historical row pairing remains unproven. |
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

- full user-data event transition and terminal reconciliation scenarios are composed;
- under-target FILLED SELL STOP and general infrastructure-failure scenarios are covered;
- a trusted OS-level sandbox and matching attestation are available and verified;
- source/build/runtime/input replay provenance and exact-head checks are complete.

Current scenarios use simulated infrastructure and run-local state. No real broker/exchange access, credentials, live account state, or production persistence is authorized.

## Recently merged fixes — follow up only through their open acceptance/evidence issues

- [#1826](https://github.com/45s/coinzilla/issues/1826) — WebSocket large-frame handling; [PR #1830](https://github.com/45s/coinzilla/pull/1830) merged and issue closed.
- [#1827](https://github.com/45s/coinzilla/issues/1827) — recovery SELL idempotency implementation merged in [PR #1831](https://github.com/45s/coinzilla/pull/1831); issue remains open for historical incident evidence.
- [#1828](https://github.com/45s/coinzilla/issues/1828) — account-scoped STOP admission fix merged in [PR #1833](https://github.com/45s/coinzilla/pull/1833); [PR #1867](https://github.com/45s/coinzilla/pull/1867) closes the non-recovery startup persisted-blocker gap; broader producer/restoration/durable-resolution acceptance remains open. [PR #1880](https://github.com/45s/coinzilla/pull/1880) and [PR #1881](https://github.com/45s/coinzilla/pull/1881) merged terminal identity and account-scoped producer regression coverage. The operator-resolution use-case is being added in a separate PR; it requires verified projection, exact ACCOUNT blocker set and user-data provenance, authoritative all-market account reconciliation, durable resolution facts and readback. It deliberately keeps readiness BLOCKED and does not reset runtime or Recovery Seller state; production audit adapter and controlled restart admission remain separate acceptance gates.
- [#1749](https://github.com/45s/coinzilla/issues/1749) — owned BUY cancellation on safety pause merged in [PR #1755](https://github.com/45s/coinzilla/pull/1755); issue closed.
- [#1747](https://github.com/45s/coinzilla/issues/1747) — guarded local reset and DEV-only archive merged in [PR #1748](https://github.com/45s/coinzilla/pull/1748); issue closed.

## Canonical behavior and documentation

- Follow the [Conservative Domain Specification](docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for strategy behavior.
- Follow accepted Harvester ADRs and architecture/domain documents for decisions and contracts.
- Keep detailed implementation plans in the owning issue or scoped plan; this page is only the active priority index.
- Never use this roadmap as authority for strategy rules, API contracts, or acceptance evidence.

- Recovery Seller non-FILLED terminal SELLs require a durable account STOP after canonical fill reconciliation. Partial CANCELED/EXPIRED and zero-fill REJECTED outcomes remain unresolved under the account-wide STOP; canonical terminal accounting may release the terminal order reservation after all fills are reconciled. Profitable partial proceeds do not relax the STOP rule.
