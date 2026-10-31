# Free-Roll application agent instructions

This directory is owned by the **Free-Roll application domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. This file adds local rules; it cannot weaken repository-wide requirements.

## Ownership

Owned path: `apps/bot-free-roll/**`

This domain owns: strategy orchestration, pair lifecycle, trading decisions, configuration, application runtime.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

Do not silently change another domain's implementation, tests, roadmap, or public contract. For cross-domain needs, follow [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).

## Local engineering rules

- Inspect current public exports, package manifest, consumers, tests, and existing conventions before changing the API.
- Keep the public entry point thin and export only intentional public contracts.
- Prefer cohesive modules, pure functions, explicit side-effect boundaries, and immutable inputs/outputs where practical.
- Add deterministic native Node.js tests for new behavior and regression tests for defects.
- Do not add dependencies without a concrete need; prefer existing dependencies and Node.js built-ins.
- Document public contract changes and consumer migration impact.
- Update this domain's roadmap when work is accepted, blocked, deferred, or merged. Mark work complete only after it is merged into `develop` and required checks pass.

## Workflow

- Create a short-lived task branch from the latest `develop`, using `feature/bot-free-roll/<task>` or `fix/bot-free-roll/<task>`.
- Open task PRs against `develop`; do not use permanent domain branches.
- Run the relevant package test: `pnpm --filter bot-free-roll test (confirm the package's actual script before running)` (verify the package script exists before relying on it), followed by applicable workspace checks.
- The responsible agent may merge into `develop` only after required CI and target-freshness checks pass. No routine human approval is expected for `develop`.
- Never merge task work into `main`. Only the user approves the final release PR from `develop` to `main`.

## Domain-specific constraints

Do not import exchange SDKs or exchange-specific payloads into strategy/domain logic. Keep financial calculations exact and deterministic. Preserve all approved strategy invariants in README.md and ROADMAP.md. Do not change approved strategy policy without explicit user discussion.
