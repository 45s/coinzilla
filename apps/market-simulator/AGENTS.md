# Market Simulator agent instructions

This directory is owned by the **Market Simulator application domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. This file adds local rules and cannot weaken repository-wide requirements.

## Ownership

Owned path: `apps/market-simulator/**`

This domain owns fixture storage/validation, deterministic market replay and scenario generation, the simulated broker adapter, and simulator-specific transport/orchestration.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

## Contract and domain boundaries

- Reuse the existing `CoreBroker` contract and Coinzilla entities/messages/events. Do not create a parallel broker interface or simulator-specific strategy-facing payloads.
- Inspect current broker source, Binance adapter behavior, contract tests, and consumers before implementing a method or event.
- Do not modify `packages/brokers/**` contracts from this application. Route required shared-contract changes through the Brokers domain and the repository cross-domain request process.
- Keep the market engine independent of exchange protocols, broker contracts, strategy rules, and network I/O.
- Keep fixture parsing and filesystem access at explicit boundaries. Keep deterministic replay calculations pure and independently testable.
- Never fabricate historical price data or silently change source timestamps, ordering, or precision.
- Default tests must be deterministic and offline. Never use live exchange access or credentials in unit tests.

## Workflow

- Create a short-lived task branch from the latest `develop`, using `feature/market-simulator/<task>` or `fix/market-simulator/<task>`.
- Open task PRs against `develop`; never target `main` directly.
- Run the package tests and coverage checks, followed by applicable workspace and CI checks. Verify scripts in the current manifest before relying on them.
- Update this application's roadmap and docs when decisions, scope, or implementation status change.
- Mark roadmap work complete only after it is merged into `develop` and required checks pass.
