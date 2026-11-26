# Harvester roadmap

**Scope:** current Harvester priorities only. Issue threads own task details and status; domain specifications and ADRs own behavior.
**Last reviewed:** 2026-11-26

> The pre-cleanup roadmap snapshot, including historical delivery notes and older plans, is preserved in [ROADMAP_HISTORY_2026-11-26](../../docs/archive/domain-roadmap-history-2026-11-26.md#harvester-roadmap). Earlier extracted history remains in [ROADMAP_HISTORY](docs/audits/ROADMAP_HISTORY.md).

## Current safety and correctness priorities

| Priority / area | Canonical issue | Current note |
| --- | --- | --- |
| Recovery Seller terminal SELL lifecycle | [#1842](https://github.com/45s/coinzilla/issues/1842) | Keep production composition blocked until terminal reconciliation and STOP semantics are fixed and covered. |
| Trading-history relational startup failure | [#1854](https://github.com/45s/coinzilla/issues/1854) | Resolve startup failure before expanding dependent flows. |
| Binance order-history identity collisions | [#1851](https://github.com/45s/coinzilla/issues/1851) | Preserve exact order identity; avoid ambiguous history reconciliation. |
| Trading-history WebSocket large-frame crash | [#1826](https://github.com/45s/coinzilla/issues/1826) | Correct frame handling and add regression coverage. |
| Conservative recovery SELL idempotency | [#1827](https://github.com/45s/coinzilla/issues/1827) | Fail closed on duplicate/replayed lifecycle evidence. |
| Account-scoped STOP admission | [#1828](https://github.com/45s/coinzilla/issues/1828) | Enforce durable account-wide stop admission. |
| Conservative correctness and scenario coverage | [#1763](https://github.com/45s/coinzilla/issues/1763) | Track phased implementation and exact-head verification. |
| Multi-provider execution and market-data routing | [#1339](https://github.com/45s/coinzilla/issues/1339) | Harvester-owned cross-provider backlog. |

## Scenario Runner / GC Strategy Lab

[PR #1837](https://github.com/45s/coinzilla/pull/1837) remains Draft and unmerged. The current implementation includes production-workflow scenario slices, but the public registry is not executable or production-ready.

Do not compose or enable production execution until:
- the independent terminal SELL/STOP contract in [#1842](https://github.com/45s/coinzilla/issues/1842) is fixed and regression-tested;
- full event-transition, under-target FILLED STOP, and infrastructure-failure scenarios are covered;
- trusted platform OS-level sandboxing is available and verified;
- exact-head tests, coverage, lint, and required CI pass.

In-memory run history is accepted for the MVP; durable persistence is deferred. No real broker/exchange access, credentials, live account state, or production persistence is authorized for scenario runs.

## Recently merged work — verify, do not duplicate

- Startup readiness diagnostics: [PR #1861](https://github.com/45s/coinzilla/pull/1861) merged. Exact-head Harvester tests, coverage, lint, and required workflows remain the completion gate.
- Follow the [Conservative Domain Specification](docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for current strategy behavior.
- Follow the accepted Harvester ADRs and architecture/domain documents for decisions and contracts.

## Roadmap rules

- Keep active entries short: priority, current blocker, issue link.
- Detailed phased plans live in the owning issue or a narrowly scoped implementation plan.
- Completed implementation narratives and old checkpoints belong in history, not the active roadmap.
- Never use this roadmap as the source of truth for strategy rules, API contracts, or acceptance evidence.
