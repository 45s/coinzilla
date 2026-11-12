# Repository documentation

This index is the entry point for maintained repository documentation. The repository-wide migration/adoption work is tracked in [#795](https://github.com/45s/coinzilla/issues/795). The canonical placement, ownership, lifecycle, naming, AI-agent requirements and enforcement rules are defined in [Documentation Governance](DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Repository README](../README.md) — workspace overview and setup
- [Coding-agent instructions](../AGENTS.md) — mandatory agent entry point
- [AI-agent workflow](../AI_AGENT_WORKFLOW.md) — branches, PRs, collaboration and integration
- [Engineering standards](../ENGINEERING_STANDARDS.md) — design, TDD, verification and documentation impact
- [Repository roadmap](../ROADMAP.md) — cross-workspace engineering and release work
- [Documentation Governance](DOCUMENTATION_GOVERNANCE.md) — the documentation vision and maintenance contract
- [Markdown style standard](MARKDOWN_STYLE.md) — consistent formatting and authoring conventions
- [Repository documentation inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md) — frozen 97-file baseline plus subsequent recursive checkpoints (currently 124 tracked Markdown/MDX files)

## Repository-wide engineering

- [Engineering documentation index](engineering/README.md)
- [Architecture and decisions](architecture/README.md)
- [ADR-0002: Explicit Binance trading environment](architecture/decisions/ADR-0002-explicit-binance-trading-environment.md)
- [Domain ownership](engineering/DOMAIN_OWNERSHIP.md)
- [Task workflows](engineering/TASK_WORKFLOWS.md)
- [Cross-domain requests](engineering/CROSS_DOMAIN_REQUESTS.md)
- [Contributing](contributing.md)
- [Workspace package map](workspace-package-map.md)

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

- [Harvester](../apps/harvester/README.md) — application guide
- [Harvester documentation index](../apps/harvester/docs/README.md)
- [Harvester Volatility Protection](../apps/harvester/docs/volatility-protection.md) — runtime protection implemented; historical threshold calibration remains open
- [Harvester roadmap](../apps/harvester/ROADMAP.md)
- [Workspace ownership map](engineering/DOMAIN_OWNERSHIP.md)

## Shared package entry points

- [Brokers](../packages/brokers/README.md) — exchange integration and broker operations
- [Database](../packages/db/README.md) — SQLite persistence infrastructure
- [Entities](../packages/entities/README.md) — exchange-neutral domain contracts and financial value objects
- [Event Bus](../packages/event-bus/README.md) — bounded in-process event delivery
- [Indicators](../packages/indicators/README.md) — exchange-neutral technical indicator calculations
- [Journal](../packages/journal/README.md) — durable event recording and replay
- [Market Simulator](../packages/market-simulator/README.md) — offline market simulation
- [Notifiers](../packages/notifiers/README.md) — optional operational notifications
- [Utils](../packages/utils/README.md) — shared domain-neutral helpers

For other domains, start at the owning directory's README and AGENTS.md, then follow its ROADMAP.md and local docs index.
