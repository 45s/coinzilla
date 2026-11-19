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

## Generic validation

- Use the public `ensure` API for new generic input/type/range/collection checks. Search for an existing helper before duplicating a check.
- Prefer a direct `ensure.*` assertion for one constraint; use `ensure.chain({ value, name })` only when composing multiple validations or transformations improves readability.
- All calls use a single options object. Do not introduce positional validator arguments, validation DSLs, or coercion.
- Keep strategy, exchange, entity and other domain invariants local. Do not replace existing boolean predicates with throwing assertions when semantics differ.
- `Validator`/`VR` are legacy compatibility APIs; do not add new callers.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/utils test` and `pnpm --filter @coinzilla/utils test:coverage` (verify both scripts exist before relying on them), followed by applicable workspace checks. The coverage command enforces 90% line and 85% branch coverage.

## Domain-specific constraints

This package owns only domain-neutral reusable capabilities. Follow the [Shared Utilities Policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md) for search-first reuse, API ownership, logging, and utility classification.

## JavaScript and JSDoc

Follow the [repository JavaScript and JSDoc standard](../../docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md). Preserve the package's Node.js ESM and native `node:test` conventions.
