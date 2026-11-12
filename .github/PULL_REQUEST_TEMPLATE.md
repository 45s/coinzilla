<!--
PR title format (required):
  <type>(<app-or-package>): <specific change and outcome>

Use feat for new behavior, fix for bug/safety corrections, and docs for documentation-only changes.
Scope is the owning app/package directory (for example, harvester, brokers, utils); use repo only
for genuinely repository-wide work. Start with an action verb and describe the actual functionality.
Avoid vague phase labels ("begin Step 8", "build foundation") and issue-number-only titles.
Examples:
  feat(harvester): add transport-independent operator pause controls
  fix(harvester): preserve reasons when order submission is deferred
  docs(harvester): explain volatility protection thresholds with examples
-->

## Summary

<!-- What changed and why? -->

## Roadmap and invariants

- **Roadmap ID(s):** <!-- e.g. FR-017; use N/A only when no roadmap item applies, and explain why. -->
- **Invariant(s) protected:** <!-- State the concrete correctness/safety invariant(s), or explain why none apply. -->

## Verification

- [ ] Added or updated tests for behavior changes and relevant edge cases, or explained why tests are not applicable.
- [ ] Ran the relevant package tests.
- [ ] Ran applicable workspace/repository checks when feasible.
- **Commands and results:** <!-- List exact commands and pass/fail/not-run status. -->
- **CI:** <!-- Link checks and identify the exact PR head SHA they validated; list each required context as passed/failed/pending/skipped. Never infer success from a workflow being present. -->
- **Not run / blocked:** <!-- Name every relevant check not executed and why. -->
- [ ] Reviewed naming, side effects, mutation, duplication, cohesion, and complexity against [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md).
- [ ] No secrets, credentials, unrelated changes, or weakened tests are included.
- [ ] Documentation impact is assessed and recorded below; update affected living docs and indexes in this PR, or explain why no update is warranted.
- [ ] Historical evidence and provenance are preserved; no superseded/archived document is left without a successor/disposition.

## Documentation impact

- **Updated documentation/indexes:** <!-- List paths, or N/A with reason. -->
- **Canonical source of truth:** <!-- Identify the authoritative document(s) affected. -->
- **Historical evidence / migration:** <!-- State how evidence, links and provenance are preserved, or N/A. -->

## Completion report

- **Implementation:** <!-- Concise summary and affected files. -->
- **Risks / known limitations:** <!-- Include any remaining work or "None". -->
- **Final source commit:** <!-- Exact SHA validated by CI. -->

## Design notes

<!-- Mention important trade-offs, architectural decisions, or deviations from the standards. Use "None" if not applicable. -->

## Risks / follow-up

<!-- Known limitations, migration risks, or follow-up work. Use "None" if not applicable. -->


## Workflow and ownership

- [ ] I read `AI_AGENT_WORKFLOW.md` and the owning domain's `AGENTS.md`.
- [ ] This PR changes only the owning domain, or explicitly coordinates every affected domain.
- [ ] **Target is correct:** task PR = `<task-branch> → develop`; final release PR = `develop → main`. No task PR may target `main`.
- [ ] The PR branch contains the latest target branch and CI passed on the exact head SHA.
- [ ] Relevant domain roadmap and documentation are updated.
- [ ] Any cross-domain request or dependency is linked below.

**Domain:**

**Roadmap item / issue:**

**Cross-domain dependencies:**
