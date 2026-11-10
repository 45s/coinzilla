# GitHub Actions Workflows

This page summarizes the workflows in `.github/workflows/` and what each one verifies. Workflow definitions and the live GitHub ruleset remain the sources of truth; update this page when their triggers, jobs, or required status contexts change.

## Workflow overview

| Workflow file | Triggers | Purpose and principal checks | `develop-core` requirement |
| --- | --- | --- | --- |
| `quality-gate.yml` (**JavaScript Syntax**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs `actionlint`, JavaScript syntax, agent-policy/domain-ownership checks, the report-only Markdown formatting baseline, changed-file Markdown style enforcement, and mocked external-link checker unit tests. The agent-policy command also prints the report-only heading-anchor baseline. | `actionlint` and `Check JavaScript syntax` are separate required contexts. |
| `unit-tests.yml` (**Unit Tests**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the workspace package-test matrix. Pull requests also run a credential-free Brokers endpoint diagnostic; manual `develop` dispatch can opt into read-only Binance TESTNET integration. | `Run package tests`. |
| `test-coverage.yml` (**Test Coverage**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the workspace test-coverage matrix and writes the coverage command output to the Actions step summary. | `Workspace test coverage`. |
| `utils-unit-tests.yml` (**Utils Unit Tests**) | Pull requests; pushes to `main`/`develop`; manual dispatch | Runs the focused Utils package test command (`node --test packages/utils`). | `packages/utils tests`. |
| `dependency-audit.yml` (**Dependency Audit**) | Pull requests; pushes to `main`/`develop`; manual dispatch; weekly schedule | Audits production dependencies with the high-severity threshold. | `Audit production dependencies`. |
| `harvester-targeted-tests.yml` (**Harvester Targeted Tests**) | Pull requests; manual dispatch | Runs `pnpm --filter @coinzilla/harvester test:targeted`. | Additional PR workflow; not one of the six `develop-core` required contexts. |
| `harvester-process-lock.yml` (**Harvester Process Lock**) | Path-filtered pull requests/pushes; manual dispatch | Runs the process-lock regression test on Ubuntu and Windows when process-lock code, Harvester entrypoint, or this workflow changes. | Additional path-filtered workflow; not one of the six `develop-core` required contexts. |
| `external-links.yml` (**External Documentation Links**) | Manual dispatch only; job intentionally skipped | Disabled placeholder retained for the future advisory checker. No network requests run until DNS pinning/private-address protection is complete in issue #901. | Disabled; not a required context. |

## Required status contexts on `develop`

As verified against the active repository ruleset `develop-core` on 2026-11-10, strict required-status freshness is enabled and the ruleset requires exactly these six contexts:

1. `Run package tests`
2. `Workspace test coverage`
3. `Check JavaScript syntax`
4. `packages/utils tests`
5. `Audit production dependencies`
6. `actionlint`

The two Harvester workflows run as additional checks but are not required contexts in this ruleset. External Documentation Links is currently disabled and is not a required context. A workflow trigger starting a run does not, by itself, make that check a merge requirement. Re-read the live ruleset before changing workflow names, job names, or required contexts; never infer required contexts from workflow names.

## Markdown and documentation checks

The required JavaScript Syntax workflow runs these documentation checks:

- `check-agent-policy.js` enforces ownership maps, required roadmaps and entry points, balanced Markdown fences, and relative local-path existence for inline links and reference definitions. Code examples and HTML comments are excluded; malformed percent-encoded paths are reported as controlled findings. It also prints unresolved local heading-anchor findings using GitHub-style slugs for inline links and reference definitions; **heading-anchor findings are report-only and do not fail the check**.
- `markdown-style-baseline.js` reports full-tree formatting/heading/fence metrics without failing on existing findings or rewriting files.
- On pull requests, `check-markdown-style.js` enforces the changed-line/file-level Markdown style rules against the exact PR base SHA. This is a blocking check within `Check JavaScript syntax`, not a separate status context.
- `check-external-links.test.js` exercises the external URL checker with mocked fetch responses. These tests run in required CI but make no network requests.

The networked **External Documentation Links** workflow is disabled until issue #901 provides DNS answer validation and connection pinning. The CLI remains available for trusted local use only; do not run it against untrusted PR content. Any future advisory workflow will be non-required and must follow the [documented reliability policy](MARKDOWN_STYLE.md).

## Triggers and optional broker validation

- **JavaScript Syntax**, **Unit Tests**, **Utils Unit Tests**, and **Test Coverage** run for pull requests, pushes to `main`/`develop`, and manual dispatch.
- **Dependency Audit** has the same triggers plus a weekly scheduled run on Monday at 07:23 UTC.
- **Harvester Targeted Tests** runs for pull requests and manual dispatch.
- **Harvester Process Lock** runs for matching path changes on pull requests/pushes to `main`/`develop`, plus manual dispatch.
- **External Documentation Links** is manual-dispatch-only with its job intentionally skipped until issue #901 is complete; it currently makes no network requests.

The `unit-tests.yml` workflow exposes an opt-in `run_broker_testnet_read_only` dispatch input on `develop`. The TESTNET job uses repository secrets only in its final integration step; checkout, tool setup, and dependency installation do not receive exchange credentials. It rejects missing or case-insensitive placeholder credentials before running the read-only broker integration suite. Order mutations and externally triggered user-data event waiting are fixed to `0`; the job does not upload integration artifacts.

The Brokers pull-request endpoint probe is a separate credential-free diagnostic and is configured not to fail the package-test job. It is not the read-only TESTNET integration. Ordinary package tests remain offline and credential-free.

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

# Manual/local full-tree external URL report (network requests; report-only; trusted content only until #901)
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

The package test commands should remain deterministic and must not require credentials, local environment files, or live exchange access. The PR-only Brokers endpoint probe is a separate network diagnostic; the read-only TESTNET integration is opt-in and TESTNET-only.

## Failure triage

1. Open the failed run in the repository's **Actions** tab and select the failed job.
2. Read the first failing command and its output before changing code or workflow configuration.
3. Reproduce the relevant command locally when possible.
4. Fix the underlying issue rather than skipping, weakening, or masking the check.
5. Re-run the relevant tests and checks, then confirm the pull request's checks have completed successfully.

The coverage workflow writes its command output to the GitHub Actions step summary to make the report easier to inspect. A failed coverage command still fails the job.
