# Utilities roadmap

## Priority execution plan — current develop direction (2026-11-08)

### IN PROGRESS — build and runtime provenance (issue #763 / PR #765)

**Why:** rapid development changes `develop` between process starts. Journal and TRACE evidence must identify the exact application version, Git revision, working-tree state, and runtime process that produced it.

**Utilities-owned scope:**
- Capture allowlisted Git metadata once at process startup: full/short SHA, branch, commit subject/date, and clean/dirty state.
- Use explicit `COINZILLA_BUILD_*` variables only when Git metadata is unavailable; missing values remain unknown.
- Add opt-in Logger context that is separate from caller data, redacted, frozen, replaceable, and backward-compatible when unset.
- Preserve native Node.js APIs and avoid new dependencies.

**Coordinated consumer rollout:** after this shared capability is merged, Harvester will add a distinct process-start Journal event with PID, UTC start time, runtime session ID, package version, and source identity. That consumer change belongs to the Harvester roadmap and a separate owner-scoped PR. It must preserve non-blocking optional read-only Journal initialization and mandatory durable Journal barriers for TESTNET trading.

**Verification:** native unit tests and package coverage; workspace CI, JavaScript syntax, dependency audit, and actionlint on the exact final PR head. No CI thresholds or assertions may be weakened.


### IMPORTANT — protect shared helper correctness and dependency direction

1. **Complete the repository-wide utility reuse inventory.**
   - **Why:** duplicate decimal, queue, validation or logging helpers can drift in edge-case behavior; moving domain rules into Utils would be equally harmful.
   - **Do:** inspect each application/package candidate and record one disposition: reuse existing utility, extend a genuinely generic utility, keep domain-local, or intentionally duplicate with reason. Keep the inventory linked to the shared-utilities policy and update consumer roadmaps when a shared helper is adopted.
   - **Verify:** every candidate has an owner and rationale; consumer migration tests preserve exact behavior. Do not consolidate code solely to reduce line count.

2. **Finish the Logger API status and consumer contract documentation.**
   - **Why:** the roadmap still describes configurable levels/transports as in progress on a feature branch, but PR #631 is merged. Stale status can cause duplicate implementation or consumers to rely on an incomplete contract.
   - **Do:** mark configurable severity levels, independent transport thresholds, runtime changes, safe structured entries and transport lifecycle as complete. Document `success`/`system` severity mapping, default console behavior, custom transport failure isolation and close semantics. Audit existing Harvester logging use without changing its established output unnecessarily.
   - **Verify:** Logger tests cover independent thresholds, runtime level changes, asynchronous write/close failure, redaction and queue/lifecycle behavior; README/JSDoc/roadmap agree with the merged API.

3. **Enforce dependency direction for shared utilities.**
   - **Why:** broad public-index imports can create avoidable dependency cycles or make domain packages depend on unrelated filesystem/logging capabilities.
   - **Do:** expose narrow pure subpaths where a real consumer needs them; keep Utils independent of applications and domain packages. Do not move strategy, broker, Journal or entity rules into Utils.
   - **Verify:** add architecture tests for forbidden reverse imports and public-export contract tests for supported subpaths.

4. **Keep shared decimal arithmetic exact and bounded.**
   - **Why:** decimal helpers underpin money, quantity, fees and order filters; accepting floating-point inputs or unbounded precision can create silent financial drift or resource abuse.
   - **Do:** preserve BigInt-backed string arithmetic, explicit rounding, scale/precision bounds and rejection of JavaScript Number operands. Add a helper only when at least one real shared consumer needs it.
   - **Verify:** retain algebraic/edge-case regressions and consumer tests across Entities, Harvester and Market Simulator.

### DEFERRED

5. **Do not introduce new runtime dependencies, broad utility frameworks or speculative logger adapters.**
   - **Why:** Utils is foundational and every dependency/API change increases workspace-wide risk.
   - **Do:** require a concrete repeated use case and a compatibility plan before expanding the public API.
   - **Verify:** dependency audit, package coverage and full workspace CI pass on the exact PR head.


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

- [x] Extend the shared Logger with independent transport thresholds, runtime configuration, safe structured entries, and transport lifecycle handling (PR #631 merged).
- [x] Document public and non-obvious `packages/utils` inputs, outputs, callbacks, async behavior, defaults, and validation contracts with JSDoc; completed in [PR #659](https://github.com/45s/coinzilla/pull/659), merged at `27388a54dd788819a08b5e605cb714258da57ccd`. JavaScript-first tooling remains unchanged.

- [x] Maintain deterministic unit tests and meaningful coverage for all exported helpers.
- [x] Review helper APIs for consistent input validation, error semantics, and immutable behavior.
- [x] Keep logging utilities structured, safe, and free of common credential fields in structured payloads; free-form log strings remain caller-owned.
- [~] Capture build provenance and structured Logger context (issue #763 / PR #765). Test-first contract commit is in place; GitHub CI confirmed the expected missing-API RED result. Implementation and consumer rollout remain in progress.
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

## Repository-wide reuse audit

- [~] Audit every application/package helper and utility for domain-neutral functionality that should be reused from @coinzilla/utils.
- [x] Consolidate exact decimal-string arithmetic shared by Harvester, Market Simulator, and Entities; shared API and consumer migrations are merged and covered by workspace tests.
- [ ] Audit direct console usage and app-local logger adapters; standardize diagnostics on the shared Logger / defaultLogger API.
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

## Scope guard

Do not move strategy, broker, entity, event-bus, or journal rules into this package merely to share code. A helper belongs here only when it is domain-neutral and has a real shared use case.
