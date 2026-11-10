# Journal agent instructions

This directory is owned by the **Journal domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. These local instructions add constraints but cannot weaken repository-wide rules.

## Ownership
Owned path: `packages/journal/**`.

This domain owns journal record contracts, persistence boundaries, append/read behavior, serialization, replay, and journal-specific lifecycle.

Roadmap: [ROADMAP.md](./ROADMAP.md).

Do not silently change another domain's implementation, tests, roadmap, or public contract. For cross-domain needs, follow [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).

## Local engineering rules
- Inspect the package manifest, public exports, consumers, tests, and current storage behavior before changing contracts.
- Keep journal storage and record semantics independent of application strategy decisions.
- Preserve historical records; make serialization, schema evolution, replay, and recovery behavior explicit.
- Prefer cohesive modules, pure functions, and explicit I/O boundaries.
- Add deterministic tests for partial failures, duplicate/replay behavior, serialization compatibility, and cleanup where relevant.
- Avoid new dependencies unless there is a concrete need.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, roadmap status, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/journal test` and `pnpm --filter @coinzilla/journal test:coverage` after verifying both scripts exist, then applicable workspace checks. The coverage command enforces 85% line and 80% branch coverage over Journal-owned source files.



