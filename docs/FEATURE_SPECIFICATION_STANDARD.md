# Feature specification standard

- Status: accepted
- Type: Repository-wide documentation standard
- Owner: Repository engineering
- Effective: 2026-11-24
- Scope: New and materially changed product features across applications and packages

## 1. Purpose

A feature specification is the durable, human- and AI-readable contract for a feature's intended behavior. It explains what the system must do, why the capability exists, who owns it, which boundaries it must respect, and how its behavior can be verified.

The `features/` directory exists so a contributor or AI agent can open one feature folder and understand the feature without guessing from source filenames, reconstructing intent from pull requests, or depending on chat history.

A good specification answers:

1. What user or system problem does this feature solve?
2. Which application or package owns it?
3. What is included and explicitly excluded?
4. What behavior is required, including important failure and boundary cases?
5. Which data, API, domain or persistence contracts are involved?
6. How will a reviewer know the implementation is correct?
7. Which existing architecture, safety and engineering rules constrain it?
8. What is the current design status, and where are implementation and task status tracked?

Specifications describe intended behavior. They do not claim that behavior is already implemented.

## 2. Relationship to other sources of truth

Keep these artifacts distinct. They answer different questions and must link to each other.

| Artifact | Authority | Answers |
| --- | --- | --- |
| Feature specification in `docs/features/<feature>/` | Durable intended feature contract | What should this feature do? |
| GitHub Issue | Live task contract and status | What work is authorized, who owns it, what remains, and what is accepted? |
| GitHub PR | Proposed change and review record | What implementation is being changed and how is it reviewed? |
| Source code and executable schemas | Implemented behavior and machine-enforced contracts | What does the current system actually do? |
| Automated tests | Executable evidence | Which specified behaviors are verified? |
| Roadmap | Concise priority/status index | What is planned, active, blocked or complete in this domain? |

Rules:

- A specification is not a substitute for a GitHub Issue. Non-trivial implementation work still requires an Issue under the [AI-agent workflow](../AI_AGENT_WORKFLOW.md).
- An Issue is not the long-term home for a detailed domain contract. Link the canonical specification instead.
- A PR must link its Issue and specification, describe implementation and verification, and include a Documentation impact section.
- Source code and tests may reveal that an accepted specification is incomplete or wrong. Resolve the discrepancy explicitly and update the specification in the same task PR; do not silently let code and documentation diverge.
- The roadmap links to the feature specification and tracking Issue. It must not copy the full specification or become a commit diary.
- If an existing canonical document already owns the behavior, extend or link that document rather than creating a competing specification.

## 3. Where feature specifications live

Use the owning application or package. Do not put every feature specification in repository-root `/docs`.

| Owner | Feature specification location |
| --- | --- |
| Application | `apps/<app>/docs/features/<feature-slug>/` |
| Shared package | `packages/<package>/docs/features/<feature-slug>/` |
| Repository-wide capability with no single owning domain | `docs/features/<feature-slug>/` |

The repository-root `docs/FEATURE_SPECIFICATION_STANDARD.md` is the standard for creating specifications; it is not the default storage location for application-specific feature contracts.

Use a concise, descriptive, lowercase kebab-case feature slug. Keep one coherent feature per folder.

### 3.1 When to create a feature folder

Create a feature folder when the capability is substantial enough that an AI agent or maintainer needs a durable behavior contract, for example:

- A new user-visible page, workflow or product capability.
- A new domain workflow, lifecycle or state machine.
- A cross-module integration with meaningful data or failure contracts.
- A feature with multiple domain scenarios, acceptance conditions or formal schemas.
- A feature whose design must be reviewed before implementation.

Do not create a feature folder for every small bug fix, one-line change, routine refactor, dependency update, or isolated maintenance task. Use the owning documentation and GitHub Issue appropriate to that task.

Do not create an empty `features/` directory or speculative folders for ideas that have not reached a documented proposal.

## 4. Standard feature-folder structure

Start with the smallest structure that communicates the contract:

```text
apps/<app>/docs/
  README.md
  features/
    <feature-slug>/
      SPEC.md
      DOMAIN_SCENARIOS.md
      schemas/
        <contract-name>.schema.json
```

The same structure applies under a package's `docs/` or repository-root `docs/features/` when that scope owns the feature.

Files are added based on actual need:

| File | Requirement | Responsibility |
| --- | --- | --- |
| `SPEC.md` | Required | Primary feature contract: purpose, scope, behavior, architecture boundaries, data/API contracts, failure handling, acceptance criteria and lifecycle. |
| `DOMAIN_SCENARIOS.md` | Required when behavior has meaningful scenarios; strongly recommended for substantial features | Human-readable, concrete examples of observable behavior, including normal, boundary and failure cases. |
| `schemas/` | Optional | Machine-readable JSON Schemas or other formal schemas when a stable structured contract needs validation or precise field definitions. |
| Additional documents | Only when justified | Focused details that would make the primary specification unwieldy, such as a protocol contract or migration plan. Link them from `SPEC.md`. |

