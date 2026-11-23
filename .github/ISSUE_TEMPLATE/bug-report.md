---
name: Bug report
about: Report a reproducible defect with evidence and verifiable acceptance criteria
title: "[bug] "
labels: []
---

## Mandatory AI-agent preflight — read before investigating or changing state

Every AI agent or automated contributor must independently complete the repository's mandatory task-start gate before implementation or any state-changing action. Read these documents in full, follow applicable links recursively, and record the readiness summary in the issue:

1. [Root agent instructions](../../AGENTS.md).
2. [AI Task Compliance Standard](../../docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md).
3. [Applicable Task Workflows checklist](../../docs/engineering/TASK_WORKFLOWS.md).
4. [Engineering Standards](../../ENGINEERING_STANDARDS.md).
5. [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md).
6. [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md) and [Markdown Style](../../docs/MARKDOWN_STYLE.md) when documentation is affected.
7. The owning domain's `AGENTS.md`, `ROADMAP.md`, specifications, contracts, runbooks, tests and linked standards that apply to this bug.

Do not begin implementation, edits, configuration changes, PR creation or other state-changing work until the preflight is complete. If required material is inaccessible or contradictory, stop and report the exact blocker. This issue template does not waive repository policy.

## Problem

What is broken? Describe the actual behavior and provide a minimal reproduction or evidence.

## Expected behavior

What should happen instead? Describe the observable contract, not an assumed implementation.

## Impact and severity

Who or what is affected? What is blocked, degraded or at risk? Include severity and scope.

## Investigation

Record confirmed findings, relevant source paths/line references, logs, failing tests and reproduction steps. Distinguish confirmed facts from hypotheses.

## Proposed approach

List viable approaches and the preferred direction, if known. Explain important trade-offs; do not prescribe an implementation before investigation supports it.

## Acceptance criteria

- [ ] Observable outcome:
- [ ] Regression test reproduces the original defect and passes after the fix.
- [ ] Relevant failure and boundary cases are covered.
- [ ] No existing behavior or invariant regresses.

## Dependencies

Related issues, PRs, packages/domains, external constraints and prerequisites.

## Verification

List exact tests, commands and CI checks required. Record actual results and the exact commit SHA they validate; distinguish not run, blocked, failed and passed.

## Resolution

Complete when resolved: summarize the actual fix, link the implementation commit/PR, regression coverage and exact verification evidence. Do not fill this section with a proposed fix before implementation.
