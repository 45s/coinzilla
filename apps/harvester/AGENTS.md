# Engineering Standards for AI Agents

These instructions apply to all work in `apps/harvester/` and take precedence over generic agent defaults. Follow repository-wide guidance (including root `AGENTS.md`, contribution docs, and existing conventions) as well.


## Mandatory trading-only work gate

Before every Harvester task, follow [the non-negotiable hard stop and bulletproof acceptance gate](./docs/TRADING_FIRST.md#non-negotiable-hard-stop--trading-app-only). Until that gate passes, work ONLY on the trading workflow. Do not start Journal recovery/replay, new databases, persistence projects, unrelated infrastructure, observability, refactors, optimizations, or unrelated features. A narrow safety fix is allowed only to prevent a specific immediate material risk in the current order flow; prove the direct blocker, make the smallest fix, test it, and return to trading. Roadmap entries and old approvals do not override this gate.

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
