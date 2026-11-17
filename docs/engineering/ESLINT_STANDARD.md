# ESLint Standard

**Status:** Mandatory for every JavaScript contributor, including AI agents and automated coding tools.

This document is the repository's single source of truth for understanding and complying with ESLint. The effective rules are defined in the root [eslint.config.js](../../eslint.config.js); this document explains the required contributor workflow and the protections against bypassing those rules.

## 1. Read the rules before coding

Before creating or modifying any .js, .mjs, or .cjs file, contributors MUST:

1. Read this standard and the complete root eslint.config.js.
2. Identify the rules that apply to the files being changed, including inherited @eslint/js recommended rules, repository overrides, and each rule's severity/options.
3. Understand the difference between errors and warnings. Both must be addressed for new or materially changed code; a warning is not permission to ignore a design issue.
4. Inspect the relevant package scripts and CI workflow so the exact lint command and scope are known.
5. Design the implementation to satisfy those rules from the outset.

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
- After the change, run the full-workspace `pnpm lint` command. It is mandatory for every JavaScript change and fails on every error and warning.
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

The root eslint.config.js is authoritative for the repository-wide JavaScript rule set. Package-specific configuration may add stricter rules only; it must not weaken root requirements. The root package.json defines the canonical commands: `pnpm lint` for strict full-workspace verification and `pnpm lint:fix` for supported autofixes.

When this standard and a task prompt conflict, this standard prevails unless a human explicitly authorizes a standards change.

## 7. Evidence-based repository rule decisions

The following decisions were reviewed against the full workspace on 2026-11-17. The root configuration and `scripts/eslint-policy.test.js` are authoritative for enforcement.

- **`no-console` is an error.** Use the owning package's shared logger for application diagnostics. Explicit `process.stdout.write()` and `process.stderr.write()` remain available at intentional CLI boundaries; this is not permission to use direct `console.*` calls.
- **`no-implicit-coercion` is an error.** Make conversions explicit at input/API boundaries. Explicit conversion does not make binary floating-point safe for financial values: preserve exact decimal strings and use the repository's decimal utilities for trading/accounting amounts.
- **`complexity` remains an error with `max: 20`.** A full-workspace evaluation of `max: 15` produced 247 findings across 89 files (68 in Harvester). Lowering the threshold now would create broad refactoring pressure across lifecycle and domain code. Re-evaluate after meaningful baseline reduction; do not mechanically extract helpers to satisfy an arbitrary number.
- **`require-atomic-updates` is deliberately not enabled.** The full-workspace evaluation produced 47 candidates across 21 files. Several are protected by explicit serial queues or shared in-flight lifecycle promises that the rule cannot understand; other state transitions need targeted concurrency review. Follow-up issue [#1313](https://github.com/45s/coinzilla/issues/1313) tracks classification and fixes for confirmed races. Do not enable the rule with blanket property exemptions or suppressions as a shortcut.

The canonical strict command remains `pnpm lint` (`eslint . --max-warnings 0`). These decisions do not add ignores, inline disables, or exceptions.
