# ESLint Standard

**Status:** Mandatory for every JavaScript contributor, including AI agents and automated coding tools.

This document is the repository's single source of truth for understanding and complying with ESLint. The effective rules are defined in the root [eslint.config.js](../../eslint.config.js); this document explains the required contributor workflow and the protections against bypassing those rules.

## 1. Read the rules before coding

Before creating or modifying any .js, .mjs, or .cjs file, contributors MUST:

1. Read this standard and the complete root eslint.config.js.
2. Identify the rules that apply to the files being changed, including inherited @eslint/js recommended rules, repository overrides, and each rule's severity/options.
3. Understand the difference between errors and warnings. Both must be addressed for new or materially changed code; a warning is not permission to ignore a design issue.
4. Inspect the relevant package scripts and CI workflow so the exact lint command and scope are known.
5. For every added, modified, copied, or renamed JavaScript file, satisfy both the workspace policy and the stricter changed-file policy described below.
6. Design the implementation to satisfy those rules from the outset.

Do not rely on memory, a previous task's lint output, or a CI run to discover the coding standard after implementation.

## 2. No bypasses or weakening — hard prohibition

The following are prohibited in application, package, script, and test source:

- eslint-disable, eslint-disable-line, eslint-disable-next-line, eslint-enable, or equivalent inline suppression directives.
- Inline ESLint configuration comments that change rule severity or options.
- Adding, expanding, or changing file-specific exceptions to avoid a violation.
- Lowering a rule from error to warn or off, increasing thresholds to accommodate new violations, removing rules, excluding changed files, or narrowing lint scope.
- Changing package scripts, CI commands, or lint targets so that changed code is no longer checked.
- Replacing a real fix with a suppression, a baseline update, a skipped check, or an unexplained lint exception.

The root ESLint configuration sets linterOptions.noInlineConfig: true. ESLint therefore ignores source-level inline configuration: comments cannot disable a rule or change its severity. Unused disable and inline configuration directives are configured as errors as an additional guard. Do not attempt to work around this protection.

Changes to the root ESLint configuration, lint scripts, CI lint workflows, rule severity, rule options, file globs, ignores, or exceptions are policy changes. They require explicit human authorization, a clear rationale, a before/after rule-impact analysis, regression coverage where applicable, and a dedicated PR. An agent's task-level discretion does not authorize changing the standard.

## 3. Correct response to a lint violation

When code violates a rule:

1. Understand what the rule is protecting and why the code triggers it.
2. Prefer a clearer implementation: extract cohesive named functions, simplify branching, reduce nesting, clarify state transitions, or separate responsibilities.
3. Preserve behavior and public contracts; add or update tests before refactoring when behavior is affected.
4. Do not mechanically split functions into meaningless fragments merely to satisfy a numeric threshold. Preserve cohesion and explain a genuine conflict rather than suppressing the rule.
5. Re-run the relevant lint command and inspect the complete output.

For complexity, function-size, statement-count, parameter-count, and nesting rules, improve the structure and readability of the implementation. A long or complex function is not justified merely because its author describes its control flow as ordered or lifecycle-sensitive.

## 4. Required development-time verification

Lint is a development feedback loop, not a CI-only gate.

- Before editing, inspect the effective rules and applicable commands.
- While implementing, run the narrowest relevant ESLint command against each changed JavaScript file.
- After the change, run `pnpm lint:changed` for the complete contents of every selected changed file, then run the full-workspace `pnpm lint`. Both are mandatory for JavaScript changes. The workspace command continues to cover the complete repository and fails on every error and warning.
- Fix every lint error and warning before committing; unchanged legacy findings are not exempt.
- Do not wait for CI to identify predictable lint failures. CI is the independent final gate, not the first time code is linted.
- Never claim lint passed unless the command or GitHub Actions actually reports success for the exact code being described.

## 5. Review and change-control checklist

Reviewers and agents MUST verify:

- [ ] The applicable ESLint configuration and rules were read before implementation.
- [ ] New and changed code follows all applicable error-level and warning-level rules.
- [ ] No inline suppression or inline rule override was introduced.
- [ ] No rule, severity, option, threshold, file glob, ignore, script, or CI lint scope was weakened.
- [ ] Any necessary refactoring preserves behavior and has appropriate tests.
- [ ] Development-time lint was run; required CI lint passed on the exact final PR head.
- [ ] Any proposed standards change has explicit human authorization and its own rationale and impact review.

A PR that bypasses or weakens lint enforcement MUST NOT be marked ready or merged.

## 6. Canonical configuration

The root eslint.config.js is authoritative for the repository-wide JavaScript rule set. Package-specific configuration may add stricter rules only; it must not weaken root requirements. The root package.json defines the canonical commands: `pnpm lint` for full-workspace verification, `pnpm lint:changed` for strict verification of changed JavaScript files, and `pnpm lint:fix` for supported autofixes.

