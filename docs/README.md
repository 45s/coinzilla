# Repository documentation

This index is the entry point for maintained repository documentation. The governance foundation and umbrella tracking live in [#795](https://github.com/45s/coinzilla/issues/795). Full-tree Markdown style and maintained-source anchor enforcement is complete in [#1402](https://github.com/45s/coinzilla/issues/1402) (implemented in [PR #1434](https://github.com/45s/coinzilla/pull/1434)). The maintained-content and reference/consolidation audits [#1401](https://github.com/45s/coinzilla/issues/1401) and [#1403](https://github.com/45s/coinzilla/issues/1403) were completed together in [PR #1628](https://github.com/45s/coinzilla/pull/1628). The canonical placement, ownership, lifecycle, naming, AI-agent requirements and enforcement rules are defined in [Documentation Governance](DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Repository README](../README.md) — workspace overview and setup
- [Coding-agent instructions](../AGENTS.md) — mandatory agent entry point
- [AI-agent workflow](../AI_AGENT_WORKFLOW.md) — branches, PRs, collaboration and integration; incremental commits and resumable handoffs
- [Engineering standards](../ENGINEERING_STANDARDS.md) — design, TDD, verification and documentation impact
- [ESLint Standard](engineering/ESLINT_STANDARD.md) — rule compliance, JavaScript change guidance and suppression prevention
- [Repository roadmap](../ROADMAP.md) — cross-workspace engineering and release work
- [Documentation Governance](DOCUMENTATION_GOVERNANCE.md) — the documentation vision and maintenance contract
- [Repository governance drift review](engineering/REPOSITORY_GOVERNANCE_REVIEW.md) — monthly evidence-based review of rulesets, CI, workflow supply chain, security and package matrices
- [Markdown style standard](MARKDOWN_STYLE.md) — consistent formatting and authoring conventions
- [Repository documentation inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md) — current canonical-source map; 214 tracked Markdown files on `develop` at `aa75d2c` (2026-11-26), plus one consolidated archive file on the cleanup PR branch

## Repository-wide engineering

- [CLI source identity rollout](engineering/CLI_SOURCE_IDENTITY.md) — shared implementation, migrated entrypoints and remaining inventory scope for #1631

- [Engineering documentation index](engineering/README.md)
- [Feature Specification Standard](FEATURE_SPECIFICATION_STANDARD.md) — how to create, structure, review and maintain AI-readable feature specifications
- [Architecture and decisions](architecture/README.md)
- [ADR-0002: Explicit Binance trading environment](architecture/decisions/ADR-0002-explicit-binance-trading-environment.md)
- [ADR-0003: Explicit multi-provider execution and market-data routing](architecture/decisions/ADR-0003-multi-provider-routing.md)
- [Multi-provider migration audit and implementation plan](architecture/multi-provider-migration-plan.md) — source-verified audit, capability matrix, persistence assessment and implementation phases for #1339.
- [Domain ownership](engineering/DOMAIN_OWNERSHIP.md)
- [Task workflows](engineering/TASK_WORKFLOWS.md)
- [AI task standards and verification guide](engineering/AI_TASK_COMPLIANCE_STANDARD.md) — progressive context loading, task-relevant standards discovery, engineering quality and completion verification
- [Task Preflight validator](../scripts/task-preflight.js) — optional local issue/task-content validation utility
- [AI refactoring and code audit standard](engineering/AI_REFACTORING_AUDIT_STANDARD.md)
- [Logging and observability standard](engineering/LOGGING_OBSERVABILITY_STANDARD.md)
- [Cross-domain requests](engineering/CROSS_DOMAIN_REQUESTS.md)
- [Contributing](contributing.md)
- [Workspace package map](workspace-package-map.md)

## Testing and quality

- [Domain Scenario Testing Methodology](testing/DOMAIN_SCENARIO_TESTING.md) — strategy-neutral guidance for designing readable behavior scenarios, exact accounting oracles, lifecycle proofs, fixtures and evidence.
- [Repository test scenario catalog](testing/SCENARIO_CATALOG.md) — human-readable behavior scenarios, concrete inputs/outputs, subcases, implementation paths, and named automated tests across the workspace.

## Operational and reference guides

- [Broker WebSocket contract](brokers-websocket-contract.md)
- [CI workflows](ci-workflows.md)
- [Dependency audit playbook](dependency-audit-playbook.md)
- [Release and rollback](release-and-rollback.md)

## Audits and historical records

- [Audit records index](audits/README.md)
- [Repository engineering audit](audits/repository-engineering-audit.md)
- [AI-agent task-brief records](ai-agent/README.md)

The AI-agent task brief and repository engineering audit are different historical artifacts; their similar filenames do not make them duplicates. Audit reports must be interpreted against their recorded branch/commit and date.

## Application and package documentation

Each active application/package owns its local README, agent instructions, roadmap and documentation index where applicable:

- [Harvester](../apps/harvester/README.md) — trading application guide
- [Dashboard](../apps/dashboard/README.md) — Angular operational dashboard foundation
- [Harvester documentation index](../apps/harvester/docs/README.md)
- [Harvester Volatility Protection](../apps/harvester/docs/volatility-protection.md) — runtime protection implemented; historical threshold calibration remains open
- [Harvester roadmap](../apps/harvester/ROADMAP.md)
- [Workspace ownership map](engineering/DOMAIN_OWNERSHIP.md)

## Shared package entry points

- [Brokers](../packages/brokers/README.md) — exchange integration and broker operations
- [Bitunix Spot development workflow](../packages/brokers/docs/BITUNIX_WORKFLOW.md) — mandatory evidence-to-implementation process and operator-only LIVE investigation boundary
- [Database](../packages/db/README.md) — provider-neutral CRUD infrastructure with built-in SQLite provider
- [Entities](../packages/entities/README.md) — exchange-neutral domain contracts and financial value objects
- [Event Bus](../packages/event-bus/README.md) — bounded in-process event delivery
- [Indicators](../packages/indicators/README.md) — exchange-neutral technical indicator calculations
- [Journal](../packages/journal/README.md) — durable event recording and replay
- [Notifiers](../packages/notifiers/README.md) — optional operational notifications
- [Utils](../packages/utils/README.md) — shared domain-neutral helpers

For other domains, start at the owning directory's README and AGENTS.md, then follow its ROADMAP.md and local docs index.
