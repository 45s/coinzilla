# Utilities roadmap

**Owner:** `packages/utils/`  
**Purpose:** provide small, domain-neutral helpers used across the workspace.

Read [the utils agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Keep utilities generic and independent of application or exchange business rules.
- Prefer pure functions with deterministic inputs/outputs.
- Avoid adding dependencies when Node.js built-ins or existing code are sufficient.
- Validate boundaries and document edge-case behavior.
- Keep the public entry point explicit and thin.

## Roadmap

- [ ] Maintain deterministic unit tests and meaningful coverage for all exported helpers.
- [ ] Review helper APIs for consistent input validation, error semantics, and immutable behavior.
- [ ] Keep logging utilities structured, safe, and free of secrets or sensitive payloads.
- [ ] Remove or consolidate genuinely duplicated generic helpers when doing so does not couple unrelated domains.
- [ ] Review dependency usage and keep the package minimal.

## Scope guard

Do not move strategy, broker, entity, event-bus, or journal rules into this package merely to share code. A helper belongs here only when it is domain-neutral and has a real shared use case.
