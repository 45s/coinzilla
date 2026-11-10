# Utilities roadmap

---
status: active
type: roadmap
owner: utils
---

## Priority execution plan — current develop direction (2026-11-10)

### COMPLETED — build and runtime provenance (issue #763)

The shared capability merged in [PR #767](https://github.com/45s/coinzilla/pull/767). Harvester's separate process-start Journal event and runtime identity consumer rollout merged in [PR #770](https://github.com/45s/coinzilla/pull/770). Issue #763 is closed as completed.

- `captureBuildMetadata()` captures allowlisted Git provenance once at process startup, with explicit `COINZILLA_BUILD_*` fallback values and unknown states when metadata is unavailable.
- Logger context is opt-in, separate from caller data, redacted, frozen, replaceable, and backward-compatible when unset.
- Harvester attaches build/runtime identity and publishes the dedicated `harvester.process_started` Journal lifecycle event while preserving optional Journal startup and mandatory trading durability barriers.

**Verification:** all six required offline CI contexts passed on the exact PR #767 and PR #770 heads; the Harvester process-lock check also passed on PR #770. The read-only TESTNET integration job was skipped; no exchange operations were performed.

### IMPORTANT — protect shared helper correctness and dependency direction

1. **Complete the repository-wide utility reuse inventory.**
   - **Why:** duplicate decimal, queue, validation or logging helpers can drift in edge-case behavior; moving domain rules into Utils would be equally harmful.
   - **Do:** inspect each application/package candidate and record one disposition: reuse existing utility, extend a genuinely generic utility, keep domain-local, or intentionally duplicate with reason. Keep the inventory linked to the shared-utilities policy and update consumer roadmaps when a shared helper is adopted.
   - **Verify:** every candidate has an owner and rationale; consumer migration tests preserve exact behavior. Do not consolidate code solely to reduce line count.

2. **COMPLETE — Logger API and consumer contract documentation (PR #631, #659).**
   - Configurable severity levels, independent transport thresholds, runtime changes, safe structured entries and transport lifecycle are implemented; `success`/`system` severity mapping, console defaults, transport failure isolation and close semantics are documented in the README/JSDoc.
   - The stale feature-branch status is removed; do not schedule duplicate Logger API work without a newly demonstrated contract gap.

3. **Enforce dependency direction for shared utilities.**
   - **Why:** broad public-index imports can create avoidable dependency cycles or make domain packages depend on unrelated filesystem/logging capabilities.
   - **Do:** expose narrow pure subpaths where a real consumer needs them; keep Utils independent of applications and domain packages. Do not move strategy, broker, Journal or entity rules into Utils.
   - **Verify:** add architecture tests for forbidden reverse imports and public-export contract tests for supported subpaths.

4. **Keep shared decimal arithmetic exact and bounded.**
   - **Why:** decimal helpers underpin money, quantity, fees and order filters; accepting floating-point inputs or unbounded precision can create silent financial drift or resource abuse.
   - **Do:** preserve BigInt-backed string arithmetic, explicit rounding, scale/precision bounds and rejection of JavaScript Number operands. Add a helper only when at least one real shared consumer needs it.
   - **Verify:** retain algebraic/edge-case regressions and consumer tests across Entities, Harvester and Market Simulator.

5. **[x] Harden Validator rule configuration ([issue #892](https://github.com/45s/coinzilla/issues/892)) — completed in merged [PR #918](https://github.com/45s/coinzilla/pull/918).**
   - **Why:** unknown rule identifiers were ignored and non-boolean `isSoft` values were interpreted by truthiness; a typo could silently disable validation.
   - **Completed:** prevalidate every tuple and rule against the exported `VR` values; reject malformed rule entries and require a boolean `isSoft` when provided. Repository code search found no production callers of `Validator.validate` or `validateItems`; existing production predicate-helper consumers are unaffected.
   - **Verify:** 198/198 dedicated Utils tests and 198/198 workspace Utils tests passed. Utils coverage is 98.53% lines, 96.33% branches, and 99.19% functions. All six required exact-head contexts passed; the dedicated Utils workflow now runs `src/*.test.js` rather than treating the package directory as one test module.

### DEFERRED

6. **Do not introduce new runtime dependencies, broad utility frameworks or speculative logger adapters.**
   - **Why:** Utils is foundational and every dependency/API change increases workspace-wide risk.
   - **Do:** require a concrete repeated use case and a compatibility plan before expanding the public API.
   - **Verify:** dependency audit, package coverage and full workspace CI pass on the exact PR head.

> Status: core shared-helper hardening, build-provenance/Logger consumer rollout, and Validator configuration hardening ([PR #918](https://github.com/45s/coinzilla/pull/918), issue [#892](https://github.com/45s/coinzilla/issues/892)) are complete. The direct console/application-logger audit is complete on `develop` at `f4fd2ab8f2cd40b497aa3b931c12f0bb9513f015`; the broader reuse inventory and automated guard remain open. Optional consolidation remains demand-driven.

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

- [x] Extend the shared Logger with independent transport thresholds, runtime configuration, safe structured entries, and transport lifecycle handling (PR #631 merged).
- [x] Document public and non-obvious `packages/utils` inputs, outputs, callbacks, async behavior, defaults, and validation contracts with JSDoc; completed in [PR #659](https://github.com/45s/coinzilla/pull/659), merged at `27388a54dd788819a08b5e605cb714258da57ccd`. JavaScript-first tooling remains unchanged.

- [x] Maintain deterministic unit tests and meaningful coverage for all exported helpers.
- [x] Review helper APIs for consistent input validation, error semantics, and immutable behavior.
- [x] Keep logging utilities structured, safe, and free of common credential fields in structured payloads; free-form log strings remain caller-owned.
- [x] Capture build provenance and structured Logger context (issue #763): shared capability merged in PR #767; Harvester process-start consumer integration merged in PR #770. PR #765 was an abandoned test-first draft and is not the delivery reference.
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

**Historical PR #383 closeout note (not the current remaining-work summary):** no runtime dependencies were added and no consumer package source files were changed in that PR. At that time, remaining work was described as reviewing duplicate generic helpers when a concrete use case justified consolidation. That snapshot is not the current remaining-work summary; use the priority plan and Repository-wide reuse audit below for current remaining work. No speculative API changes are planned.

### Direct console and logger-boundary audit — 2026-11-10

Audited current `develop` at `f4fd2ab8f2cd40b497aa3b931c12f0bb9513f015`.

| Location | Observed use | Disposition |
| --- | --- | --- |
| `packages/utils/src/logger.js` | Built-in console transport plus last-resort transport-error reporting | Approved shared logging boundary; the README documents the fallback |
| `packages/utils/src/logger.test.js` | Replaces/restores `console.log` and `console.error` | Test-only stubbing |
| `packages/notifiers/scripts/telegram-smoke.js` | Reports the result of an explicitly invoked smoke-test CLI | Approved CLI output |
| `scripts/check-syntax.js`, `scripts/check-agent-policy.js` | Reports command progress and actionable failures | Approved repository-tool CLI output |
| `apps/harvester/src/` | Bootstrap and process entry use injected `defaultLogger` | No direct console calls or app-local logger adapter found |
| `apps/harvester/scripts/` (six exact files) | Read-only TESTNET inspection, targeted-test runner, and interactive ZRO sell CLI output | Approved operator CLI output; only the exact paths are allowlisted, and CI does not invoke them |

The shared policy prohibits direct console calls in business logic and application workflows. No runtime migration was needed. The production-source guard merged in [PR #942](https://github.com/45s/coinzilla/pull/942) at `2db7d6f15a0660adea8584fa8f27827dead28902`; it scans JavaScript under `apps/` and `packages/`, with exact exceptions for the shared logger, Telegram smoke-test CLI, Harvester read-only TESTNET inspection CLIs, targeted-test runner, and interactive ZRO sell CLI. Tests/generated trees and root repository-tool scripts are outside the scan. The ZRO sell exception permits CLI output only; it does not authorize invocation. All six required `develop-core` contexts passed. The separate fatal `process.stderr.write` inventory remains open.

## Repository-wide reuse audit

- [~] Audit every application/package helper and utility for domain-neutral functionality that should be reused from @coinzilla/utils.
- [x] Consolidate exact decimal-string arithmetic shared by Harvester, Market Simulator, and Entities; shared API and consumer migrations are merged and covered by workspace tests.
- [x] Audit direct console usage and app-local logger adapters. Current `apps/harvester/src/` uses the shared `defaultLogger`; no application/domain direct console calls or app-local logger adapters were found. Production console references are limited to the exact approved paths in the policy (shared logger, Telegram smoke CLI, and six Harvester operator/test CLIs); root repository-tool scripts remain outside the source guard, and test stubs are excluded. Fatal `process.stderr.write` review remains separate.
- [ ] Record a disposition for every candidate: reuse existing utility, extend shared utility, keep domain-local, or intentionally duplicate with justification.
- [ ] Add consumer migration tests and update each owning domain's docs/roadmap as shared capabilities are adopted.

The initial findings and mandatory agent workflow are in [../../docs/engineering/SHARED_UTILITIES_POLICY.md](../../docs/engineering/SHARED_UTILITIES_POLICY.md). The inventory is preliminary; do not mark this audit complete until every candidate has been inspected and classified.

## Shared exact decimal implementation

- [x] Add BigInt-backed decimal parsing, formatting, arithmetic, comparison, rounding, rescaling, and canonical normalization to the public utils API.
- [x] Keep generic exact percentage calculations in the public utils API.
- [x] Keep the reusable keyed asynchronous task queue in the public utils API, including queue recovery when error reporting fails.
- [x] Move the generic object-input assertion from EventBus into the public utils API.
- [x] Reject JavaScript Number operands to prevent hidden precision loss; accept exact strings and bigint parsing inputs.
- [x] Add focused tests for signed values, scientific notation bounds, maximum scale/precision, division-by-zero, explicit rounding modes, increment rounding, and deterministic arithmetic identities.
- [x] Migrate Harvester, Market Simulator, and Entities consumers to the shared API; workspace CI remains the final validation gate.
- [x] Migrate the standalone Harvester TESTNET sell helper's remaining local BigInt arithmetic to `parseDecimal`, `roundDecimalToIncrement`, `compareDecimal`, and `rescaleDecimal` in merged [PR #946](https://github.com/45s/coinzilla/pull/946); exchange filter selection and operator-facing quantity policy remain in Harvester.

## Scope guard

Do not move strategy, broker, entity, event-bus, or journal rules into this package merely to share code. A helper belongs here only when it is domain-neutral and has a real shared use case.
