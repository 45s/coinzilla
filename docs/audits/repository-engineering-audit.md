# Repository Engineering Audit

**Repository:** `45s/coinzilla`  
**Target branch:** `develop`  
**Audit branch:** `audit/repository-engineering`  
**Audit date:** 2026-11-01  
**Status:** Evidence-based initial audit; runtime changes intentionally not made. Full source-level dependency and runtime verification remains incomplete.

## Executive summary

The repository has a clear pnpm workspace structure, explicit domain ownership, thin public entry points in the inspected shared packages, and a documented short-lived-branch workflow. The workspace dependency declarations form an acyclic directed graph. Previous hardening work in `utils`, `notifiers`, and `event-bus` is documented with regression coverage and CI evidence.

One concrete documentation defect was corrected in this audit: the root README described a combined “Quality Gate” workflow that installed dependencies and ran `pnpm run quality`, but the actual `quality-gate.yml` workflow is named “JavaScript Syntax” and runs actionlint plus the syntax checker only. The README now describes each workflow and its actual scope.

No production-code or dependency changes were made. The available repository connection supports file and GitHub operations but does not provide a local checkout or shell/runtime execution. Consequently, package tests, coverage, syntax, dependency audit, and local Markdown tooling could not be executed in this session. The report distinguishes source inspection from executed verification and leaves unresolved phases explicit rather than claiming the full definition of done.

### Highest-priority risks

1. **P1 — Journal contract and recovery semantics remain under-specified.** The package currently exposes an append-oriented JSONL journal. Its roadmap still lists record-schema documentation, read/replay semantics, serialization compatibility, and recovery behavior as open work. These are important for preserving and interpreting trading history.
2. **P2 — Coverage enforcement is uneven across packages.** Dedicated thresholds exist for utils, notifiers, event-bus, and the Free-Roll application. The inspected manifests for entities, brokers, and journal do not define package-specific coverage gates.
3. **P2 — Root package publishability is ambiguous.** The root manifest declares a package name, version, and `main: index.js`, but the repository has no root `index.js` and the manifest is not marked `private`. Confirm whether the root workspace package is intended to be publishable.
4. **P2 — JavaScript linting/formatting are not enforced.** CI validates syntax and GitHub Actions workflow syntax, but the inspected workflows do not run a JavaScript linter or formatter.
5. **P2 — Develop ruleset deletion protection is a documented configuration gap.** The root roadmap says the `develop` ruleset lacks a branch-deletion restriction. This is a GitHub-side configuration issue and was not changed or re-verified during this audit.

No P0 issue was evidenced by the inspected files.

## Repository architecture

### Package inventory

| Workspace | Responsibility | Declared workspace dependencies |
|---|---|---|
| `packages/utils` — `@coinzilla/utils` | Generic helpers, logging, validation, result and environment utilities | None |
| `packages/entities` — `@coinzilla/entities` | Exchange-neutral domain/value contracts | utils |
| `packages/event-bus` — `@coinzilla/event-bus` | In-process event publication/subscription | utils |
| `packages/notifiers` — `@coinzilla/notifiers` | Telegram notification transport | None |
| `packages/journal` — `@coinzilla/journal` | Event journal and JSONL persistence | event-bus, utils |
| `packages/brokers` — `@coinzilla/brokers` | Binance broker and exchange integration | entities, utils |
| `apps/bot-free-roll` — `@coinzilla/bot-free-roll` | Application composition and Free-Roll strategy | brokers, entities, event-bus, journal, notifiers, utils |

The workspace is defined by `pnpm-workspace.yaml` with `apps/*` and `packages/*`. The package dependency declarations and lockfile importer records agree on the graph above. At the manifest level, dependencies flow from application/domain adapters toward shared lower-level contracts; no package dependency cycle is declared.

### Dependency and coupling findings

- **Positive:** `utils` is a leaf dependency and the inspected package manifests do not introduce a shared-package cycle.
- **Positive:** `event-bus`, `journal`, `notifiers`, `brokers`, and `entities` expose explicit entry points. The inspected `event-bus`, `journal`, and `notifiers` entry points are re-export surfaces rather than implementation containers.
- **Positive:** broker-specific Binance behavior remains in `packages/brokers`; exchange-neutral contracts are in `packages/entities`.
- **Positive:** `notifiers` is dependency-free and consumes event-bus behavior through its integration boundary rather than declaring a direct workspace dependency.
- **Known historical fix:** `packages/utils/ROADMAP.md` records removal of a filesystem helper import through the public package index to avoid a circular import.
- **Not yet proven:** a complete scan of all relative imports and runtime import cycles requires enumerating and parsing every JavaScript source file. The manifest graph alone cannot prove the absence of internal or relative-import cycles. No repository-wide import scanner was executed in this session.

