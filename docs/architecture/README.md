# Coinzilla Architecture

This directory records the intended architecture of Coinzilla and the decisions that shape it.

## Start here

- [Architecture blueprint](./COINZILLA_ARCHITECTURE.md) — system boundaries, dependency rules, runtime composition, data flows, safety constraints, testing, and incremental evolution.
- [ADR-0001: Clean and Hexagonal Architecture](./decisions/ADR-0001-clean-hexagonal-architecture.md) — the accepted architectural direction and its trade-offs.

## How to read these documents

The architecture blueprint describes **target boundaries and constraints**, not a claim that every target module or safety mechanism already exists. The current implementation and its gaps must be verified before each code change.

For Free-Roll work, read these documents together with:

1. [Free-Roll strategy specification](../../apps/bot-free-roll/README.md) — approved trading behavior.
2. [Free-Roll engineering roadmap](../../apps/bot-free-roll/ROADMAP.md) — implementation sequence, invariants, acceptance criteria, and known gaps.
3. [Current-state audit](../../apps/bot-free-roll/CURRENT_STATE.md) — dated evidence about the implementation at the audited ref; re-check source before relying on it.
4. [Engineering standards](../../ENGINEERING_STANDARDS.md).
5. [AI-agent workflow](../../AI_AGENT_WORKFLOW.md).

## Authority and change policy

- The strategy README remains authoritative for approved Free-Roll trading behavior.
- The Free-Roll roadmap remains authoritative for that application's engineering backlog and sequencing.
- The engineering standards and AI-agent workflow remain mandatory repository-wide rules.
- This architecture blueprint establishes cross-cutting structural guidance. It does not silently approve changes to trading policy, package ownership, or public APIs.
- If these documents conflict, stop and identify the conflict. Do not resolve it by assumption.
- Record material architecture changes as a new ADR. Do not rewrite an accepted ADR to hide a decision's history.

## Status

- Architecture direction: accepted.
- Detailed target design: documented.
- Implementation: incremental; no implementation completion is implied by these documents.
