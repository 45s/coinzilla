# Engineering Standards for AI Agents

These instructions apply to all work in `apps/harvester/` and take precedence over generic agent defaults. Follow repository-wide guidance (including root `AGENTS.md`, contribution docs, and existing conventions) as well. The [Harvester documentation index](./docs/README.md) is the entry point for domain documentation; repository-wide documentation requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md).

## Mandatory documentation and requirements preflight

Before every Harvester task— including investigation, debugging, tests, documentation, configuration, and implementation—complete the repository-root documentation preflight. Read in full all repository-wide governance/engineering requirements and applicable checklists, then inventory and read **all applicable Harvester documentation and requirements**, including this file, [TRADING_FIRST.md](./docs/TRADING_FIRST.md), [ROADMAP.md](./ROADMAP.md), architecture and domain specifications, broker/API contracts, operational and TESTNET runbooks, configuration documentation, and relevant test guidance. Follow their links/references recursively and inspect the affected implementation, consumers, tests, and configuration. Do not rely on summaries, prior conversations, search snippets, or another agent's claimed review.

Before any implementation or state-changing action, provide a concise preflight summary: documents reviewed, understood requirements/constraints, exact acceptance criteria, planned verification, and any conflicts or blockers. **Do not begin work until the review is complete and you can explain the requirements.** If a required document is missing, inaccessible, unclear, or contradictory, stop and report it. Explicitly selected user tasks define the work scope; a TESTNET acceptance milestone is not a blanket prerequisite for Journal or engineering work.

Follow the selected issue's scope and repository task workflow. Journal evidence is an explicitly selected Harvester workstream; it must not change strategy decisions, become trading-state authority, or add blocking I/O to market, broker-event, or fill-accounting paths.

## Visual documentation

