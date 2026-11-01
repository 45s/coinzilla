# Utilities roadmap

> Status: core audit hardening complete; optional cleanup remains demand-driven

**Owner:** `packages/utils/`  
**Purpose:** provide small, domain-neutral helpers used across the workspace.

Read [the utils agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Keep utilities generic and independent of application or exchange business rules.
- Prefer pure functions with deterministic inputs/outputs.
- Avoid adding dependencies when Node.js built-ins or existing code are sufficient.
- Validate boundaries and document edge-case behavior.
- Keep the public entry point explicit and thin.

## Audit outcomes

The current audit identified these concrete items:

- [x] Extract pure numeric operations and validation rules into focused modules while preserving `NH`, `Validator`, and `VR` entry points.
- [x] Validate wait durations before passing them to Node timers; reject negative, non-finite, non-numeric, and out-of-range values rather than relying on timer coercion.
- [x] Make log formatting resilient to hostile values whose JSON serialization and string coercion both throw, and redact common credential-bearing fields from structured payloads.
- [x] Stop including feature-flag environment variable values in warning diagnostics; return a deterministic `false` if warning reporting fails but error reporting succeeds.
- [x] Remove the filesystem helper's import through the public package index to avoid an unnecessary circular dependency.
- [x] Add package-specific coverage thresholds and a CI negative self-check, then expand regression coverage for the affected boundaries.

Compatibility constraints: retain existing public exports and the legacy `NH` / `Validator` facade shapes; preserve existing numeric calculations, result structures, event-emitter singleton behavior, and successful filesystem append semantics. No runtime dependencies are required.

## Roadmap

- [x] Maintain deterministic unit tests and meaningful coverage for all exported helpers.
- [x] Review helper APIs for consistent input validation, error semantics, and immutable behavior.
- [x] Keep logging utilities structured, safe, and free of common credential fields in structured payloads; free-form log strings remain caller-owned.
- [ ] Remove or consolidate genuinely duplicated generic helpers when doing so does not couple unrelated domains.
- [x] Review dependency usage and keep the package minimal; no new runtime dependencies introduced.

## Validation record

Core audit hardening was merged in [PR #383](https://github.com/45s/coinzilla/pull/383) at merge commit `852f789805f9cabf53a0b8994314a09e38c8d9fb`.

The exact final PR head passed:
- Package utils tests ([run](https://github.com/45s/coinzilla/actions/runs/41289828477)).
- Workspace tests on Node.js 22.23.4 and Node.js 24.x ([run](https://github.com/45s/coinzilla/actions/runs/41289828472)).
- Workspace coverage, including the new utilities package threshold and its negative self-check ([run](https://github.com/45s/coinzilla/actions/runs/41289828464)).
- Utilities production-source coverage: 99.12% lines, 98.80% branches, 100% functions.
- JavaScript syntax ([run](https://github.com/45s/coinzilla/actions/runs/41289828493)).
- Production dependency audit and actionlint ([run](https://github.com/45s/coinzilla/actions/runs/41289828470)).

No runtime dependencies were added and no consumer package source files were changed. Remaining work is deliberately limited to reviewing duplicate generic helpers when a concrete use case justifies consolidation; no speculative API changes are planned.

## Scope guard

Do not move strategy, broker, entity, event-bus, or journal rules into this package merely to share code. A helper belongs here only when it is domain-neutral and has a real shared use case.