Do not add empty folders, placeholder schemas, speculative architecture documents, or files solely to satisfy a rigid template. For a substantial feature, the default is `SPEC.md` plus `DOMAIN_SCENARIOS.md`; add schemas when structured data contracts benefit from formal validation.

### 4.1 `SPEC.md` — primary contract

The specification is the entry point and must link to every companion document.

Include the sections that apply:

1. **Metadata:** title, lifecycle status, type, owner and creation date.
2. **Purpose:** user/system problem, intended outcome and important terminology.
3. **Ownership and context:** owning app/package, affected surfaces and relevant existing contracts.
4. **Scope:** included capabilities and explicit non-goals.
5. **User-visible behavior:** screens, actions, fields, ordering, formatting and accessibility where relevant.
6. **Domain rules and invariants:** decisions, identity, state transitions, precedence, validation and ownership.
7. **Data and integration contracts:** source of truth, endpoints/events, schemas, mapping, freshness, pagination, persistence and compatibility.
8. **Failure and recovery behavior:** unavailable dependencies, partial results, retries, timeouts, stale data, malformed data and user-visible errors.
9. **Security and safety boundaries:** credentials, authorization, trust boundaries, side effects and prohibited operations.
10. **Architecture constraints:** ownership boundaries, allowed dependencies and where responsibilities must live.
11. **Acceptance criteria:** observable, verifiable outcomes. Distinguish required v1 behavior from optional future work.
12. **Verification expectations:** scenario/test coverage and relevant checks; do not claim they have passed before execution.
13. **Lifecycle and links:** companion scenarios/schemas, tracking Issue, PRs and related canonical docs.

Do not mechanically include empty sections. Explain unknowns explicitly. Label examples as illustrative when they are not real data.

### 4.2 `DOMAIN_SCENARIOS.md` — behavior examples

Scenarios make the specification testable and prevent AI agents from inventing behavior.

Use stable scenario identifiers and a consistent structure:

```markdown
## Scenario 01 — <observable behavior>

**Purpose:** <why this case matters>

### Given
<initial state and exact relevant data>

### When
<user action, event or operation>

### Then
<observable expected result and state>
```

A scenario should be concrete enough to become an automated test without asking what the author meant.

Cover the applicable categories:

- Normal successful behavior.
- Boundaries and empty inputs/states.
- Invalid or malformed input.
- Missing or stale external data.
- Partial failure and recovery.
- Duplicate, repeated or out-of-order operations.
- Persistence, reload and lifecycle transitions.
- Security and prohibited side effects.
- Interactions with neighboring features.

Not every feature needs every category. Choose cases based on the domain and risk. Avoid vague scenarios such as "works correctly" or examples without an expected outcome.

End with cross-scenario invariants when several scenarios share rules. If scenarios are numerous, group them by workflow or lifecycle.

### 4.3 `schemas/` — machine-readable contracts

Add schemas when a structured payload, persisted record, configuration object, event or API contract benefits from formal validation.

- Use the appropriate published JSON Schema draft and declare it with `$schema`.
- Give schemas descriptive titles and stable identifiers where appropriate.
- Define required fields, types, nullability, formats, constraints and additional-property policy deliberately.
- Distinguish external/raw payloads from normalized internal models and persisted state. Do not pretend they are the same contract.
- Document ownership and source of each field in the specification.
- Keep examples valid against the schema.
- Do not create schemas for informal UI examples or unstructured prose.
- A schema is not a substitute for behavioral scenarios or runtime validation. State where and how it is expected to be enforced.

## 5. Authoring workflow

Create and review a feature specification in this order:

1. **Identify ownership.** Read root `AGENTS.md`, the owning domain's `AGENTS.md` and `ROADMAP.md`, the repository [Documentation Governance](DOCUMENTATION_GOVERNANCE.md), and relevant canonical engineering/domain contracts.
2. **Search before creating.** Inspect the owning docs index and search existing specifications, ADRs, API contracts, schemas, tests and implementation. Reuse or extend an existing canonical source where possible.
3. **Define the problem.** State the user/system outcome, terminology and domain owner. Separate known facts, decisions, assumptions and unresolved questions.
4. **Set boundaries.** Define included behavior, non-goals, data ownership, side effects, security constraints and cross-domain dependencies.
5. **Write the behavior contract.** Create `SPEC.md` and concrete scenarios. Describe outcomes rather than prescribing code structure unless an architectural constraint requires it.
6. **Formalize data where useful.** Add schemas only for real structured contracts. Check that schema examples, scenario payloads and prose agree.
7. **Resolve design ambiguity.** Do not silently invent missing business rules. Ask the product owner one focused question when a decision is necessary; otherwise record a bounded assumption or explicit open decision.
8. **Review for AI readability.** A new agent with only the repository, Issue and specification must be able to understand the intended behavior, scope, constraints and verification without chat history.
9. **Index and link.** Update the nearest documentation index and the owning roadmap when the feature becomes planned or active. Link the root standard where useful; do not duplicate its rules.
10. **Track authorization.** Create/adopt a GitHub Issue before non-trivial implementation. Link the Issue from the spec and roadmap. A draft proposal alone does not authorize implementation.
11. **Implement through one task PR.** Keep implementation, tests and required documentation updates together in the same branch and PR. The agent follows the repository [AI-agent workflow](../AI_AGENT_WORKFLOW.md); the user reviews and merges.
12. **Close the documentation loop.** Update the specification when decisions or delivered behavior change. Record links to implementation PRs and tests when useful. Do not mark a feature implemented merely because a PR was opened or CI passed.

