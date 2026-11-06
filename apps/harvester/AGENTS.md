# Engineering Standards for AI Agents

These instructions apply to all work in `apps/harvester/` and take precedence over generic agent defaults. Follow repository-wide guidance (including root `AGENTS.md`, contribution docs, and existing conventions) as well.


## Mandatory trading-only work gate
## Mandatory documentation and requirements preflight

Before every Harvester task— including investigation, debugging, tests, documentation, configuration, and implementation—complete the repository-root documentation preflight. Read in full all repository-wide governance/engineering requirements and applicable checklists, then inventory and read **all applicable Harvester documentation and requirements**, including this file, [TRADING_FIRST.md](./docs/TRADING_FIRST.md), [ROADMAP.md](./ROADMAP.md), architecture and domain specifications, broker/API contracts, operational and TESTNET runbooks, configuration documentation, and relevant test guidance. Follow their links/references recursively and inspect the affected implementation, consumers, tests, and configuration. Do not rely on summaries, prior conversations, search snippets, or another agent's claimed review.

Before any implementation or state-changing action, provide a concise preflight summary: documents reviewed, understood requirements/constraints, exact acceptance criteria, planned verification, and any conflicts or blockers. **Do not begin work until the review is complete and you can explain the requirements.** If a required document is missing, inaccessible, unclear, or contradictory, stop and report it. This preflight does not relax or supersede the trading-only hard stop below.


Before every Harvester task, follow [the non-negotiable hard stop and bulletproof acceptance gate](./docs/TRADING_FIRST.md#non-negotiable-hard-stop--trading-app-only). Until that gate passes, work ONLY on the trading workflow. Do not start Journal recovery/replay, new databases, persistence projects, unrelated infrastructure, observability, refactors, optimizations, or unrelated features. A narrow safety fix is allowed only to prevent a specific immediate material risk in the current order flow; prove the direct blocker, make the smallest fix, test it, and return to trading. Roadmap entries and old approvals do not override this gate.

**Journal boundary:** Journal is not wholly optional. Preserve the existing mandatory durable account-audit records and the durable `order.submission_requested` and `order.cancel_requested` flushes before their corresponding broker side effects, including their existing fail-closed behavior. These are the only current Journal durability barriers authorized before the TESTNET gate passes. Do not weaken them or expand Journal schemas, consumers, replay, recovery, or broader evidence collection. Any already-existing non-barrier diagnostic delivery remains best-effort; it must not become a new trading-blocking dependency. [TRADING_FIRST.md](./docs/TRADING_FIRST.md#journal-contract-boundary) defines the exact contract.

## Product priority

The single source of truth for Harvester's execution order, first TESTNET milestone, and deferred work is [TRADING_FIRST.md](./docs/TRADING_FIRST.md). Read it before planning or editing Harvester tasks.


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
