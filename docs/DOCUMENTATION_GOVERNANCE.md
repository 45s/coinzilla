# Documentation governance

- Status: Accepted
- Type: Repository policy
- Owner: Repository engineering
- Effective: 2026-11-09
- Canonical policy: This document
- Enforcement: Root and domain agent instructions, pull-request review, and CI checks described below

## 1. Vision and outcomes

Coinzilla documentation is part of the maintained product, not an attachment to source code and not a collection of notes.

The documentation system must let a contributor or AI agent answer, without relying on chat history or undocumented memory:

1. Where is the authoritative information for this subject?
2. Who owns it?
3. Is it current guidance, a decision record, a plan, or historical evidence?
4. What implementation, issue, test, or evidence supports it?
5. What must change when the underlying behavior changes?

The goals are discoverability, one source of truth per subject, traceable decisions, preserved evidence, low maintenance overhead, and enforceable AI-agent behavior.

## 2. Canonical locations and ownership

Use a hybrid structure. Do not force every document into the repository-root `/docs`.

| Scope | Canonical location | Responsibility |
| --- | --- | --- |
| Repository-wide contributor and engineering policy | Root policy files and `/docs/engineering/` | Applies across apps and packages |
| Cross-workspace architecture and decisions | `/docs/architecture/` | Shared architecture principles and repository-level ADRs |
| Application-specific guidance | `apps/<app>/README.md`, `AGENTS.md`, `ROADMAP.md`, and `docs/` | Application behavior, architecture, operations, evidence |
| Package-specific guidance | `packages/<package>/README.md`, `AGENTS.md`, `ROADMAP.md`, and local `docs/` when justified | Package contract and implementation |
| Task status and discussion | GitHub Issues and Pull Requests | Live task state, ownership, discussion, review and delivery |
| Executable truth | Source code, tests, schemas and configuration | Actual implemented behavior |

The nearest owning application/package owns its domain documentation. Repository-wide policy is owned centrally. Local documents may add domain constraints but must link to, and must not redefine, repository-wide policy.

A root README and each application/package README are entry points, not encyclopedias. Every substantial documentation area must have a local `README.md` index.

## 3. Documentation categories

Classify documents by purpose. Keep categories distinct even if they share a directory.

### Living documentation

Maintained to describe current behavior or current instructions:

- Getting started and contributor guides
- Architecture and domain specifications
- API, event, configuration and integration contracts
- Operational runbooks and troubleshooting
- Testing guidance
- Current roadmaps and plans

When implementation changes, update the affected living documentation in the same task/PR.

### Decision records

ADRs preserve the context and rationale for a decision. They are append-only in meaning: do not rewrite history to pretend a different decision was made. If a decision changes, create a superseding ADR and link both records.

### Historical records

Audits, investigations, incident reports, session reports, evidence snapshots and execution histories record what was observed at a particular time. Preserve original conclusions, source commit, evidence provenance, limitations and uncertainty. Add a dated follow-up or superseding assessment instead of silently rewriting historical facts.

### Plans and task tracking

A roadmap is a concise view of planned work and current priorities. GitHub Issues/PRs are the operational source of truth for task state and discussion. Link roadmap items to issues/PRs; do not copy entire issue histories into a roadmap.

## 4. One source of truth

Every subject has exactly one authoritative living document or specification. Other documents should link to it instead of copying its rules, status tables or long explanations.

Examples:

- Repository engineering standards: `ENGINEERING_STANDARDS.md`
- Agent collaboration and branch/PR lifecycle: `AI_AGENT_WORKFLOW.md`
- Domain/path ownership: `docs/engineering/DOMAIN_OWNERSHIP.md`
- Harvester trading priority and safety: `apps/harvester/docs/TRADING_FIRST.md`
- Harvester domain behavior: the explicitly designated canonical domain specification
- Current domain work: that domain's `ROADMAP.md`
- Current task state: its GitHub Issue/PR

If two documents conflict, follow the explicitly designated canonical source only within its stated scope. Record and resolve ambiguous conflicts; do not guess or silently choose the newest-looking file. Historical evidence is not overridden by current policy; current policy determines current behavior.

## 5. Directory and naming conventions

Prefer descriptive, lowercase kebab-case names for new Markdown files and directories:

- `architecture/`, `operations/`, `testing/`, `decisions/`, `audits/`
- `broker-port-and-adapter.md`
- `2026-11-09_14-30-00_restart-reconciliation-investigation.md`

Keep established filenames when renaming would create more broken links and churn than value. New conventions apply to new files and intentional migrations.

For timestamped evidence files, use:

`YYYY-MM-DD_HH-MM-SS_<short-subject>.md`

Use UTC timestamps and state the timezone in the document. Never use ambiguous suffixes such as `(1)`, `final`, `latest`, or `v2` to distinguish evidence snapshots. A stable living document may have a stable name; timestamps are for separate historical observations, not routine versioning.