## 6. How an AI agent must use a specification

When asked to implement or continue a feature:

1. Read the complete `SPEC.md`, all linked scenario/schema documents, and the tracking Issue/PR. Do not rely on a summary or a few snippets.
2. Read root and applicable domain agent instructions, roadmaps, task checklist and canonical standards.
3. Inspect current source, consumers, tests and relevant external contracts. A specification describes intended behavior; it does not prove current implementation.
4. Build a requirement-to-scenario-to-test traceability map before implementation. Identify requirements with no scenario/test and scenarios that conflict with source or other contracts.
5. Treat explicit non-goals, ownership boundaries and prohibited side effects as hard constraints.
6. Do not infer unspecified behavior from filenames, examples, GitHub conventions or prior chat. Resolve essential ambiguity or record a justified assumption before proceeding.
7. Implement only the scope authorized by the Issue. A specification may describe future phases; do not implement deferred scope without authorization.
8. Follow applicable test-first and verification standards. Tests should express observable scenarios and include meaningful failure messages.
9. Update the specification, scenarios, schemas, indexes and roadmap in the same task PR whenever the accepted contract or current documented status changes.
10. Report exact implementation/CI evidence and the PR head. Never describe a proposed or unverified requirement as implemented.

If the specification conflicts with a canonical safety/engineering standard, do not follow the conflicting instruction. Stop, identify the exact conflict and update the appropriate source of truth through review. Feature specifications cannot override repository-wide policy or another domain's ownership.

## 7. Lifecycle and status

Use the document lifecycle statuses defined by [Documentation Governance](DOCUMENTATION_GOVERNANCE.md#6-metadata-and-document-lifecycle):

- `draft`: proposal is incomplete or awaiting decisions; not an accepted implementation contract.
- `active`: accepted, current feature contract. Implementation may be planned, in progress or complete; the GitHub Issue/roadmap records task status.
- `superseded`: replaced by a named successor; preserve and link it.
- `archived`: retained for reference and no longer current.

Do not invent a second status vocabulary such as "implemented" for document lifecycle. Record implementation state through the linked Issue, PR and roadmap. A feature may remain an active specification after implementation because it continues to describe current behavior.

## 8. Review checklist

Before accepting a substantial feature specification, verify:

- [ ] The owning domain and canonical location are correct.
- [ ] The feature folder represents one coherent capability.
- [ ] `SPEC.md` is the obvious entry point and links to companion files.
- [ ] Purpose, scope, non-goals and ownership are explicit.
- [ ] User-visible and domain behavior are concrete and unambiguous.
- [ ] Data sources, identities, timestamps, persistence and side effects are defined where relevant.
- [ ] Failure, partial-result, stale-data and recovery behavior are addressed where relevant.
- [ ] Security, authorization and prohibited operations are explicit.
- [ ] Scenarios contain concrete Given/When/Then inputs and observable outcomes.
- [ ] Schemas and examples agree with the specification and each other.
- [ ] Required behavior is separated from future/deferred ideas.
- [ ] Verification expectations are measurable without claiming unrun checks.
- [ ] Relevant canonical documents are linked rather than copied.
- [ ] The nearest documentation index and roadmap are synchronized.
- [ ] The linked Issue/PR state does not contradict the specification.
- [ ] A new AI agent can continue without private chat context.

## 9. Reusable starting outline

Copy this outline into a new owning-domain feature folder and remove sections that genuinely do not apply. Do not keep empty headings.

```markdown
# <Feature name>

- Status: draft
- Type: feature specification
- Owner: <app-or-package>
- Created: YYYY-MM-DD

## 1. Purpose
## 2. Ownership and context
## 3. Scope
### Included
### Explicitly excluded
## 4. User-visible behavior
## 5. Domain rules and invariants
## 6. Data and integration contracts
## 7. Persistence and lifecycle
## 8. Failure and recovery behavior
## 9. Security and architecture boundaries
## 10. Acceptance criteria
## 11. Verification expectations
## 12. Related documentation and tracking

Companion files:
- DOMAIN_SCENARIOS.md
- schemas/ (only when structured contracts need formal schemas)
```

Create `DOMAIN_SCENARIOS.md` using the scenario structure in section 4.2. Add schemas only when justified by section 4.3.

## 10. Related canonical standards

- [Documentation Governance](DOCUMENTATION_GOVERNANCE.md)
- [Markdown Style](MARKDOWN_STYLE.md)
- [Engineering Standards](../ENGINEERING_STANDARDS.md)
- [AI-agent workflow](../AI_AGENT_WORKFLOW.md)
- [Task Workflows](engineering/TASK_WORKFLOWS.md)
- [Domain Ownership](engineering/DOMAIN_OWNERSHIP.md)
