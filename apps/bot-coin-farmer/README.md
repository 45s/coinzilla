# Coinzilla — Coin Farmer

**Application path:** `apps/bot-coin-farmer`  
**Status:** Architecture design phase — implementation not started  
**Relationship to Free-Roll:** Independent successor application; Free-Roll remains V1 reference

Coin Farmer is the planned successor trading application in the Coinzilla workspace. It is intended to carry forward the Free-Roll coin-accumulation strategy concept while allowing a new architecture and implementation.

## Application boundary

- `apps/bot-free-roll` is the existing V1 application. It is preserved as the reference during Coin Farmer design and development.
- `apps/bot-coin-farmer` is a separate application with its own source, tests, configuration, documentation, runtime lifecycle, and state ownership.
- Coin Farmer must not import V1 application source code or depend on V1 runtime state.
- Coin Farmer may reuse shared Coinzilla packages through their public APIs after reviewing the actual contracts and ownership rules.
- V1 and Coin Farmer may coexist during development and validation. Any simultaneous operation against the same exchange account requires explicit safeguards against duplicate orders and conflicting inventory ownership.

## Start here

1. [Coin Farmer architecture](./docs/architecture/README.md) — application boundaries, logical layers, dependencies, workflows, safety and open design questions.
2. [V1-to-successor behavior plan](./docs/architecture/V1_TO_V2_BEHAVIOR_PLAN.md) — how to discover and map strategy behavior without copying V1 implementation coupling.
3. [Coinzilla-wide architecture](../../docs/architecture/README.md) — cross-cutting architecture and ADRs.
4. [Engineering standards](../../ENGINEERING_STANDARDS.md) and [AI-agent workflow](../../AI_AGENT_WORKFLOW.md).

## Authority

- The [Free-Roll V1 strategy specification](../bot-free-roll/README.md) is the current reference for documented strategy behavior.
- The [Free-Roll V1 roadmap](../bot-free-roll/ROADMAP.md) records V1 engineering invariants and backlog. It is not automatically Coin Farmer's implementation roadmap.
- Coin Farmer's own approved behavior, contracts, architecture decisions, and roadmap must be recorded under this application before implementation relies on them.
- Repository-wide engineering standards and workflow remain mandatory.

## Current non-goals

This documentation does not create a runnable application, approve a package manifest or dependency list, freeze a final source tree, select a persistence technology, approve a broker API redesign, or authorize live trading. Those decisions belong to the subsequent Coin Farmer design and implementation discussions.
