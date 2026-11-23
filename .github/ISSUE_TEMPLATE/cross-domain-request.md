---
name: Cross-domain request
about: Request a bug fix, capability, or contract change from another Coinzilla domain
title: "[domain-request] "
labels: []
---

## Mandatory AI-agent preflight — read before investigating or changing state

Every AI agent or automated contributor must independently complete the repository's mandatory task-start gate before implementation or any state-changing action. Read these documents in full, follow applicable links recursively, and record the readiness summary in the issue:

1. [Root agent instructions](../../AGENTS.md).
2. [AI Task Compliance Standard](../../docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md).
3. [Applicable Task Workflows checklist](../../docs/engineering/TASK_WORKFLOWS.md).
4. [Engineering Standards](../../ENGINEERING_STANDARDS.md).
5. [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md).
6. [Cross-domain request policy](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).
7. [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md) and [Markdown Style](../../docs/MARKDOWN_STYLE.md) when documentation is affected.
8. The owning domain's and consumer domain's applicable `AGENTS.md`, `ROADMAP.md`, specifications, contracts, runbooks, tests and linked standards.

Do not begin implementation, edits, configuration changes, PR creation or other state-changing work until the preflight is complete. If required material is inaccessible or contradictory, stop and report the exact blocker. This issue template does not waive repository policy.

---

## Request type
Bug / Capability / Contract change

## Owning domain
Package/path:

## Consumer and use case
What are we trying to achieve, and why?

## Current behavior
What happens today? Include a minimal reproduction, failing test, logs, or other evidence.

## Expected behavior / contract
Describe observable behavior and expected inputs/outputs, not an assumed internal implementation.

## Acceptance criteria

- [ ]

## Consumer impact
Which application/package/task is blocked or affected?

## Compatibility and safety
Known breaking changes, failure behavior, invariants, and migration needs.

## Links
Related roadmap item, issue, PR, and tests.