**Recommendation:** keep the current dependency direction. Do not add a common package to consolidate small amounts of duplication. Complete a source-level import graph scan as a follow-up and investigate only cycles or cross-package internal imports it actually finds.

## Reliability

### Findings

- The utils roadmap documents hardening for bounded timer inputs, hostile log-value formatting, credential-field redaction in structured payloads, safer feature-flag diagnostics, and the import-cycle fix.
- The notifiers roadmap documents bounded pending delivery, cleanup after partial subscription failure, idempotent close behavior, queue recovery, malformed-response rejection, and credential redaction. The package has a 90% line / 85% branch coverage gate.
- The event-bus roadmap documents bounded delivery/lifecycle behavior, error handling, malformed-input regression tests, and a 90% line / 85% branch coverage gate.
- The journal implementation serializes event records to JSONL, serializes writes through a promise queue, waits for event-bus delivery before flush/close, syncs the file handle, and returns errors for failed writes or syncs. The inspected tests cover event ordering, startup/close races, malformed records, logger failures, failed syncs, and cleanup.
- The journal package has no package README in the inspected path list, and its roadmap still lists schema, replay, compatibility, and recovery work as open. The current public entry point exports `Journal`; the inspected implementation provides start/record/flush/close behavior, not a public read/replay API.

### Prioritized reliability issue

**P1 — Define the journal's persistence contract before treating it as a durable recovery source.**

Evidence:
- `packages/journal/src/index.js` exports only `Journal`.
- `packages/journal/src/journal.js` writes JSONL records and exposes no read/replay method.
- `packages/journal/ROADMAP.md` leaves record schema, append/read ordering, duplicate/replay handling, serialization compatibility, interruption recovery, and resource bounds open.

Impact: consumers may retain event history without a documented contract for schema evolution, replay, or recovery. This is especially important where the journal is used to investigate or reconstruct trading activity.

Recommended owner action: the Journal domain should define whether the journal is intentionally write-only or is expected to support read/replay. Document the on-disk schema and versioning policy, then add tests for the chosen compatibility and recovery guarantees. No speculative API was added by this repository-wide audit.

## Test quality and coverage

### Existing infrastructure

- Native Node.js `node:test` is used throughout the inspected package manifests.
- Root `pnpm test` recursively runs workspace test scripts.
- Root `pnpm run test:coverage` invokes Node's test coverage support across the package and app workspaces.
- The coverage workflow enforces package-specific thresholds for utils, notifiers, event-bus, and Free-Roll.
- Broker integration tests are separated from the default unit suite and are documented as TESTNET-only where they place orders.
- Unit-test CI runs on Node.js 22.23.4 and Node.js 24.x.

### Gaps and risks

- Dedicated coverage thresholds are not declared in the inspected manifests for entities, brokers, or journal. Workspace coverage reports are useful, but they do not provide the same package-level regression floor.
- Coverage CI is pinned to Node.js 22.23.4; the unit-test matrix covers Node.js 22.23.4 and 24.x. This is a deliberate split in the current workflow, but coverage behavior on Node 24 is not independently verified.
- The repository has tests for journal failure scenarios, but the roadmap does not yet define a complete schema/replay acceptance suite.
- No tests were added in this audit because no production behavior was changed.

**Recommendation:** establish package-specific thresholds only after measuring current coverage and reviewing uncovered behavior. Prioritize broker error/recovery boundaries and journal persistence/recovery semantics over percentage-only targets.

## Public APIs and backward compatibility

- The inspected package entry points are explicit and small. Notifiers documents a backwards-compatible `formatNotification` alias.
- Entities' roadmap explicitly preserves legacy `Coin`, `Order`, and `ExecutedOrder` behavior while adding canonical exact-value contracts.
- Brokers' README documents Node.js 22.23.4 as its runtime floor and preserves legacy broker behavior where newer canonical APIs are additive.
- The root workspace manifest has `name: coinzilla`, `version: 1.0.0`, and `main: index.js`, but the root `index.js` path does not exist and the root manifest does not set `private: true`.

**P2 — Clarify root package publishing intent.** If the root is workspace metadata only, mark it private and remove or correct the invalid main entry. If it is intentionally publishable, add the actual entry point and a packaging test. No manifest change was made because the intended release model was not established by the inspected documentation.

No public package API or runtime behavior was changed in this audit.

## CI, dependencies, and release readiness

### Workflow inventory

| Workflow | Observed behavior |
|---|---|
| `quality-gate.yml` — workflow name “JavaScript Syntax” | Runs actionlint and `node scripts/check-syntax.js`; does not install dependencies or run workspace tests |
| `unit-tests.yml` — “Unit Tests” | Frozen pnpm install; `pnpm test` on Node.js 22.23.4 and 24.x |
| `utils-unit-tests.yml` — “Utils Unit Tests” | Runs `node --test packages/utils` on Node.js 22.23.4 |
| `test-coverage.yml` — “Test Coverage” | Workspace coverage plus package thresholds and negative threshold self-checks on Node.js 22.23.4 |
| `dependency-audit.yml` — “Dependency Audit” | Runs `pnpm audit --prod --audit-level high` on PRs, pushes to main/develop, and weekly |