Follow the repository-wide [visual documentation and workflow schemas standard](../../ENGINEERING_STANDARDS.md#visual-documentation-and-workflow-schemas). For complex Harvester trading, order-lifecycle, and recovery workflows, use a source-verified Mermaid flowchart or sequence diagram in the closest existing authoritative document. Include exchange failure paths, deferred readiness, unknown outcomes, fill reconciliation, and safety boundaries; do not duplicate the authoritative Conservative strategy rules.

## Product priority

[TRADING_FIRST.md](./docs/TRADING_FIRST.md) remains the source of truth for trading behavior and exchange-safety requirements. It does not impose a blanket acceptance gate on separately selected engineering work.

## Before changing code

Follow the repository [task workflow](../../docs/engineering/TASK_WORKFLOWS.md) and inspect the current Harvester implementation, consumers, tests, configuration, and roadmap before designing a change.

## Implementation quality

Follow the canonical [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and [Modularity Standard](../../docs/engineering/MODULARITY_STANDARD.md). This file records only Harvester-specific constraints.

## Tests and verification

Follow the canonical [human-readable test design standard](../../ENGINEERING_STANDARDS.md#human-readable-test-design) and engineering verification requirements. Harvester tests must read as plain-English behavior specifications: precise domain variable names, named-field comparisons instead of opaque tuples, descriptive test names, and a detailed message on every assertion. Keep exchange-order verification deterministic and offline by default; exchange-order verification is opt-in and TESTNET-only.

## Changes and delivery

**Per-commit documentation rule:** every commit that changes Harvester implementation, configuration, tests, or runtime behavior MUST include the corresponding documentation update in that same commit. If behavior is unchanged, state that explicitly in the commit/PR summary.

## Security and operational safety

Follow the canonical security requirements in [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and Harvester's TESTNET/live-trading boundary in [TRADING_FIRST.md](./docs/TRADING_FIRST.md). Never enable live trading as part of routine development.

## Domain implementation style

Follow the repository [modularity standard](../../docs/engineering/MODULARITY_STANDARD.md). Harvester-specific requirements: deterministic trading calculations and strategy decisions are plain pure functions; classes own state and enforce lifecycle invariants; use cases coordinate workflows through injected ports. See [Architecture](./docs/architecture.md#implementation-pattern-for-use-cases) for the established factory/composition pattern.

## Application architecture

Follow the authoritative [Harvester architecture](./docs/architecture.md) for use-case factories, ports, adapters, bootstrap composition, and dependency direction. Reuse existing entity and broker contracts; do not introduce parallel domain models or adapter-specific details into strategy/domain code.

## Logging

Follow the [Shared Utilities Policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md) for logger selection, structured diagnostics, and console restrictions. Harvester bootstrap defaults to `defaultLogger` from `@coinzilla/utils`.

## GitHub Actions is the verification runner

Harvester agents MUST write the implementation, regression tests, and same-commit documentation updates. GitHub Actions runs the tests and checks for task PRs.

A missing local checkout, terminal, Node installation, pnpm installation, or local test runner is not a reason to stop, defer implementation, or ask the user to run commands. Use GitHub repository operations to create the task branch, commit the actual changes, and open/update the PR. Inspect the exact PR head and GitHub Actions results, fix failures in source/tests, and let GitHub rerun them. Never weaken tests or claim success without green checks on the exact head SHA. Merge into `develop` only after all required checks pass and branch freshness is verified.

## Application configuration

- The app has one application-wide named `appConfig` export in `apps/harvester/config/index.js`. Focused configuration modules are allowed when they isolate a cohesive concern and are imported into that single object (for example, `OPERATOR_CONTROL_CONFIG` from `config/operator-control.js` and notification profile constants from `config/notifications-tg-profiles.js`). Do not create separate runtime configuration boundaries or duplicate validators. **Use named exports only; do not introduce default exports in Harvester configuration or domain modules.**
- Keep strategy-owned settings and pairs under `strategies.CG_coinGrabber`, defined in `config/strategies/cg-coin-grabber.js` and imported into the single `appConfig`; keep application-wide concerns such as Telegram notification policy and operator-control settings in sibling root sections.
- The `config:symbol` generator may update only the pair entries between the generated-pair markers in `config/strategies/cg-coin-grabber.js`; preserve imports, strategy settings, comments, and all source outside that region.
- Use `loadAppConfig` and `validateAppConfig` for the application configuration boundary. Update their tests and all docs/examples when the contract changes.
- Telegram bot tokens and chat IDs are environment-only secrets. `notifications.telegram` contains only the enabled switch, profile, market filter, and event overrides.
- Notification profiles are `minimal`, `trader`, `verbose`, and `custom`. Critical safety alerts are non-disableable and bypass event overrides and market filters.
- Harvester owns trading-specific Telegram event mapping, message formatting, and notification policy. `@coinzilla/notifiers` owns generic bounded delivery, Telegram transport, and delivery diagnostics; it must not contain Harvester event semantics or message templates.

## Actionable errors and diagnostics

- AI agents MUST NOT introduce a generic `Error` for a known Harvester/domain failure when a specific failure type can be named. Use a domain-specific class extending `Error`, with a precise `name` and stable machine-readable `code`.
- Every operational error MUST identify the failing component/operation and affected entity (for example, market symbol), preserve the original cause, and expose safe structured details needed to act. The message must state what failed and why; include concrete remediation when known.
- At external-data boundaries, emit structured DEBUG/TRACE evidence before validation can reject the data. Include source/filter identifiers and normalized descriptors; never log credentials, signatures, or secret payloads.
- Fatal startup logs MUST preserve the typed error name, code, concise message, safe entity identifiers, structured details, and stack/cause in the DEBUG log. Console summaries may be compact, but MUST retain the stable error code and affected entity. Never truncate the only copy of diagnostic evidence.
- Add regression tests proving error identity/code/details and that the relevant diagnostic hook receives the failure context. Keep safety gates intact; diagnostics are not a reason to bypass validation.
