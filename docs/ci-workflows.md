# GitHub Actions Workflows

This page summarizes the workflows in `.github/workflows/` and what each one verifies. Workflow definitions and the live GitHub ruleset remain the sources of truth; update this page when their triggers, jobs, or required status contexts change.

## Workflow overview

| Workflow file | Triggers | Purpose and principal checks | Ruleset requirement (`main` + `develop`) |
| --- | --- | --- | --- |
| `quality-gate.yml` (**JavaScript Syntax**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs `actionlint`, JavaScript syntax, agent-policy/domain-ownership checks, the report-only Markdown formatting baseline, changed-file Markdown style enforcement, and mocked external-link checker unit tests. The agent-policy command also prints the report-only heading-anchor baseline. | `actionlint` and `Check JavaScript syntax` are separate required contexts in both active rulesets. |
| `unit-tests.yml` (**Unit Tests**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the workspace package-test matrix offline. Manual `develop` dispatch can explicitly opt into read-only Binance TESTNET integration. | `Run package tests` in both active rulesets. |
| `test-coverage.yml` (**Test Coverage**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the workspace test-coverage matrix and writes the coverage command output to the Actions step summary. | `Workspace test coverage` in both active rulesets. |
| `utils-unit-tests.yml` (**Utils Unit Tests**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the focused Utils package test command (`node --test packages/utils`). | `packages/utils tests` in both active rulesets. |
| `dependency-audit.yml` (**Dependency Audit**) | Pull requests; pushes to `main`/`develop`; manual dispatch; weekly schedule | Audits production dependencies with the high-severity threshold. | `Audit production dependencies` in both active rulesets. |
| `harvester-targeted-tests.yml` (**Harvester Targeted Tests**) | Pull requests; manual dispatch | Runs `pnpm --filter @coinzilla/harvester test:targeted`. | Additional PR workflow; not required by either active ruleset. |
| `harvester-process-lock.yml` (**Harvester Process Lock**) | Path-filtered pull requests/pushes; manual dispatch | Runs the process-lock regression test on Ubuntu and Windows when process-lock code, Harvester entrypoint, or this workflow changes. | Additional path-filtered workflow; not required by either active ruleset. |
| `external-links.yml` (**External Documentation Links**) | Pull requests to `develop` changing Markdown/MDX or checker sources; weekly schedule; manual dispatch | Checks changed maintained Markdown/MDX; weekly/manual full-tree scans include historical docs and are report-only. DNS answers are validated and connections pinned before requests; redirects are independently revalidated. | Additional advisory workflow; not one of the six `develop-core` required contexts. |

## Required status contexts on `develop`

As verified against the active repository ruleset `develop-core` on 2026-11-10, strict required-status freshness is enabled and the ruleset requires exactly these six contexts:

1. `Run package tests`
2. `Workspace test coverage`
3. `Check JavaScript syntax`
4. `packages/utils tests`
5. `Audit production dependencies`
6. `actionlint`

The two Harvester workflows and External Documentation Links run as additional checks but are not required contexts in this ruleset. A workflow trigger starting a run does not, by itself, make that check a merge requirement. Re-read the live ruleset before changing workflow names, job names, or required contexts; never infer required contexts from workflow names.

The Unit Tests and Test Coverage package matrices explicitly list workspace packages. When adding a package, update both matrices in the same PR; the Indicators package is included in both. Indicators coverage runs the package's 90% line / 85% branch threshold script.

## Markdown and documentation checks

The required JavaScript Syntax workflow runs these documentation checks:

- `check-agent-policy.js` enforces ownership maps, required roadmaps and entry points, balanced Markdown fences, and relative local-path existence for inline links and reference definitions. Code examples and HTML comments are excluded; malformed percent-encoded paths are reported as controlled findings. It also prints unresolved local heading-anchor findings using GitHub-style slugs for inline links and reference definitions; **heading-anchor findings are report-only and do not fail the check**.
- `markdown-style-baseline.js` reports full-tree formatting/heading/fence metrics without failing on existing findings or rewriting files.
- On pull requests, `check-markdown-style.js` enforces the changed-line/file-level Markdown style rules against the exact PR base SHA. This is a blocking check within `Check JavaScript syntax`, not a separate status context.
- `check-external-links.test.js` exercises the external URL checker with mocked fetch responses. These tests run in required CI but make no network requests.

The networked **External Documentation Links** workflow is an advisory check for changed maintained Markdown/MDX on pull requests to `develop`; weekly and manual runs report on the full `develop` tree. It resolves and validates every A/AAAA answer, pins each HTTP(S) connection to vetted addresses, and revalidates redirects. It sends no credentials and is not one of the six required contexts. The CLI and workflow follow the [documented reliability policy](MARKDOWN_STYLE.md); required CI remains network-free.

## Triggers and optional broker validation

- **JavaScript Syntax**, **Unit Tests**, **Utils Unit Tests**, and **Test Coverage** run for pull requests, pushes to `main`/`develop`, and manual dispatch.
- **Dependency Audit** has the same triggers plus a weekly scheduled run on Monday at 07:23 UTC.
- **Harvester Targeted Tests** runs for pull requests and manual dispatch.
- **Harvester Process Lock** runs for matching path changes on pull requests/pushes to `main`/`develop`, plus manual dispatch.
- **External Documentation Links** runs on matching Markdown/MDX or checker-source pull requests targeting `develop`; it also runs a full-tree report-only scan every Monday at 08:00 UTC and on manual dispatch.

The `unit-tests.yml` workflow exposes an opt-in `run_broker_testnet_read_only` dispatch input on `develop`. The TESTNET job uses repository secrets only in its final integration step; checkout, tool setup, and dependency installation do not receive exchange credentials. It rejects missing or case-insensitive placeholder credentials before running the read-only broker integration suite. Order mutations and externally triggered user-data event waiting are fixed to `0`; the job does not upload integration artifacts.

Pull-request package tests do not contact Binance or any exchange endpoint. The only Binance TESTNET connection in this workflow is the explicitly dispatched `broker-testnet-read-only` job on `develop`; it requires the opt-in input and valid TESTNET credentials, and its order-mutation/user-data-waiting settings remain fixed to `0`. Do not dispatch it unless the task has explicit TESTNET authorization.

## Active repository rulesets

Live GitHub rulesets were verified on 2026-11-10:

| Ruleset | Target branch | Required status contexts |
| --- | --- | --- |
| `core` | `main` | `Run package tests`, `Workspace test coverage`, `Check JavaScript syntax`, `packages/utils tests`, `Audit production dependencies`, `actionlint` |
| `develop-core` | `develop` | The same six contexts. |

Both rulesets are active, require status checks to be up to date with the target branch, and require review threads to be resolved. Neither currently requires an approving review count. Both disallow non-fast-forward updates and branch deletion.

**External Documentation Links is deliberately not a required context.** It performs DNS-pinned network requests against changed maintained Markdown/MDX and scheduled/manual full-tree scans. Required CI remains network-free; an advisory network failure must not be treated as a branch-protection bypass or a reason to weaken the six required contexts.

## Local equivalents

Run these commands from the repository root with the Node.js and pnpm versions specified in the root `package.json`:

```sh
# Workspace package tests
pnpm test

# Local aggregate: workspace tests, syntax, agent-policy, and mocked external-link tests
# (does not run the full-tree formatting report, PR changed-file style gate, or live URL checks)
pnpm run quality

# Report-only full-tree Markdown formatting baseline
node --test scripts/markdown-style-baseline.test.js
node scripts/markdown-style-baseline.js

# Agent policy (includes the report-only heading-anchor scan)
pnpm run check:agent-policy

# Offline external-link checker unit tests (mocked responses; no network)
pnpm run test:external-links

# Manual/local full-tree external URL report (network requests; report-only)
pnpm run check:external-links

# Changed-file Markdown style; use the exact 40-character PR base SHA
BASE_SHA="replace-with-exact-pr-base-sha"
node --test scripts/check-markdown-style.test.js
node scripts/check-markdown-style.js "$BASE_SHA"

# Focused Utils tests
pnpm --filter @coinzilla/utils test

# Workspace test coverage
pnpm run test:coverage

# Production dependency audit
pnpm audit --prod --audit-level high

# Harvester targeted and process-lock tests
pnpm --filter @coinzilla/harvester test:targeted
pnpm --filter @coinzilla/harvester exec node --test src/infrastructure/process-lock/acquire-harvester-process-lock.test.js
```

The package test commands and pull-request workflow remain deterministic, credential-free, and offline. The read-only TESTNET integration is opt-in through manual `workflow_dispatch` and must only be used when separately authorized.

## Failure triage

1. Open the failed run in the repository's **Actions** tab and select the failed job.
2. Read the first failing command and its output before changing code or workflow configuration.
3. Reproduce the relevant command locally when possible.
4. Fix the underlying issue rather than skipping, weakening, or masking the check.
5. Re-run the relevant tests and checks, then confirm the pull request's checks have completed successfully.

The coverage workflow writes its command output to the GitHub Actions step summary to make the report easier to inspect. A failed coverage command still fails the job.