The root package's local `quality` script runs `pnpm test` and then `pnpm run check:syntax`. The inspected CI workflow named `quality-gate.yml` does not invoke that script.

### Documentation correction made

The root `README.md` previously stated that a “Quality Gate” workflow installed dependencies and ran `pnpm run quality`. That description did not match `.github/workflows/quality-gate.yml`. The README now documents the actual workflow names, commands, Node versions, and separation of test, syntax, coverage, and dependency-audit checks.

### Remaining CI/release observations

- Third-party GitHub Actions in the inspected workflows are pinned to commit SHAs.
- Workflow permissions are explicitly declared; the syntax workflow requests `checks: write` for its PR-check reporter, while the other inspected workflows use read-only contents permission.
- No JavaScript lint or formatting workflow was found among the inspected workflow files. Actionlint validates workflow YAML, not application JavaScript style.
- The root package has no build or publish script in its inspected manifest. Packaging behavior and root publishability therefore need explicit confirmation before release automation is added.
- The root `ROADMAP.md` records a missing deletion restriction in the `develop` ruleset. This audit did not modify GitHub rulesets or verify their live state.

No dependencies were added or removed.

## Validation record

### Repository evidence inspected

- Root: `README.md`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, `ROADMAP.md`.
- Contributor and architecture docs: `docs/contributing.md`, `docs/workspace-package-map.md`.
- Package manifests and instructions for all six packages and the Free-Roll application.
- Public entry points for utils, entities, event-bus, notifiers, journal, brokers, and the Free-Roll app.
- Journal implementation and its native Node.js test file.
- CI workflows listed in the workflow inventory.
- Existing hardening roadmaps for utils, notifiers, and event-bus.
- Prior utils audit PRs #383 and #384, including the validation record in `packages/utils/ROADMAP.md`.

### Changes and verification

| File | Change | Verification |
|---|---|---|
| `README.md` | Corrected CI workflow description to match the checked workflow YAML | Manually cross-checked each named workflow path, displayed workflow name, command, and Node version against the corresponding workflow file |
| `docs/audits/repository-engineering-audit.md` | Added this evidence-based audit and prioritized follow-up findings | Reviewed referenced repository paths against fetched files; no Markdown linter was available through the repository connection |

### Commands not run

The repository was inspected through GitHub file operations; no local checkout or shell execution was available. Therefore the following commands were **not run** in this audit session:

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm run check:syntax`
- `pnpm run quality`
- `pnpm run test:coverage`
- Package coverage commands for utils, notifiers, and event-bus
- `pnpm audit --prod --audit-level high`
- actionlint / Markdown linting

No current CI result is claimed here. The utils roadmap records historical PR #383 evidence (including 99.12% line, 98.80% branch, and 100% function coverage); that historical result is not a substitute for CI on this audit branch.

### Commits

- README correction: `f2c9eaf8c493b38ebaaa4fab647bbd0b15b32b23`.
- Audit report commit: recorded in this branch's commit history and PR.
- Final merge commit: pending PR integration and CI.

## Remaining recommendations

| Priority | Recommendation | Owning area |
|---|---|---|
| P1 | Define and document journal schema, write/read expectations, schema evolution, replay/recovery contract; add tests for the agreed behavior | `packages/journal` |
| P2 | Confirm root package is private workspace metadata or make its declared entry point and packaging behavior real; add packaging validation if publishable | Repository infrastructure |
| P2 | Measure coverage for entities, brokers, and journal; add risk-based package thresholds and negative self-checks where they provide useful protection | Each package owner / CI |
| P2 | Complete source-level import graph scan for relative imports and internal cycles | Repository architecture |
| P2 | Add JavaScript lint/format checks only after selecting and documenting the intended ruleset; avoid duplicating syntax checks | Repository infrastructure |
| P2 | Add and verify a branch-deletion restriction to the `develop` ruleset, as already identified in the root roadmap | Repository administration |
| P3 | Verify coverage under Node.js 24 if cross-version coverage parity is required | CI |
| P3 | Add a package README for journal once its supported operational and persistence contract is defined | `packages/journal` |

## Completion status

This is an initial evidence-based audit and documentation correction, **not completion of all five audit phases or the full definition of done**. Source-level relative-import analysis, deeper review of all broker/application error paths, local command execution, current PR CI, and the journal domain's contract decisions remain open. No production code, public APIs, dependencies, or GitHub rulesets were changed.
