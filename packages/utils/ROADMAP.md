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

## Audit findings and active remediation

The current audit identified these concrete items:

- [~] Extract the non-trivial pure numeric operations and validation rules from static facade classes into focused modules while preserving `NH`, `Validator`, and `VR` entry points.
- [~] Validate wait durations before passing them to Node timers; reject negative, non-finite, non-numeric, and out-of-range values rather than relying on timer coercion.
- [~] Make log formatting resilient to hostile values whose JSON serialization and string coercion both throw.
- [~] Stop including feature-flag environment variable values in warning diagnostics; return a deterministic `false` if warning reporting fails but error reporting succeeds.
- [~] Remove the filesystem helper's import through the public package index to avoid an unnecessary circular dependency.
- [~] Add package-specific coverage thresholds and a CI negative self-check, then expand regression coverage for the affected boundaries.

Compatibility constraints: retain existing public exports and the legacy `NH` / `Validator` facade shapes; preserve existing numeric calculations, result structures, event-emitter singleton behavior, and successful filesystem append semantics. No runtime dependencies are required.

## Roadmap

- [~] Maintain deterministic unit tests and meaningful coverage for all exported helpers.
- [~] Review helper APIs for consistent input validation, error semantics, and immutable behavior.
- [~] Keep logging utilities structured, safe, and free of secrets or sensitive payloads.
- [ ] Remove or consolidate genuinely duplicated generic helpers when doing so does not couple unrelated domains.
- [x] Review dependency usage and keep the package minimal; no new runtime dependencies introduced.

## Scope guard

Do not move strategy, broker, entity, event-bus, or journal rules into this package merely to share code. A helper belongs here only when it is domain-neutral and has a real shared use case.
