# Repository documentation

This index is the entry point for maintained Coinzilla documentation. The repository-wide migration/adoption work is tracked in [#795](https://github.com/45s/coinzilla/issues/795). The canonical placement, ownership, lifecycle, naming, AI-agent requirements and enforcement rules are defined in [Documentation Governance](DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Repository README](../README.md) — workspace overview and setup
- [Coding-agent instructions](../AGENTS.md) — mandatory agent entry point
- [AI-agent workflow](../AI_AGENT_WORKFLOW.md) — branches, PRs, collaboration and integration
- [Engineering standards](../ENGINEERING_STANDARDS.md) — design, TDD, verification and documentation impact
- [Repository roadmap](../ROADMAP.md) — cross-workspace engineering and release work
- [Documentation Governance](DOCUMENTATION_GOVERNANCE.md) — the documentation vision and maintenance contract
- [Repository documentation inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md) — recursive inventory of all 97 tracked Markdown files at the baseline

## Repository-wide engineering

- [Engineering documentation index](engineering/README.md)
- [Architecture and decisions](architecture/README.md)
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
- [Harvester roadmap](../apps/harvester/ROADMAP.md)
- [Workspace ownership map](engineering/DOMAIN_OWNERSHIP.md)

For other domains, start at the owning directory's README and AGENTS.md, then follow its ROADMAP.md and local docs index.