Avoid creating directories before there is content that needs them. Do not create a new file for a short note that belongs in an existing authoritative document or GitHub issue.

## 6. Metadata and document lifecycle

Substantial living documents, specifications, runbooks, plans and investigations should begin with concise metadata. Use only fields that are meaningful:

```yaml
---
title: Document title
status: active
type: architecture
owner: harvester
created: 2026-11-09
last_verified: 2026-11-09
---
```

Allowed lifecycle statuses:

- `draft`: incomplete proposal; not authoritative unless explicitly stated
- `active`: current maintained guidance
- `accepted`: accepted policy or decision
- `superseded`: replaced by a named successor; preserve and link
- `archived`: retained for reference, not current guidance

Do not add metadata mechanically to every tiny README, template, generated file or source comment. Do not claim a verification date unless the content was actually checked against the relevant implementation/evidence. Prefer Git history for ordinary edit dates; do not maintain a manual `last_updated` field unless a reliable process updates it.

Every superseded or archived document must identify its successor or explain why no successor exists. Do not delete historical evidence as a cleanup shortcut.

## 7. Architecture Decision Records

Use ADRs for durable decisions with meaningful alternatives, trade-offs or consequences. Store repository-wide ADRs in `docs/architecture/decisions/`; application/package ADRs belong to the owning domain's `docs/decisions/` or established equivalent.

Use monotonically increasing identifiers and descriptive names, for example `0001-use-native-esm.md`. Each ADR should include:

1. Title and status: Proposed, Accepted, Deprecated or Superseded
2. Context and problem
3. Decision
4. Alternatives considered
5. Consequences and trade-offs
6. Links to related implementation, tests, issues and superseding decisions

Do not create an ADR for every routine implementation detail. Do create one when a future maintainer would otherwise have to rediscover why a significant choice was made.

## 8. Audits, investigations and evidence

Historical evidence must remain trustworthy and reproducible.

Each substantial audit/investigation should state:

- Observation date/time and timezone
- Repository branch and exact commit SHA reviewed
- Scope and explicit exclusions
- Sources/evidence and provenance (issue/comment/file/log identifiers where applicable)
- Method and commands used, where relevant
- Findings with confidence/status labels and supporting evidence
- Unknowns, missing evidence and limitations
- Current disposition and linked follow-up issues/PRs
- Whether tests were inspected or actually executed; whether CI passed; whether external/testnet activity occurred

Never promote an inference into a fact. Preserve original evidence and distinguish source-confirmed behavior, test-confirmed behavior, observed runtime behavior, assumptions and unknowns. A later correction must be a dated addendum or successor assessment with a clear explanation.

## 9. Roadmap discipline

- Keep one roadmap per active application/package domain, plus one root roadmap for repository-wide engineering/release work.
- Root roadmap must not duplicate every application/package backlog.
- Keep roadmap entries concise: status, outcome, dependency/blocker, and issue/PR link.
- Use a consistent vocabulary such as Planned, In progress, Blocked, Done and Deferred.
- Mark work Done only after implementation, relevant tests, required checks and documentation are complete on the target branch.
- Remove completed detail from active sections when it no longer helps planning; preserve useful historical context in a dated record or GitHub issue/PR.
- Do not use a roadmap as an event log, audit archive, requirements dump or substitute for GitHub Issues.

## 10. Documentation change requirements

For every meaningful change, assess impact on:

- User-visible and internal behavior
- Public APIs, ports, events and contracts
- Configuration, environment variables and commands
- Architecture, domain rules and ownership
- Operations, deployment, monitoring and troubleshooting
- Examples, diagrams, test guidance and roadmaps
- Agent instructions and documentation indexes

Update affected living documents in the same task/PR as the change. Every meaningful PR must contain a **Documentation impact** section listing updated paths or explaining why no documentation change is warranted. Do not defer a required update to an untracked future task.

For documentation-only work, use the documentation checklist in `docs/engineering/TASK_WORKFLOWS.md`. Verify commands, paths, anchors, links and factual claims against the repository. Do not run unrelated application test suites for prose-only changes.

## 11. Mandatory AI-agent documentation behavior

These requirements apply to every AI coding agent and automated contributor, including agents operating from prompts, issues, PR comments or autonomous workflows.

Before work:

1. Read root `AGENTS.md`, `AI_AGENT_WORKFLOW.md`, `ENGINEERING_STANDARDS.md`, and the applicable task checklist.
2. Identify the owning application/package from `DOMAIN_OWNERSHIP.md`; read its `AGENTS.md` and `ROADMAP.md`.
3. Use the relevant documentation index to inventory all requirements that govern the task: specifications, ADRs, runbooks, API/contracts, configuration, testing and operational guides. Follow applicable references recursively until requirements are understood.
4. Read applicable documents in full, not only titles, snippets or summaries. Do not read unrelated domains' private implementation docs unless the task crosses those boundaries.
5. Inspect the affected source, callers/consumers, tests and configuration. Documentation review does not replace implementation inspection.
6. Identify the canonical source of truth, acceptance criteria, constraints, dependencies, verification and documentation impact.
7. Provide a concise preflight/readiness summary before implementation or state-changing actions. If a required document is missing, inaccessible, contradictory or unclear, stop and report the exact blocker; do not invent requirements.

During and after work:

- Treat documentation as maintained product content. Update affected living docs, indexes, metadata and links in the same PR.
- Preserve historical evidence and provenance; never rewrite an old report to make it look current.
- Never create a competing source of truth. Link to canonical documents.
- Add or update ADRs for significant durable decisions.
- Keep roadmaps concise and synchronized with linked GitHub work.
- Include the PR's Documentation impact note.
- Validate changed Markdown, internal links and executable examples where practical. Run the repository's documentation/agent policy checks.
- Do not claim docs are current, links are valid, or checks pass unless verified on the exact PR head.
- Do not stop at a proposed plan when the user has authorized implementation. Continue through the safe scope, PR and required CI; respect branch protection and explicit release/production approval boundaries.

The root `AGENTS.md` and owning domain `AGENTS.md` are mandatory agent entry points. This document defines documentation policy; it does not replace those entry points or the workflow they reference.

## 12. Index and discoverability requirements

- Root `README.md` links to the repository documentation index.
- `docs/README.md` explains repository-wide documentation categories and links to canonical documents.
- Every application/package README links to its local documentation index when local docs exist.
- Every substantial local docs area has a `README.md` index.
- Indexes link to canonical documents and clearly distinguish current guidance from historical records.
- Avoid giant link dumps. Group links by reader goal and keep descriptions useful.
- Update the nearest index whenever a document is added, moved, renamed, superseded or archived.

## 13. Tooling and enforcement

Enforce objective, low-cost rules first:

1. Existing `pnpm run check:agent-policy` validates ownership maps, required roadmaps and local links in central policy documents. Extend its checked-document list when adding canonical indexes/policies.
2. GitHub Actions must run the repository policy checks on pull requests to `develop` and `main`; required branch rulesets must require the intended status checks.
3. Markdown linting and broader link checking may be introduced after tool configuration, baseline and scope are reviewed. Do not claim these are enforced until CI runs them.
4. Prefer internal-link checks on every PR. External-link checks may run separately because external sites are flaky and can rate-limit.
5. Do not add a documentation website generator or dependency until there is a concrete publishing/navigation need.

**Verified enforcement baseline (2026-11-09):** the active repository ruleset `develop-core` targets `refs/heads/develop` and requires the `Check JavaScript syntax` status context. The existing JavaScript Syntax workflow runs the agent-policy/domain-ownership check, including canonical documentation/index link validation. The same active ruleset also requires `Run package tests`, `Workspace test coverage`, `packages/utils tests`, and `Audit production dependencies`. The ruleset API was readable and confirmed active; the separate branch-protection endpoint was not accessible to this integration. Do not claim the documentation check is a standalone required context: it is enforced as a step within the required `Check JavaScript syntax` context. If the workflow/context or check step is renamed/removed, update and verify the live ruleset before merging.

A successful workflow run is not proof that a check is required by branch protection. Verify live rulesets separately before claiming enforcement.

## 14. Migration and archive safety

Documentation reorganization is a controlled migration, not a bulk cleanup:

- Inventory before moving, merging, splitting, superseding or archiving.
- Record every source path and its disposition in a migration inventory.
- Check inbound links, anchors, issue/PR references and agent instructions before a rename/move.
- Preserve Git history where practical; use GitHub rename/move detection and update all references.
- Do not merge documents merely because filenames are similar; compare authority, purpose, date, evidence and scope.
- Do not split or rewrite large audit/evidence documents without preserving their original content and provenance.
- Keep migrations in small, reviewable PRs. Separate structural moves from substantive factual rewrites.
- Never delete an audit, incident report, raw evidence snapshot or decision record as a substitute for archiving.
- After each migration phase, validate links, indexes, policy checks and document counts/dispositions.

## 15. Review and continuous maintenance

Review documentation when the owning implementation changes, during PR review, and during periodic domain maintenance. A useful review asks:

- Is this still accurate against source and tests?
- Is this the canonical document, and is that clear?
- Are links, commands, config names and examples valid?
- Are status and ownership current?
- Is historical evidence clearly marked and preserved?
- Can duplicate material be replaced with a link?
- Is this document discoverable from the appropriate index?

Do not create scheduled maintenance overhead without a defined owner and useful deliverable. Prefer review during normal code/PR work; periodic audits can be added where a domain has demonstrated drift.
