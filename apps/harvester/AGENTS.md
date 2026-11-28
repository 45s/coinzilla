# Engineering Standards for AI Agents

These instructions apply to all work in `apps/harvester/` and take precedence over generic agent defaults. Keep user-facing communication short, concrete and specific: report completed work, exact status, next action, blockers and verified results only. Avoid filler, repeated explanations and routine tool narration. See the repository communication rule in the root [AGENTS.md](../../AGENTS.md#agent-communication--mandatory). Follow repository-wide guidance (including root `AGENTS.md`, contribution docs, and existing conventions) as well. The [Harvester documentation index](./docs/README.md) is the entry point for domain documentation; repository-wide documentation requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md).

## Understand applicable Harvester requirements

For Harvester work, read the applicable repository-wide instructions and checklist, then consult relevant Harvester guidance such as [TRADING_FIRST.md](./docs/TRADING_FIRST.md), [ROADMAP.md](./ROADMAP.md), architecture/domain specifications, broker/API contracts, operational and TESTNET runbooks, configuration documentation, and test guidance. Inspect the affected implementation, consumers, tests, and configuration before changing behavior. Do not read unrelated domain internals.

A TESTNET acceptance milestone is not a blanket prerequisite for separate engineering work. Understand the selected task's scope and preserve the Harvester safety constraints below.

Follow the selected issue's scope and repository task workflow. Journal evidence is an explicitly selected Harvester workstream; it must not change strategy decisions, become trading-state authority, or add blocking I/O to market, broker-event, or fill-accounting paths.

## Visual documentation

Follow the repository-wide [visual documentation and workflow schemas standard](../../ENGINEERING_STANDARDS.md#visual-documentation-and-workflow-schemas). For complex Harvester trading, order-lifecycle, and recovery workflows, use a source-verified Mermaid flowchart or sequence diagram in the closest existing authoritative document. Include exchange failure paths, deferred readiness, unknown outcomes, fill reconciliation, and safety boundaries; do not duplicate the authoritative Conservative strategy rules.

## Product priority — trading only

**P0 is a working, correct trading application.** When trading is failing, every agent MUST investigate, reproduce, fix, and verify the trading failure before starting or continuing recovery, facts/ledger, database/SQLite, history/projection, roadmap, observability, architecture, or maintainability work. Those workstreams are secondary and MUST NOT be presented as progress toward a working trading app or used to delay its repair. Update relevant docs to preserve this priority. Do not claim trading works without exact regression and CI evidence.

Preserve existing execution safeguards; do not weaken ownership, fill accounting, order idempotency, or required pre-side-effect barriers as a shortcut. If an existing safeguard itself prevents correct trading, fix its concrete defect with a focused regression. No new recovery/facts/database scope is authorized by a trading incident.

[TRADING_FIRST.md](./docs/TRADING_FIRST.md) is the source of truth for this priority and trading behavior.

## Before changing code

Follow the repository [task workflow](../../docs/engineering/TASK_WORKFLOWS.md) and inspect the current Harvester implementation, consumers, tests, configuration, and roadmap before designing a change.

## Implementation quality

Follow the canonical [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and [Modularity Standard](../../docs/engineering/MODULARITY_STANDARD.md). This file records only Harvester-specific constraints.

## Recovery Seller scenario work — mandatory

For any Recovery Seller domain-scenario task, read [recovery-seller-scenario-testing.md](./docs/domain/recovery-seller-scenario-testing.md) and the live [RS scenario matrix, issue #1780](https://github.com/45s/coinzilla/issues/1780) before editing. The playbook owns the RS-001…RS-010 family/subcase schema, A–K matrix crosswalk, file trees, domain/application boundaries, canonical fixture and fake-port contracts, independent financial oracles, test registration/commands, evidence requirements and phased delivery.

Do not treat existing RS unit/workflow/runtime/operator tests as scenario coverage. Do not invent or resolve STOP, third-asset valuation, restart/replay, or other deferred behavior in a scenario PR. Keep #1780, the repository scenario catalog, Harvester/root roadmaps and affected domain docs synchronized.

## Tests and verification

Follow the canonical [human-readable test design standard](../../ENGINEERING_STANDARDS.md#human-readable-test-design) and engineering verification requirements. Harvester tests must read as plain-English behavior specifications: precise domain variable names, named-field comparisons instead of opaque tuples, descriptive test names, and a detailed message on every assertion. Keep exchange-order verification deterministic and offline by default; exchange-order verification is opt-in and TESTNET-only.

## Changes and delivery

**Per-commit documentation rule:** every commit that changes Harvester implementation, configuration, tests, or runtime behavior MUST include the corresponding documentation update in that same commit. If behavior is unchanged, state that explicitly in the commit/PR summary.

## Security and operational safety

Follow the canonical security requirements in [ENGINEERING_STANDARDS.md](../../ENGINEERING_STANDARDS.md) and Harvester's TESTNET/live-trading boundary in [TRADING_FIRST.md](./docs/TRADING_FIRST.md). Never enable live trading as part of routine development.

## Domain implementation style

Follow the repository [modularity standard](../../docs/engineering/MODULARITY_STANDARD.md). Harvester-specific requirements: deterministic trading calculations and strategy decisions are plain pure functions; classes own state and enforce lifecycle invariants; use cases coordinate workflows through injected ports. See [Architecture](./docs/architecture.md#implementation-pattern-for-use-cases) for the established factory/composition pattern.

## Order-history identity

Before broker acknowledgement, use the opaque clientOrderId only as a submission-correlation key and provisional pending-order lookup key. After acknowledgement, the provider's native brokerOrderId is canonical, scoped by environment, provider instance/type, account, and market because provider order IDs may be market-local. Keep clientOrderId as a correlation and integrity-check attribute; it must not compete with brokerOrderId as the accepted order's identity. Never merge or correlate pending orders across markets; promote only when market and creation facts agree, and fail closed on ambiguity. Link fills by the exact market-scoped brokerOrderId; a reused clientOrderId must never link fills across orders. Current-process ownership is explicit runtime metadata, never inferred from an ID prefix or shape. Preserve immutable price/quantity checks for the same exchange order, and never repair conflicting persisted facts silently. Compare decimal facts with the repository's exact decimal utilities, not JavaScript string equality or floating-point numbers. Equivalent decimal representations must not be treated as conflicts; preserve an existing representation when the numeric value is unchanged. A genuinely different immutable numeric value remains an integrity error.

## Application architecture

Follow the authoritative [Harvester architecture](./docs/architecture.md) for use-case factories, ports, adapters, bootstrap composition, and dependency direction. Reuse existing entity and broker contracts; do not introduce parallel domain models or adapter-specific details into strategy/domain code.

## Logging

Follow the [Shared Utilities Policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md) for logger selection, structured diagnostics, and console restrictions. Harvester bootstrap defaults to `defaultLogger` from `@coinzilla/utils`.

## GitHub Actions is the verification runner

Harvester agents MUST write the implementation, regression tests, and same-commit documentation updates. GitHub Actions runs the tests and checks for task PRs.

## Application configuration

- The app has one application-wide named `appConfig` export in `apps/harvester/config/index.js`. Focused configuration modules are allowed when they isolate a cohesive concern and are imported into that single object (for example, `OPERATOR_CONTROL_CONFIG` from `config/operator-control.js` and notification profile constants from `config/notifications-tg-profiles.js`). Do not create separate runtime configuration boundaries or duplicate validators. **Use named exports only; do not introduce default exports in Harvester configuration or domain modules.**
- Keep each strategy's flags/settings in its focused `config/strategies/<strategy>.js` module imported into the single `appConfig`. Keep CG pair definitions in the operator-maintained `apps/harvester/cg-coin-grabber.js` module (`tradingPairs`) and RS pair definitions in `apps/harvester/rs-recovery-seller.js` (`recoverySellerPairs`); do not duplicate pair definitions in application source.
- The `config:symbol` generator updates only `apps/harvester/token-specification.json`; it must never add or modify strategy pairs. Group specifications by base asset and key each token's `markets` object by exact Binance symbol. Keep `pricePrecision` and `quantityPrecision` under each market because `tickSize` and `stepSize` can differ between quote pairs.
- External pair entries MUST use `TRADING_ENVIRONMENTS.BOTH`, `.TESTNET`, or `.LIVE` and `EXTERNAL_ORDERS_POLICIES.IGNORE` or `.BLOCK`; keep the serialized values unchanged and use these named constants in validation, selection, and generator tests.
- `apps/harvester/token-specification.json` is the sole source of exchange-derived pair precision. `loadAppConfig` resolves every operator-configured pair by exact market symbol and adds `pricePrecision`/`quantityPrecision` to the effective runtime pair before `validateAppConfig`; missing, malformed, or multiply assigned market metadata must fail closed. Strategy pair entries must not define these precision fields.
- Use `loadAppConfig` and `validateAppConfig` for the application configuration boundary. Update their tests and all docs/examples when the contract changes.
- Configuration modules are declarative: never read `process.env` or other ambient process state at module evaluation. Pass an injected `env` object to the bootstrap/composition resolver; keep secrets and deployment overrides outside the static `appConfig` export.
- Telegram bot tokens and chat IDs are environment-only secrets. `notifications.telegram` contains only the enabled switch, profile, market filter, and event overrides.
- Notification profiles are `minimal`, `trader`, `verbose`, and `custom`. Critical safety alerts are non-disableable and bypass event overrides and market filters.
- Harvester owns trading-specific Telegram event mapping, message formatting, and notification policy. `@coinzilla/notifiers` owns generic bounded delivery, Telegram transport, and delivery diagnostics; it must not contain Harvester event semantics or message templates.

## Actionable errors and diagnostics

Follow the repository-wide [Structured Error Handling Standard](../../docs/engineering/structured-error-handling.md) for the shared `SystemCustomError` base, stable codes, cause preservation and safe context. This section adds stricter Harvester-specific diagnostic requirements.

- AI agents MUST NOT introduce a generic `Error` for a known Harvester/domain failure when a specific failure type can be named. Define a domain-specific error class extending the shared `SystemCustomError` from `@coinzilla/utils` (which itself extends `Error`), with a precise `name`, stable machine-readable `code`, preserved `cause`, and safe structured context. Follow the canonical [Structured Error Handling Standard](../../docs/engineering/structured-error-handling.md).
- Every operational error MUST identify the failing component/operation and affected entity (for example, market symbol), preserve the original cause, and expose safe structured details needed to act. The message must state what failed and why; include concrete remediation when known.
- At external-data boundaries, emit structured DEBUG/TRACE evidence before validation can reject the data. Include source/filter identifiers and normalized descriptors; never log credentials, signatures, or secret payloads.
- Fatal startup logs MUST preserve the typed error name, code, concise message, safe entity identifiers, structured details, and stack/cause in the DEBUG log. Console summaries may be compact, but MUST retain the stable error code and affected entity. Never truncate the only copy of diagnostic evidence.
- Add regression tests proving error identity/code/details and that the relevant diagnostic hook receives the failure context. Keep safety gates intact; diagnostics are not a reason to bypass validation.

For any change to a behavior listed in [critical-behaviors.json](./docs/critical-behaviors.json), update its authoritative invariants, owning source modules, named normal/failure tests, required integration evidence, runtime limitation, and measured coverage entry. Run `pnpm --filter @coinzilla/harvester run check:reliability`. The required Test Coverage workflow also enforces per-module floors after the full package coverage run; never lower a floor to hide a regression—remeasure the baseline and document the reason first.

## Scenario Runner approved refactoring scope

Trading logic/services may be refactored as necessary on the task branch to reuse production flows faithfully; preserve real trading behavior and safety, add regression tests, and document affected consumers. Stay within the authorized task scope and verify affected consumers. This does not authorize real trading actions.
