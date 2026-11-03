# Utilities agent instructions

This directory is owned by the **Utilities domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. This file adds local rules; it cannot weaken repository-wide requirements.

## Ownership

Owned path: `packages/utils/**`

This domain owns: domain-neutral reusable helpers, logging, generic validation and common platform utilities.

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

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/utils test` (verify the package script exists before relying on it), followed by applicable workspace checks.

## Domain-specific constraints

Before implementing anything that looks like a generic helper, search all existing packages/utils/src modules, tests, and public exports first, then search the monorepo for equivalent implementations and consumers. Follow [../../docs/engineering/SHARED_UTILITIES_POLICY.md](../../docs/engineering/SHARED_UTILITIES_POLICY.md). A missing helper should be added here only when it is domain-neutral; business rules and protocol-specific behavior stay with their owning domain.


Only add utilities that are genuinely generic and reused or clearly reusable across domains. Do not move strategy, broker, entity, event-bus, or journal business rules into utils. Prefer pure functions and deterministic node:test coverage.


## JavaScript and JSDoc

Follow the repository's [JavaScript and JSDoc standard](../../docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md).

- Keep this package implemented in JavaScript and preserve its existing Node.js ESM and native `node:test` conventions.
- Add JSDoc to exported utilities when it clarifies the public contract, parameter object, return value, callback, or important edge case.
- Do not add boilerplate comments to self-explanatory helpers or annotate every local variable.
- Keep JSDoc accurate to actual defaults, validation, errors, and return values. Tests and runtime validation remain authoritative.
- Do not add TypeScript declarations or enable TypeScript checking solely to silence an editor diagnostic in a JavaScript-only consumer.
- Add documentation-generation tooling only if the package has an agreed requirement to publish generated API docs.
