# Coin Farmer — Application Architecture

**Status:** Proposed target architecture for discussion  
**Application:** `apps/bot-coin-farmer`  
**V1 reference:** `apps/bot-free-roll`  
**Implementation:** Not started

> This document describes the intended architecture of the new application. It is not a description of existing code and does not authorize implementation by itself. Detailed contracts, module responsibilities, and strategy decisions must be agreed before coding.

## 1. Purpose and architectural decision

Coin Farmer is a new application beside the existing Free-Roll app, not a rename and not an in-place refactor.

The two-app model is deliberate:

- **V1 — `apps/bot-free-roll`:** preserve the existing implementation as the reference while the successor is designed, built, and validated.
- **Successor — `apps/bot-coin-farmer`:** create an independent implementation with new architecture. It may reuse proven strategy knowledge and shared Coinzilla packages, but it must not import V1 source code at runtime.

The goal is to preserve the useful strategy intent and safety lessons while giving the successor freedom to redesign module boundaries, contracts, state ownership, persistence, orchestration, and runtime composition.

## 2. Goals and non-goals

### Goals

1. Keep the trading strategy independent of any specific exchange.
2. Make financial policy and inventory ownership explicit and testable.
3. Separate pure decisions from external effects and runtime lifecycle.
4. Treat actual executions and actual commissions as authoritative accounting facts.
5. Make order lifecycle, ambiguous outcomes, reconciliation, and recovery explicit.
6. Reuse stable Coinzilla-owned canonical contracts when they fit, without duplicating shared domain models.
7. Give the successor independent tests, configuration, persistence, diagnostics, and release gates.
8. Allow V1 and the successor to coexist during development without accidental runtime coupling.

### Non-goals for this design phase

- Modifying or refactoring V1.
- Copying the V1 directory wholesale and renaming it.
- Reusing V1 application modules through relative imports, aliases, symlinks, or deep imports.
- Selecting a database, persistence technology, dependency-injection framework, or new workspace package before requirements are agreed.
- Changing the Free-Roll strategy's intended behavior without an explicit decision.
- Claiming the successor is production-ready or authorizing live trading.

## 3. System context and application boundary

See [system-context.mmd](./diagrams/system-context.mmd).

Coin Farmer is one application in the existing pnpm monorepo. Its external dependencies are accessed through public shared-package contracts and adapters.

### V1 is a reference, not a dependency

V1 may be consulted for:

- The current strategy specification and documented behavior.
- Existing test scenarios and observed edge cases.
- Operational lifecycle and recovery lessons.
- Known implementation gaps and safety risks.
- A source-level inventory of useful algorithms that may be independently reimplemented.

V1 must not be:

- Imported by Coin Farmer at runtime.
- Used as a shared mutable state store.
- A source of implicit configuration, credentials, or runtime services.
- Modified as part of Coin Farmer implementation tasks.

If a piece of V1 logic is genuinely reusable by more than one application, first determine whether it is a stable domain concept or technical capability. Then request an owning-package change through the repository's cross-domain workflow. Do not promote application-specific code into a shared package just to avoid reimplementation.

### Shared packages

Potential shared-package reuse includes canonical entities and value objects, broker capabilities/adapters, event delivery, journaling, and generic utilities. These are candidates, not an approved dependency list. Inspect public exports and package roadmaps before choosing them.

- Prefer exact, canonical financial and execution contracts over app-local duplicates.
- Do not assume current entities already satisfy the successor's exactness or fill-level accounting requirements.
- Do not import package internals or exchange SDK types into strategy policy.
- Shared package changes must be implemented by their owning domain.

## 4. Logical architecture

See [component-architecture.mmd](./diagrams/component-architecture.mmd).

Use **Clean Architecture with Hexagonal (Ports and Adapters) boundaries and lightweight Domain-Driven Design**. This is a dependency and ownership model, not a requirement to use a framework or create one file/class per concept.

### Domain

Owns Coin Farmer strategy policy and invariants, such as:

- Buy and sell eligibility decisions.
- Profitability and fee-coverage policy.
- Inventory ownership and reservation rules.
- Pair/market readiness policy.
- Strategy-specific accounting semantics.
- Pure state transitions and refusal reasons.

Domain policy consumes canonical values and facts. It does not call a broker, publish directly to an event bus, read files, inspect process environment, or know exchange-specific payload/status/filter names.

### Application

Owns use cases and workflows that coordinate domain policy through ports. Candidate workflow responsibilities include:

- Start/stop strategy operation.
- Process a canonical market observation.
- Evaluate and submit an order intent.
- Process an actual execution/fill.
- Reconcile an order or pair.
- Recover after disconnect or restart.
- Pause/resume under explicit safety rules.

