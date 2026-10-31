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
- Create a short-lived task branch from latest `develop`, such as `feature/journal/<task>` or `fix/journal/<task>`.
- Open task PRs against `develop`; do not create a permanent domain branch.
- Run `pnpm --filter @coinzilla/journal test` after verifying the script exists, then applicable workspace checks.
- The responsible agent may merge to `develop` only after required CI and target-freshness checks pass. No routine human approval is expected.
- Never merge task work into `main`; the user approves only the final `develop` to `main` release PR.
- Update this roadmap when work changes scope or status. Mark an item complete only after merge into `develop` and passing required checks.