When this standard and a task prompt conflict, this standard prevails unless a human explicitly authorizes a standards change.

## 7. Progressive strict enforcement for changed JavaScript files

Progressive enforcement prevents new technical debt without turning the existing legacy cleanup backlog into a repository-wide migration. The workspace policy remains in force for every JavaScript file. A second, stricter policy applies to every added, modified, copied, or renamed JavaScript file in a pull request targeting `develop`.

### 7.1 Exact policy

The canonical workspace thresholds are not changed by this policy. The strict values are added on top of the canonical configuration and must not be raised or weakened.

| Rule | Workspace policy | Strict changed-file policy |
| --- | --- | --- |
| `complexity` | Error, 20 | **Error, 15** |
| `max-params` | Error, 1 | **Error, 1** |
| `max-lines-per-function` | Warning, 80 | **Error, 60** |
| `max-statements` | Warning, 50 | **Error, 30** |
| `max-depth` | Error, 4 | **Error, 3** |
| `max-nested-callbacks` | Error, 3 | **Error, 2** |

The strict runner inherits the root `eslint.config.js` using the ESLint API and overlays only these six rule values. It does not maintain a second flat configuration. All canonical plugins, parsers, language options, globals, ignores, file patterns, and unrelated rules remain active. Any warning or error from the effective configuration fails the changed-file gate.

### 7.2 Which files are subject to each policy

- **Workspace policy:** every JavaScript file ESLint processes in the repository, including untouched legacy files. The existing `pnpm lint` command and its zero-warning behavior remain unchanged.
- **Strict changed-file policy:** every added, modified, copied, or renamed `.js`, `.mjs`, or `.cjs` file in a pull request targeting `develop`. For a rename or copy, ESLint checks the destination path. A modified legacy file is not grandfathered.
- **Deleted files:** excluded; ESLint must not be asked to lint a path that no longer exists.
- **Untouched legacy files:** receive only the existing workspace policy until they are changed.

The selection is calculated from the merge base between the PR head and its target branch, not from the latest target-branch commit as a raw diff base. The runner uses Git's NUL-delimited name-status output with rename and copy detection. It therefore handles spaces, tabs, and other filename characters without line-based parsing. If the base ref, head ref, complete history, or merge base is unavailable, the command fails with an actionable error. It never silently skips the check.

### 7.3 Why the complete file is linted

ESLint rules such as complexity, function length, statement count, and nesting are evaluated at function scope. A changed line can alter the complexity or size of a function whose other lines did not change. Linting only changed lines would allow the same function to exceed a strict threshold depending on which line happened to be edited. Therefore, once a file is selected, ESLint evaluates the entire file using the strict policy.

An empty changed-file set is a successful result and prints an explicit message. A selected file that ESLint ignores, cannot parse, or cannot process is not silently omitted; its ESLint diagnostic fails the gate.

### 7.4 Local and CI commands

Run the checks locally from the repository root:

```sh
pnpm lint:changed
pnpm lint
```

By default, `pnpm lint:changed` compares committed `HEAD` changes with the merge base of `origin/develop` and `HEAD`, then also includes staged/unstaged tracked changes and nonignored untracked JavaScript files in the working tree. If you need to select different refs for a deliberate local comparison, set `LINT_CHANGED_BASE_REF` and `LINT_CHANGED_HEAD_REF` explicitly. Both refs must exist locally and have enough history to compute a merge base.

For pull requests targeting `develop`, the independent GitHub Actions job **Check strict ESLint for changed files** checks out the PR head with complete history, fetches the target branch, verifies the merge base, and runs `pnpm lint:changed`. The independent workspace-quality job continues to run `pnpm lint`. The existing required **Check JavaScript syntax** status context aggregates both jobs, so either failure blocks merging without requiring a new ruleset context. The strict job is not run for PRs targeting other branches.

### 7.5 How to satisfy each strict rule

**`complexity: 15` — independent decision paths.**

A large switch with many distinct cases creates many paths in one function:

```js
function classify(value) {
  switch (value) {
    case "a": return "A";
    case "b": return "B";
    // many more independent cases ...
    default: return "unknown";
  }
}
```

Keep the dispatch function small and move cohesive case handling into a named lookup or focused helper. Do not hide branches in opaque boolean expressions.

**`max-params: 1` — function inputs.**

Avoid positional parameter lists:

```js
function createOrder(symbol, quantity, price) { /* ... */ }
```

Use one options object when the values form one input contract:

```js
function createOrder({ symbol, quantity, price }) { /* ... */ }
```

The one-parameter limit is already part of the workspace policy and remains unchanged.

**`max-lines-per-function: 60` — counted function lines.**