The final use-case boundaries and public contracts are open design work. Avoid creating a separate workflow for every event or noun without a clear reason.

### Ports

Ports describe capabilities required by application workflows. Candidate capabilities include market data, order mutation/query, account balances, execution history, market rules, persistence, clock, event publication, logging, and notifications.

Prefer small capability-oriented contracts over a single broad broker interface. Decide whether each contract belongs in Coin Farmer or an existing shared package only after inspecting current consumers and ownership. A port is not an excuse to duplicate an existing canonical broker contract.

### Adapters

Adapters translate external protocols into canonical application-facing facts and execute requested effects. Likely adapter areas include:

- Broker integration through the broker package's supported API.
- Persistence and state snapshots.
- Event publication and journal recording.
- Notifications and structured logging.
- Configuration parsing/validation.

Exchange SDK objects, raw payloads, exchange-specific statuses, commission field names, and filter names must be normalized at the broker boundary.

### Runtime

Runtime owns composition and process lifecycle:

- Load and validate application configuration.
- Construct adapters and application dependencies.
- Start resources in a deliberate order.
- Handle partial-startup failure and cleanup.
- Coordinate graceful shutdown and signal handling.
- Keep resource ownership and idempotent start/stop behavior explicit.

Runtime selects concrete adapters; it must not become a home for trading policy.

## 5. Dependency rules

The source dependency direction points inward:

1. Domain depends on canonical domain contracts and pure helpers.
2. Application depends on domain and the ports it consumes.
3. Adapters implement ports and translate external systems.
4. Runtime composes application components with concrete adapters.
5. Tests use deterministic fakes at external boundaries.

The following are prohibited:

- Domain/application imports from Binance or another exchange SDK.
- Domain/application imports from V1 application source.
- Deep imports into another package's private src paths.
- Direct network, filesystem, process-environment, or wall-clock access inside pure policy.
- Exchange-specific values leaking beyond the adapter normalization boundary.
- Duplicated strategy policy inside adapters.

A diagram or folder name is not enforcement. Add automated dependency checks only after the actual module graph is agreed and the check can enforce the rule reliably.

## 6. Financial and execution safety constraints

The Free-Roll V1 roadmap contains important safety invariants. They are initial requirements to evaluate and map for the successor, not proof that Coin Farmer already implements them.

The successor design must explicitly address:

### Exact values

- Use exact decimal representations for price, quantity, money, fees, notionals, balances, and exchange increments.
- Do not use JavaScript Number arithmetic for financial decisions.
- Preserve exact source decimal strings at adapter boundaries where provenance and auditability matter.
- Define rounding direction explicitly and re-check exchange constraints after rounding.
- Missing, malformed, stale, or inconsistent financial facts remain unknown; never silently coerce them to zero.

### Executions and commissions

- An order acknowledgement is not an execution.
- Actual fills are authoritative economic events; partial fills are first-class.
- Fill identity must be stable and processing idempotent.
- Preserve actual commission amount and asset per fill, including explicit zero and multiple commission records if the broker contract supports them.
- Missing or unsupported fee facts must not be replaced by configured estimates.
- Third-asset commission policy must be explicitly resolved. V1 currently documents rejection before start and pause if such a fee unexpectedly appears; successor behavior must be confirmed in the behavior mapping.

### Inventory and profitability

- Define ownership buckets for strategy inventory, permanently retained free inventory, open-order reservations, executed-but-not-reconciled inventory, and external/unmanaged wallet inventory.
- Never sell free or external inventory and never reserve the same quantity twice.
- Define one centralized, pure SELL profitability approval rule using exact quantities, price, cost basis, proceeds, fees, reserves, and minimum-profit policy.
- Missing, stale, unsupported, inconsistent, or inexact inputs must deny approval.

### Order lifecycle and uncertainty

- A cancel request is not proof of cancellation.
- Do not replace an order until final status and fills have been reconciled.
- A timeout after a create/cancel request is an ambiguous outcome, not proof that the exchange rejected it.
- Reconcile by stable client identity and authoritative history before retrying an ambiguous mutation.
- Do not release reservations or resume a pair while execution facts remain unknown.

These constraints should become explicit domain contracts, workflow rules, and test cases—not comments scattered through event handlers.

## 7. Core execution and accounting flow

See [execution-lifecycle.mmd](./diagrams/execution-lifecycle.mmd).

The intended high-level flow is:

1. Adapter receives external market or account data.
2. Adapter validates and normalizes it into canonical facts, preserving source identity and exact values.
3. Application workflow checks readiness and obtains the relevant current state.
4. Domain policy evaluates the facts and returns a decision or refusal reason.
5. Application validates reservations and submits an order request through a port.
6. Broker adapter reports the order outcome without conflating acknowledgement with execution.
7. Actual fill events are normalized and applied idempotently to the accounting/inventory model.
8. Reconciliation verifies local state against authoritative broker facts.
9. Only a fully understood state may produce another trading decision.

The detailed BUY and SELL algorithms, fee model, cost basis, partial recovery behavior, and state transitions must be mapped from V1 and explicitly reviewed before implementation. This architecture document does not invent or silently settle them.

## 8. Recovery and reconciliation

See [recovery-sequence.mmd](./diagrams/recovery-sequence.mmd).

Recovery is a safety workflow, not simply reconnecting a WebSocket.

The successor must design a reconciliation contract that can establish, as applicable:

- Current balances and locked amounts.
- Open orders and their final/unknown states.
- Tracked order history and all relevant executions.
- Fill identity and deduplication boundaries.
- Commission completeness and supported fee assets.
- Trading rules and metadata freshness.
- Local reservations, ledger totals, and inventory ownership.
- Persistence snapshot version and last reconciled cursor/time.

A pair or strategy remains paused when required evidence is incomplete or inconsistent. A live market-data subscription alone is not proof that it is safe to trade.

The persistence format, recovery cursor, replay semantics, and operator resume procedure remain open decisions for the next design stage.

## 9. Runtime isolation and coexistence

V1 and Coin Farmer are separate applications and must own separate runtime resources.

- Separate configuration files and environment-variable namespaces.
- Separate logs/diagnostic identity.
- Separate persistence locations and schema/version ownership.
- Separate startup/shutdown and resource cleanup.
- No V1 process state or in-memory object sharing.
- No implicit sharing of order IDs, queues, reservations, or pair state.

Development-time coexistence is expected. Simultaneous trading against the same exchange account is not automatically safe: both applications could observe or mutate the same balances and orders. Before any such use, define account/subaccount separation or a deliberate single-writer/ownership mechanism and prove it with tests.

Cutover from V1 to Coin Farmer, disabling V1, renaming paths, and deleting V1 are separate release decisions requiring explicit approval.

## 10. Testing and validation model

Coin Farmer must have its own deterministic test suite. V1 tests may inform scenarios, but they do not validate Coin Farmer.

| Test level | What it should prove |
|---|---|
| Domain unit | Exact calculations, profitability decisions, inventory invariants, state transitions |
| Application workflow | Port call order, idempotency, refusal paths, retries, cancellation and timeout behavior |
| Adapter contract | Canonical mapping, source identity, decimal preservation, fee completeness, pagination semantics |
| Adapter integration | Real SDK/network behavior in controlled environments; order placement on TESTNET only |
| Simulation/replay | Partial fills, duplicate/late events, event ordering, cancel/fill races, disconnects, restart |
| Acceptance | Full strategy lifecycle and operational safeguards in a safe environment |

Default tests must not require credentials, network access, or a live exchange. Control clocks and concurrency deterministically. Every test must clean up resources it creates.

## 11. Proposed development sequence

This is a design sequence, not yet an implementation roadmap:

1. Agree the V1 protection and successor scope.
2. Inventory V1 documented rules, source modules, tests, and known gaps.
3. Produce a behavior mapping with preserve/change/review decisions.
4. Audit shared Coinzilla entities and broker contracts against successor needs.
5. Define domain concepts, application workflows, ports, and error semantics.
6. Define persistence, recovery, runtime composition, and operational isolation.
7. Agree test/acceptance evidence and implementation milestones.
8. Implement Coin Farmer incrementally in its own app and task branches.
9. Validate safe-environment behavior and operational readiness.
10. Make a separate, explicit cutover decision.

## 12. Open decisions — do not assume

The following are intentionally not decided by this document:

- Whether Coin Farmer remains exclusively a Free-Roll strategy or may later host other coin-accumulation strategies.
- Exact behavior parity policy: which V1 rules are preserved exactly, which known defects may be corrected, and which ambiguities require product decisions.
- Exact application package name, package scripts, config schema, and environment-variable names.
- Which shared entity and broker contracts are sufficiently mature for reuse and which need owner-led changes.
- Exact use-case list, module names, port shapes, and source folder granularity.
- Persistence technology, durability guarantees, schema migration, and replay cursor.
- Whether V1 and successor may ever run simultaneously against one account.
- The acceptance threshold and operational soak required before cutover.
- When, if ever, V1 is retired or its directory renamed.

No item above should be silently settled by implementation convenience. Record approved decisions in ADRs and the Coin Farmer roadmap before they become code constraints.
