# Modularity standard

This document is the canonical decision standard for module boundaries. Apply it to new code and to code materially changed by a PR.

## Default

Prefer cohesive modules, explicit side-effect boundaries, and deterministic logic that can be tested from explicit inputs. Classes and services should own state and coordinate effects; pure functions should express calculations, validation, normalization, mapping, and policy decisions when that separation makes the behavior easier to understand and verify.

## When a pure function should be extracted

Extract a function into a focused module when one or more of these are true:

- It expresses a meaningful business/domain rule or calculation with a distinct name and contract.
- It can be tested independently without constructing a service or mocking infrastructure.
- It separates deterministic decision-making from I/O, mutable state, clocks, randomness, or orchestration.
- It has multiple consumers or is likely to be reused within the owning domain.
- Its extraction materially improves cohesion, readability, or change isolation.

A single caller is not a reason to keep meaningful logic embedded in a large service. Conversely, purity alone is not a reason to extract every expression.

Keep logic local when it is trivial, tightly coupled to a single callback/context, or clearer beside the orchestration that uses it. Do not create one-function files solely to satisfy a rule or reduce a line count.

## Module and file size review

- Organize by responsibility and domain, not a rigid folder template.
- Keep public entry points thin and avoid circular dependencies.
- Use package-local helpers for cohesive internal behavior; use packages/utils only for domain-neutral contracts.
- Review files approaching 300 lines for cohesion and extraction opportunities.
- Files exceeding 500 lines require a concrete technical justification or a scoped refactoring plan in the PR.
- These are review triggers, not automatic extraction targets.

## Review questions

1. Does each module have one cohesive reason to change?
2. Are domain decisions independent of infrastructure and exchange protocols?
3. Are side effects explicit and dependencies injected where useful?
4. Does an extraction improve independent testing or comprehension?
5. Is a shared helper truly domain-neutral, and has packages/utils been searched first?
6. Does the resulting structure reduce coupling rather than merely increase file count?

The repository root AGENTS.md and ENGINEERING_STANDARDS.md link to this standard. Domain-specific constraints may be stricter where required for financial correctness or protocol isolation, but should not force mechanical fragmentation.
