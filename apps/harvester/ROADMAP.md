# Harvester roadmap

**Scope:** current Harvester priorities only. Issue threads own task details and status; domain specifications and ADRs own behavior.
**Last reviewed:** 2026-11-26

> Historical delivery notes and the pre-cleanup roadmap are preserved in [the consolidated roadmap archive](../../docs/archive/roadmap-history-2026-11-26.md#harvester-roadmap). Earlier extracted history remains in [the audit roadmap history](docs/audits/ROADMAP_HISTORY.md).

## Current priorities

| Priority / area | Canonical issue | Current status |
| --- | --- | --- |
| Conservative ownership and shutdown incident | [#1856](https://github.com/45s/coinzilla/issues/1856) | Fix merged in [PR #1858](https://github.com/45s/coinzilla/pull/1858). Issue remains open for historical exchange-identity and original-runtime evidence; do not claim the old run's final STOP/process/lock outcome without its evidence. |
| Conservative exhaustive scenario coverage | [#1763](https://github.com/45s/coinzilla/issues/1763) | Active source-mapped scenario matrix and exact-head evidence. |
| Recovery Seller terminal SELL acceptance | [#1842](https://github.com/45s/coinzilla/issues/1842) | Core transition/STOP fix is in merged [PR #1837](https://github.com/45s/coinzilla/pull/1837); issue remains open for acceptance. Keep execution fail-closed until the remaining scenario and isolation gates pass. |
| Multi-provider execution and market-data routing | [#1339](https://github.com/45s/coinzilla/issues/1339) | Harvester-owned cross-provider backlog; keep provider contracts and routing boundaries explicit. |
| Relational trading-history startup diagnosis | [#1854](https://github.com/45s/coinzilla/issues/1854) | Diagnostic evidence merged in [PR #1855](https://github.com/45s/coinzilla/pull/1855). The exact operator-database migration failure remains unconfirmed; preserve fail-closed migration behavior. |
| Binance historical order identity evidence | [#1851](https://github.com/45s/coinzilla/issues/1851) | Identity correction merged in [PR #1849](https://github.com/45s/coinzilla/pull/1849); original historical row pairing remains unproven. |

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
- [#1828](https://github.com/45s/coinzilla/issues/1828) — account-scoped STOP admission fix merged in [PR #1833](https://github.com/45s/coinzilla/pull/1833); broader producer/restoration/durable-resolution acceptance remains open.
- [#1749](https://github.com/45s/coinzilla/issues/1749) — owned BUY cancellation on safety pause merged in [PR #1755](https://github.com/45s/coinzilla/pull/1755); issue closed.
- [#1747](https://github.com/45s/coinzilla/issues/1747) — guarded local reset and DEV-only archive merged in [PR #1748](https://github.com/45s/coinzilla/pull/1748); issue closed.

## Canonical behavior and documentation

- Follow the [Conservative Domain Specification](docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for strategy behavior.
- Follow accepted Harvester ADRs and architecture/domain documents for decisions and contracts.
- Keep detailed implementation plans in the owning issue or scoped plan; this page is only the active priority index.
- Never use this roadmap as authority for strategy rules, API contracts, or acceptance evidence.