The strict rule excludes blank lines and comments through the configured `skipBlankLines` and `skipComments` options. A function with 61 counted lines violates the rule; 60 is the maximum. Extract cohesive calculations, validation, or formatting into named pure helpers; do not split a function into arbitrary fragments solely to hit the number.

**`max-statements: 30` — statements in a function.**

A function containing 31 statements violates the rule; 30 is the maximum. Separate distinct phases into small functions with clear inputs and return values. Keep orchestration readable and preserve ordering where lifecycle or transaction semantics require it.

**`max-depth: 3` — nested control-flow blocks, not cyclomatic complexity.**

`max-depth` measures how deeply control-flow blocks are nested. It does **not** measure cyclomatic complexity or count independent decision paths. Three nested `if` blocks pass:

```js
function matches({ first, second, third }) {
  if (first) {
    if (second) {
      if (third) {
        return true;
      }
    }
  }
  return false;
}
```

Adding a fourth nested block violates the strict policy:

```js
function matches({ first, second, third, fourth }) {
  if (first) {
    if (second) {
      if (third) {
        if (fourth) {
          return true;
        }
      }
    }
  }
  return false;
}
```

Prefer guard clauses and early returns to remove unnecessary nesting. A function can have low cyclomatic complexity and still violate `max-depth`, or have many independent paths without deep nesting.

**`max-nested-callbacks: 2` — callbacks nested inside callbacks.**

Three nested callbacks violate the strict limit:

```js
firstOperation(() => {
  secondOperation(() => {
    thirdOperation(() => finish());
  });
});
```

Extract a named callback or use a straightforward `async` helper / `for...of` loop when sequential work is intended. This makes ownership and error handling easier to follow.

### 7.6 Migrating legacy files

This is a touch-driven migration, not a mechanical repository-wide refactor:

1. An untouched legacy file remains under the workspace policy.
2. When a contributor adds, modifies, copies, or renames that file, the entire destination file must meet the strict thresholds in the same PR.
3. Refactor only the functions needed to satisfy the strict gate, preserving behavior and adding focused tests where behavior changes.
4. Prefer guard clauses, extracted pure helpers, cohesive options objects, and clear orchestration.
5. Never raise thresholds, add ESLint disable comments, exclude the file, lint only changed lines, or create blanket suppressions.

The repository-wide audit in `scripts/eslint-policy.test.js` measures the approved thresholds against the current source tree and reports affected functions, files, package concentration, and representative paths. Re-run that audit when evaluating migration effort; do not copy old counts into a new decision.

### 7.7 Current `develop` baseline audit

The reproducible audit was executed against the source baseline at `develop` SHA `abaf922daf9ceb72607b87035f7bdba8683be4a7`. The audit ran on the task branch after adding the runner, tests, and policy documentation; all added/modified JavaScript files passed the strict gate, so these violations are the untouched legacy baseline. Counts are produced by the repository-wide ESLint diagnostics in `scripts/eslint-policy.test.js`, not manually maintained.

| Strict threshold | Affected functions | Affected files | Largest package concentrations |
| --- | ---: | ---: | --- |
| `complexity: 15` | 146 | 91 | `apps/harvester`: 112; `packages/brokers`: 16; repository tooling: 8 |
| `max-params: 1` | 0 | 0 | None |
| `max-lines-per-function: 60` | 338 | 164 | `apps/harvester`: 269; `packages/brokers`: 25; `packages/entities`: 14 |
| `max-statements: 30` | 34 | 27 | `apps/harvester`: 15; `packages/brokers`: 8; repository tooling: 8 |
| `max-depth: 3` | 17 | 11 | `apps/harvester`: 10; `packages/brokers`: 4 |
| `max-nested-callbacks: 2` | 246 | 50 | `packages/entities`: 113; `packages/utils`: 66; `packages/brokers`: 44 |

The largest migration burden is not the unchanged one-parameter rule: it is callback nesting (246 functions across 50 files), followed by function length (338 functions across 164 files) and complexity (146 functions across 91 files). Callback nesting is concentrated in shared packages such as `packages/entities`, `packages/utils`, and `packages/brokers`; complexity and function length are concentrated in `apps/harvester`.

Representative findings from the audit:

- Complexity: `apps/harvester/scripts/audit-testnet-account.js:138`, `apps/harvester/scripts/calibrate-volatility-thresholds.js:124`, and `apps/harvester/src/bootstrap/shutdown/create-shutdown-handler.js:17` (complexity 20).
- Function length: `apps/harvester/src/domain/portfolio/portfolio.js:202`, `apps/harvester/src/infrastructure/brokers/bitunix-market-metadata.js:98`, and `apps/harvester/src/infrastructure/telegram/operator/handlers.js:8` (80 counted lines).
- Statements: `apps/harvester/src/bootstrap/shutdown/create-shutdown-handler.js:584` (43), `packages/utils/src/format-log-content.js:47` (42), and `packages/brokers/src/infrastructure/binance/broker-websocket/tests/user-data-session.recovery.test.js:101` (40).
- Depth: `apps/harvester/scripts/config-symbol/write-token-specification.js:108`, `apps/harvester/src/application/events/publish-lifecycle-event.js:19`, and `apps/harvester/src/infrastructure/process-lock/acquire-harvester-process-lock.js:119` (depth 4).
- Nested callbacks: `apps/harvester/scripts/eslint.test.js:53`, `packages/brokers/src/application/user-data-session.test.js:106`, and `packages/entities` tests are representative of the three-level callback pattern.

This is a significant migration burden, particularly for `max-nested-callbacks: 2` and `max-lines-per-function: 60`. It validates the approved progressive strategy: do not refactor hundreds of legacy functions in one campaign. Each file must meet all strict thresholds when it is next modified.

## 8. Evidence-based repository rule decisions

The following decisions were reviewed against the full workspace on 2026-11-17. The root configuration and `scripts/eslint-policy.test.js` are authoritative for enforcement.

- **`no-console` is an error.** Use the owning package's shared logger for application diagnostics. Explicit `process.stdout.write()` and `process.stderr.write()` remain available at intentional CLI boundaries; this is not permission to use direct `console.*` calls.
- **`no-implicit-coercion` is an error.** Make conversions explicit at input/API boundaries. Explicit conversion does not make binary floating-point safe for financial values: preserve exact decimal strings and use the repository's decimal utilities for trading/accounting amounts.
- **`complexity` remains an error with `max: 20`.** The earlier PR #1311 audit recorded 247 findings across 89 files. A fresh audit of `develop` HEAD `0b90c96863374a1961d78c768f20e9b9b318a35a` found 146 functions across 91 files at `max: 15`. Lowering to 15 would still create broad refactoring pressure across lifecycle, domain, and infrastructure code. Re-evaluate after meaningful baseline reduction; do not mechanically extract helpers to satisfy an arbitrary number.
- **`max-lines-per-function` remains a warning at 80 lines.** Candidate limits of 60 and 50 would affect 337 functions across 164 files and 641 functions across 238 files respectively. Keep 80; warnings fail the canonical zero-warning lint command.
- **`max-statements` remains a warning at 50.** Candidate limits of 30, 25, 20, and 15 would affect 34 functions across 27 files, 87 across 63 files, 224 across 123 files, and 588 across 223 files respectively. The 30-statement candidates include shutdown lifecycle orchestration, log normalization, broker lifecycle handling, and integration tests. Even the 30 limit spans 27 files; do not create a broad refactoring campaign for a numeric threshold alone. Keep 50 and extract responsibilities when there is a concrete design benefit.
- **`max-depth` is an error at 4.** The audit found 17 functions across 11 files at depth 4, but zero functions deeper than 4. A limit of 3 would require broad changes without a corresponding readability benefit; the depth-4 guardrail prevents deeper nesting without requiring baseline refactoring.
- **Existing strict rules remain unchanged:** `max-params: 1`, `max-nested-callbacks: 3`, `no-param-reassign`, `no-nested-ternary`, `consistent-return`, and `no-else-return` remain error-level policies. Regression tests exercise parameter, callback, size-warning, and depth behavior.
- **No file-specific function-length exceptions remain in the current root configuration.** The Telegram operator adapter has been decomposed into smaller modules on `develop`; its current adapter file uses the root 80-line policy.
- **Additional-rule decisions:** `default-param-last` adds no value alongside `max-params: 1`, and the current audit found zero violations. Do not add `max-len` as a function-quality rule: it governs visual line length rather than function responsibility. Do not add the deprecated core `no-return-await` rule; [ESLint explicitly recommends against using it](https://eslint.org/docs/latest/rules/no-return-await) because `return await` no longer adds an extra microtask and preserves useful stack traces.
- **Audit scope:** the measurement inspected all 761 workspace JavaScript files and excluded only `scripts/eslint-policy.test.js` (the audit harness itself) from candidate counts to avoid self-inclusion. The full strict lint command still checks that file and the entire workspace.

- **`require-atomic-updates` is deliberately not enabled.** The full-workspace evaluation produced 47 candidates across 21 files. Several are protected by explicit serial queues or shared in-flight lifecycle promises that the rule cannot understand; other state transitions need targeted concurrency review. Follow-up issue [#1313](https://github.com/45s/coinzilla/issues/1313) tracks classification and fixes for confirmed races. Do not enable the rule with blanket property exemptions or suppressions as a shortcut.

The canonical strict command remains `pnpm lint` (`eslint . --max-warnings 0`). These decisions do not add ignores, inline disables, or exceptions.
