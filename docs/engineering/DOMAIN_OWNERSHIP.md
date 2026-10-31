# Domain ownership

Coinzilla is a monorepo with independently maintained application and package domains. Ownership is defined by repository paths and local instructions, not by permanent Git branches.

| Domain | Owned path | Responsibility |
| --- | --- | --- |
| Free-Roll | `apps/bot-free-roll/` | Strategy orchestration, pair lifecycle, trading decisions, application configuration |
| Entities | `packages/entities/` | Exchange-neutral domain entities, identity, exact value contracts, lifecycle/value semantics |
| Brokers | `packages/brokers/` | Broker contracts/adapters, exchange API integration, normalization, market/account/order I/O |
| Utils | `packages/utils/` | Domain-neutral reusable helpers, logging and generic utilities |
| Event bus | `packages/event-bus/` | Event publication, subscription, delivery and event-bus reliability |
| Journal | `packages/journal/` | Journal records, persistence boundaries and journal-specific behavior |

## Shared infrastructure

The following are cross-domain and must be treated as shared ownership: root package manifests and lockfile, CI workflows, GitHub rules, root engineering documentation, workspace scripts, and dependency policy.

An agent changing shared infrastructure must:
- Explain why the change is needed and which domains it affects.
- Check all affected package/app consumers.
- Add or update integration-level tests where appropriate.
- Update central documentation and the relevant domain instructions.
- Keep the change narrowly scoped.

## Boundary rules

- A domain owns its public API, implementation, tests, roadmap, and local agent instructions.
- Consumers may open issues or cross-domain requests; they do not directly implement another domain's internal changes.
- Shared entities and broker contracts must remain exchange-neutral. Exchange-specific details belong in broker adapters.
- Generic utilities must not become a dumping ground for domain logic.
- Cross-domain contract changes require explicit consumer impact analysis and coordinated migration.
- A task PR should have one primary owning domain. Split coordinated work into multiple PRs when practical.

See [the mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for request, branch, merge, and release procedures.
