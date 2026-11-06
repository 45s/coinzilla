# Engineering Standards for AI Agents

These instructions apply to all work in `apps/harvester/` and take precedence over generic agent defaults. Follow repository-wide guidance (including root `AGENTS.md`, contribution docs, and existing conventions) as well.


## Mandatory documentation and requirements preflight

Before every Harvester task— including investigation, debugging, tests, documentation, configuration, and implementation—complete the repository-root documentation preflight. Read in full all repository-wide governance/engineering requirements and applicable checklists, then inventory and read **all applicable Harvester documentation and requirements**, including this file, [TRADING_FIRST.md](./docs/TRADING_FIRST.md), [ROADMAP.md](./ROADMAP.md), architecture and domain specifications, broker/API contracts, operational and TESTNET runbooks, configuration documentation, and relevant test guidance. Follow their links/references recursively and inspect the affected implementation, consumers, tests, and configuration. Do not rely on summaries, prior conversations, search snippets, or another agent's claimed review.

Before any implementation or state-changing action, provide a concise preflight summary: documents reviewed, understood requirements/constraints, exact acceptance criteria, planned verification, and any conflicts or blockers. **Do not begin work until the review is complete and you can explain the requirements.** If a required document is missing, inaccessible, unclear, or contradictory, stop and report it. Explicitly selected user tasks define the work scope; a TESTNET acceptance milestone is not a blanket prerequisite for Journal or engineering work.


Follow the selected issue's scope and repository task workflow. Journal evidence is an explicitly selected Harvester workstream; it must not change strategy decisions, become trading-state authority, or add blocking I/O to market, broker-event, or fill-accounting paths.

## Product priority

[TRADING_FIRST.md](./docs/TRADING_FIRST.md) remains the source of truth for trading behavior and exchange-safety requirements. It does not impose a blanket acceptance gate on separately selected engineering work.


## Before changing code

Follow the repository [task workflow](../../docs/engineering/TASK_WORKFLOWS.md) and inspect the current Harvester implementation, consumers, tests, configuration, and roadmap before designing a change.

## Implementation quality

Follow the canonical [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and [Modularity Standard](../../docs/engineering/MODULARITY_STANDARD.md). This file records only Harvester-specific constraints.

## Tests and verification

Follow the canonical engineering verification requirements. Harvester behavior changes require deterministic tests; exchange-order verification is opt-in and TESTNET-only.

## Changes and delivery

**Per-commit documentation rule:** every commit that changes Harvester implementation, configuration, tests, or runtime behavior MUST include the corresponding documentation update in that same commit. If behavior is unchanged, state that explicitly in the commit/PR summary.

## Security and operational safety

Follow the canonical security requirements in [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and Harvester's TESTNET/live-trading boundary in [TRADING_FIRST.md](./docs/TRADING_FIRST.md). Never enable live trading as part of routine development.

## Domain implementation style

Follow the repository [modularity standard](../../docs/engineering/MODULARITY_STANDARD.md). Harvester-specific requirements: deterministic trading calculations and strategy decisions are plain pure functions; classes own state and enforce lifecycle invariants; use cases coordinate workflows through injected ports. See [Architecture](./docs/architecture.md#implementation-pattern-for-use-cases) for the established factory/composition pattern.

## Application architecture

Follow the authoritative [Harvester architecture](./docs/architecture.md) for use-case factories, ports, adapters, bootstrap composition, and dependency direction. Reuse existing entity and broker contracts; do not introduce parallel domain models or adapter-specific details into strategy/domain code.

## Logging

Follow the [Shared Utilities Policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md) for logger selection, structured diagnostics, and console restrictions. Harvester bootstrap defaults to `defaultLogger` from `@coinzilla/utils`.
