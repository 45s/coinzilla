# Harvester Architecture

> **Audit companion:** See [DDD and Clean Architecture Audit](./DDD_CLEAN_ARCHITECTURE_AUDIT.md) for the source-based assessment, scorecard, current architectural risks, and sequenced follow-up roadmap. The audit is pinned to the source revision stated in that report; it is not a live status feed. The roadmap remains authoritative for delivery priority and implementation status.
>
> **Documentation rule:** this guide contains both stable architecture rules and implementation examples/snapshots. Treat claims about what is currently wired or not wired as time-sensitive; verify them against the current source and [Harvester Roadmap](../ROADMAP.md). Historical snapshots must not be used as current implementation instructions.


## Purpose

Harvester uses one shared Trading Engine with multiple strategy policies. The engine coordinates trading workflows; a strategy decides what trading action should be taken. This lets Conservative (Free-Roll) and Aggressive use the same execution, broker, and portfolio capabilities without sharing their trading rules.

This document records the current architectural direction. It does not define implementation APIs or settle the strategy and portfolio decisions listed in the roadmap.


## Product priority: make the trading loop work first

The architecture exists to deliver a running trading application, not to postpone it. The mandatory first workflow is: load configuration → connect and subscribe to enabled-market prices → evaluate Conservative → validate and submit a broker order → process order updates and actual fills → update trading state → evaluate again and place the next required order. See [Trading First](./TRADING_FIRST.md), which takes precedence over optional architecture work.

For the first controlled TESTNET cycle, implement only the minimum execution safeguards needed for valid orders, balance/market-rule checks, fill correctness, duplicate prevention, and safe pause on uncertain state. Journal integration, durable state, comprehensive restart recovery/reconciliation, dashboards, optimization, and Aggressive are later work. Do not build those systems before the actual strategy-to-order-to-execution path exists and works. Keep the code simple and use existing contracts; do not add abstractions solely for hypothetical future needs.

## Product rule: DDD must not delay the trading loop

Harvester is being built by improving the already-working `apps/bot-free-roll` behaviour, not by inventing a more elaborate trading lifecycle. First make the Conservative app run end to end; then improve its internals incrementally.

The reference workflow is config → broker connection/price subscription → price → strategy decision → BUY/SELL submission → execution report → actual-fill accounting → next decision. DDD means pure strategy/domain rules, state-owning entities, injected use cases, broker adapters, and bootstrap composition. It does not mean adding a new layer, state machine, persistence store, or reconciliation process for every event.

**Account/readiness rule:** use in-process actual-fill accounting for the ordinary strategy loop. Do not fetch a full account snapshot after each execution report unless a concrete broker-state uncertainty requires it. Perform the minimum specific free-balance/market-rule checks before submission. A clean TESTNET account is a controlled-test recommendation, not a reason to permanently prevent app startup. Never silently adopt external balances/orders as strategy-owned inventory.

**Pending-order rule:** register PENDING before submission so events can be correlated, but keep it non-cancellable until broker acknowledgement provides a validated broker order ID. If a replacement is needed while submission is pending, defer that replacement intent; after acknowledgement, cancel and reconcile fills before placing the replacement.

Before changing an execution path, compare it with the corresponding `apps/bot-free-roll` implementation. Keep only the minimum safeguards that prevent a demonstrated duplicate, oversell, double-accounting, or unknown-outcome hazard. Do not build generic polling, sleeps, or broad reconciliation to handle ordinary event ordering.

## Architectural roles

| Concept | Responsibility | Architectural role |
| --- | --- | --- |
| Portfolio | Holds spot positions and applies fill-driven state changes | Domain entity |
| Position | Tracks holdings and quote cash flow for its defined market scope | Domain entity |
| Conservative strategy | Defines Free-Roll capital-recovery and free-asset rules | Domain policy |
| Aggressive strategy | Defines rules for managing multiple BUY and SELL orders | Domain policy |
| Trading Engine | Coordinates market updates, strategy evaluation, order workflows, and fill processing | Application layer / orchestrator |
| Use case | Performs an application goal by coordinating domain objects and ports | Application layer |
| Broker adapter | Communicates with an exchange and translates exchange-specific messages | Infrastructure / interface adapter |

These are responsibility boundaries, not a requirement that every concept must be represented by a class. The Trading Engine is not a Portfolio-like domain entity. A strategy policy is implemented as a plain pure function when its decision is deterministic. Calling it a domain policy describes its business responsibility; it does not imply a class or stateful strategy object.

## Entity versus policy

A **domain entity** represents something whose state and business invariants matter to the domain. Portfolio and Position are examples: actual executions change their state, and their rules govern valid accounting transitions.

A **domain policy** expresses a business decision rule: given relevant facts, what action should be taken? Conservative and Aggressive are policies because they define different trading decisions. They do not need exchange connectivity or order-submission mechanics.

A policy can use domain entities such as Portfolio as input. It should not own broker clients, WebSocket subscriptions, timers, or exchange SDK objects.

## Implementation style: classes versus plain pure functions

Harvester uses two complementary styles. Choose based on responsibility, not personal preference.

### Plain pure functions — required default for deterministic logic

**Calculations and decisions MUST be plain pure functions.** A pure function receives all required facts through arguments, derives its result only from those arguments, and has no observable side effects. The same inputs must produce the same output.

Use plain pure functions for:
- price, quantity, fee, and profit calculations;
- trading-policy and strategy decisions;
- validation and predicates;
- parsing, normalization, mapping, and deterministic transformations.

Meaningful pure functions MUST live in focused, cohesive modules separate from classes, use cases, and large orchestration files—even when there is only one caller. Keep related functions together by domain responsibility. Do not create artificial files for trivial one-line expressions or tightly coupled callbacks.

A pure function must not read object/instance state, globals, process environment, the clock, randomness, files, databases, networks, or broker clients. Supply the required facts explicitly. Pure domain modules must remain independent of infrastructure and application workflows.

### Classes — for owned domain state

Use classes when a domain concept owns state and must protect invariants across state changes. `Fill`, `Position`, and `Portfolio` demonstrate this style.

- Keep internal state private where appropriate.
- Expose deliberate getters and domain methods.
- Enforce state-transition invariants inside the object.
- Keep the object immutable when that matches its domain contract.
- Extract independent calculations and decisions into plain pure functions instead of adding methods solely to access private fields.

A value object can be a class when construction and encapsulation protect meaningful invariants. A simple data value does not need a class just to match `Fill`.

### Use cases — injected workflow functions

Use cases are focused functions created with explicit dependencies. They coordinate domain objects, pure functions, and application ports. Side effects happen through injected ports at application/infrastructure boundaries; deterministic domain logic stays pure.

**Decision rule:** if a behavior can be calculated from explicit inputs without side effects, implement it as a plain pure function. If a concept must own state and protect its lifecycle invariants, use a class. Do not choose a class merely for stylistic uniformity.

## Trading Engine versus Strategy

- **Strategy decides what and when:** whether to BUY or SELL, which price and quantity to request, and how its trading plan should respond to market and portfolio state.
- **Trading Engine coordinates execution:** invokes the selected policy, applies shared safety and broker constraints, submits/cancels orders through ports, and coordinates processing of resulting events.
- **Broker adapter performs exchange I/O:** translates normalized requests into exchange operations and exchange responses into application/domain facts.
- **Portfolio records executed reality:** it changes from actual fills, not from market prices, strategy intentions, or accepted orders.

The engine must not contain Conservative- or Aggressive-specific trading rules. Strategies must not duplicate broker communication or order-lifecycle mechanics.

## Typical interaction

~~~text
Market Data
    |
    v
Trading Engine
    |
    +----------> Portfolio state
    |                  |
    v                  |
Strategy Policy <------+
    |
    v
Trading Decision
    |
    v
Trading Engine
    |
    v
Broker Port / Adapter
    |
    v
Exchange
    |
    v
Actual Execution / Fill
    |
    v
Fill normalization
    |
    v
use-cases/update-portfolio.js
    |
    v
Portfolio
    |
    v
Updated state available to the next strategy evaluation
~~~

The diagram is a responsibility flow, not a mandated synchronous call sequence. Event delivery, serialization, persistence, and recovery contracts remain to be designed.

### Historical implementation snapshot — superseded

> **Historical note:** The following paragraphs describe an earlier Aggressive-first implementation snapshot. They are retained only as migration history and are not authoritative for current runtime behavior. In particular, statements below that the user-data stream is not normalized into canonical fills and that Aggressive is the only composed policy are obsolete. Use the [Harvester Roadmap](../ROADMAP.md) for current implementation status and the [DDD/Clean Architecture audit](./DDD_CLEAN_ARCHITECTURE_AUDIT.md) for the assessment and documentation follow-up.

Bootstrap loads and validates trading-config.json, connects the selected broker, and subscribes only to enabled markets. The Binance adapter receives the broker package's normalized aggregate-trade stream; the application validates the symbol, decimal price string, and event timestamp before invoking the strategy. A failed subscription aborts startup and cleans up subscriptions already created. Shutdown unsubscribes before disconnecting.

The first market-price input is the first aggregate-trade event after subscription; there is no initial REST ticker snapshot. Ordered/serialized market-event evaluation, backpressure, stale-event policy, and market-data readiness states remain future Trading Engine work.

Bootstrap composes the plain pure function `evaluateAggressiveStrategy`, an in-memory immutable Portfolio, and the `updatePortfolio` application workflow. Each strategy evaluation receives the latest Portfolio snapshot. A normalized Fill can be applied through runtime.updatePortfolio({ fill }); a successful transition replaces the current snapshot and becomes visible to the next market-price evaluation. Portfolio updates are serialized within the process to prevent concurrent fill callbacks from overwriting one another.

The Portfolio is updated only from canonical Fill facts. The current broker user-data stream is not yet normalized into canonical Fill events, so live broker executions are not automatically wired into this use case.

The Aggressive policy currently returns NO_ACTION with explicit blocker codes. It does not submit orders. This is deliberate until grid depth, percentage-step arithmetic, maximum-price-drop calculation, and SELL price/fee/rounding rules are agreed. This is not a claim that Aggressive trading is live or fully implemented.

## Use cases

Use cases coordinate application workflows and keep infrastructure details outside the domain. For example, `src/use-cases/update-portfolio.js` receives a normalized fill and coordinates applying it to the Portfolio. It should not parse raw Binance messages or contain strategy-specific decisions.

The Trading Engine may itself be implemented as a composition of focused use cases rather than one large class. Keep each use case focused on an application goal and use the repository's object-input/object-output convention and `toResult` for outcomes.

## Source layout direction

~~~text
src/
  domain/
    portfolio/
    strategies/
      conservative/
      aggressive/
  use-cases/
    update-portfolio.js
    # other focused application workflows
  infrastructure/
    brokers/
    market-data/
~~~

This is a conceptual direction, not a request to create every directory immediately. Keep ports/interfaces in the agreed application boundary location once their contracts are designed; keep concrete exchange integrations in infrastructure.

## Shared engine, separate policies

Both initial strategy modes use the same Trading Engine and Portfolio, but they do not control a pair simultaneously:

- **Conservative (Free-Roll):** aims to recover invested quote capital while accumulating free base-asset quantity from realized net profit.
- **Aggressive:** may maintain multiple active BUY and multiple active SELL orders while it controls the pair. Its exact order planning and risk rules remain partly undecided.

There is exactly one Position per trading pair, shared by both strategies. The Trading Engine grants operational control to only one strategy at a time. A configurable `conservativeTakeoverPercent` setting defaults to `20` (20%). It switches from Aggressive to Conservative when actual executed BUY investment exceeds that percentage of the pair's planned total quote budget; open/unfilled BUY orders and their reserved quote commitment are excluded. Conservative retains control until the entire position is sold and the invested quote capital has been recovered. If the position is losing money, the strategy must stop creating new BUY orders while keeping existing SELL orders active; it must never force a sale at a loss merely to switch strategies. Aggressive resumes only after the full position is closed and the invested capital is back. During a handover, the outgoing strategy stops issuing new orders and the engine reconciles/cancels its outstanding orders before the incoming strategy acts. The exact reservation lifecycle and cross-pair account-balance coordination remain unresolved. See [Trading Strategies](./trading-strategies.md) for the behavior contract.

## Non-negotiable boundaries

- Market-price updates do not directly change Portfolio holdings.
- Order requests, acknowledgements, cancellations, rejections, and expirations without execution do not change holdings.
- Actual fills, including partial fills and actual commissions, drive Portfolio updates.
- Strategies return decisions; they do not submit exchange requests directly.
- Loss protection takes priority over strategy switching: stop new BUY orders when the position is losing money, keep existing SELL orders active, and never force a loss-making sale.
- The engine coordinates execution and shared safety; it does not decide strategy-specific trading rules.
- Domain policies and entities do not depend on exchange SDKs or raw broker payloads.
- Infrastructure adapters normalize and validate external data at the boundary.
- Do not claim exactly-once processing, restart recovery, or reconciliation until designed, implemented, and tested.

## Related documentation

- [Portfolio Domain](./domain/portfolio.md)
- [Trading Strategies](./trading-strategies.md)
- [Harvester Roadmap](../ROADMAP.md)
- [Harvester Broker Port and Adapter](./infrastructure/broker-port-and-adapter.md)


## Implementation pattern for use cases

Harvester follows a dependency-injected, factory-based style for application workflows. This is the useful part of the Clean Architecture tutorial pattern: separate domain behavior, application orchestration, external adapters, and composition. The pattern is adapted to Harvester's trading-process architecture; it does **not** require copying the tutorial's Express/MongoDB/controller stack.

The dependency direction is:

~~~text
Strategy / inbound event
        |
        v
Application use case  <------ Bootstrap composes and injects dependencies
        |
        +------> Domain factories / pure domain functions
        |
        +------> Application ports (broker, persistence, clock, journal)
                         ^
                         |
                Infrastructure adapters
                         |
                    Exchange / DB
~~~

A use case may call domain behavior and ports. Domain code must not depend on use cases, ports, adapters, or exchange SDKs. Infrastructure implements the ports; bootstrap is the composition root that selects concrete implementations.

### Example: placing an order

This is a responsibility example, not a claim that the following APIs already exist. Before implementation, inspect Harvester and shared-package contracts and use their actual names and shapes.

1. A strategy evaluates market and portfolio facts and returns a trading decision. It does not submit the order.
2. The engine/application workflow applies shared safety checks and invokes a focused `place-order` use case.
3. The use case validates/co-ordinates the application request using existing domain contracts, then calls an injected broker port.
4. A Binance adapter translates the normalized request into the Binance SDK/API format and normalizes the response.
5. The use case returns the established result type. It does not update Portfolio merely because the exchange accepted the order.

Conceptually:

~~~js
// Illustrative only: adapt names and contracts to the existing repository.
const makePlaceOrder = ({ broker, validateOrderRequest }) => {
  return async function placeOrder({ request }) {
    const validation = validateOrderRequest(request);

    if (!validation.ok) {
      return toResult({ error: validation.error });
    }

    try {
      const order = await broker.placeOrder({ request });
      return toResult({ data: order });
    } catch (error) {
      return toResult({ error });
    }
  };
};
~~~

The example deliberately shows dependency injection and orchestration only. Do not add a new `validateOrderRequest`, `broker.placeOrder`, or result shape if equivalent contracts already exist. Preserve actionable errors and follow the app's established error/result semantics; never catch an error only to disguise it as success.

The Binance adapter owns the translation from the shared order request to exchange-specific parameters. A simulator adapter, if present, should implement the same application-facing broker contract so the use case does not branch on the concrete broker. See [Broker Port and Adapter](./infrastructure/broker-port-and-adapter.md) for the chosen Harvester-owned port boundary, current `@coinzilla/brokers` method mapping, composition example, and recovery requirements.

### Example: applying an actual fill to Portfolio

`update-portfolio` is a different use case with a different trigger and invariant:

1. An adapter/event boundary normalizes an exchange execution into the shared Fill contract.
2. The `updatePortfolio({ portfolio, fill })` workflow receives that normalized fill; it does not parse a raw Binance event.
3. The use case locates/loads the relevant Portfolio or Position through its injected dependency, then delegates the state transition to the domain.
4. It persists or publishes the resulting state only through explicit ports, according to the implemented persistence contract.
5. Duplicate fills, partial fills, invalid quantities, and unsupported third-asset commissions must follow explicit domain/application rules—not be silently discarded. Third-asset commission fills are currently rejected.

**Critical accounting rule:** order submission, acknowledgement, cancellation, rejection, and market-price updates do not change holdings. Only actual normalized fills change Portfolio state, including partial fills and actual commissions. See [Portfolio Domain](./domain/portfolio.md).

### Where responsibilities belong

| Responsibility | Harvester location / owner |
| --- | --- |
| Trading invariants, value construction, calculations, deterministic policy | `src/domain/` |
| One application goal and coordination of dependencies | Focused module under `src/use-cases/` |
| Shared contracts/ports required by application workflows | Existing agreed application boundary; coordinate missing shared contracts with their owning package |
| Binance/simulator request translation and response normalization | `src/infrastructure/` |
| Dependency construction, configuration, process lifecycle | `src/bootstrap/` |
| Strategy-specific decisions | `src/domain/strategies/` (or the established strategy boundary) |
| Trigger handling for inbound events/commands | Application entry/handler boundary; add controllers only if an actual inbound protocol requires them |

Use dependency-injected functions for application workflows and plain pure functions for all meaningful deterministic calculations and policies. The current market-price workflow injects `evaluateStrategy`; the current `updatePortfolio` workflow is a direct function because it has no external dependencies. This is mandatory: meaningful pure logic must be extracted into cohesive, independently testable modules, even with one caller. Use classes only for concepts that own state and enforce lifecycle invariants. Do not introduce classes or one-function files mechanically; follow the class-versus-function rules above and the repository's cohesion standards.

### Testing pattern

- **Domain:** direct unit tests of invariants, calculations, and state transitions; no broker, database, network, or framework mocks.
- **Use case:** inject fake ports and assert the observable request, result, and error behavior. Cover rejected dependencies and invalid domain input.
- **Adapter:** test translation and normalization against the shared broker contract; mock the external SDK boundary in default tests.
- **Composition:** verify wiring where composition mistakes could cause observable failures; do not duplicate every unit test as a bootstrap test.
- **Integration:** keep external exchange tests opt-in and TESTNET-only. Default unit tests must remain offline and credential-free.

The tutorial's companion implementation is a pattern reference, not a source of Harvester APIs. Reuse its separation of concerns and explicit dependency composition, while retaining Harvester's ports-and-adapters direction, existing package contracts, exact-decimal accounting, and reliability requirements.


## Exchange market metadata

The Binance infrastructure adapter converts raw exchange filters into canonical `Market` and `TradingRules` entities. Exact decimal strings are preserved; absent or disabled optional bounds are represented as `UNSUPPORTED`, never as guessed zero-valued limits. Required price/quantity increments, minimum quantity, minimum notional, and the configured order type are validated for every enabled pair before Harvester subscribes to account events or market prices.

This is only a market-metadata readiness gate. It does not yet initialize account-wide available balances, reserve quote/base assets, reconcile open orders, or enforce all min/max constraints at the final order-submission boundary. Those are separate P0 execution-safety requirements.


## Account balance snapshot

After the user-data stream is established, bootstrap loads a canonical account snapshot and verifies that every enabled pair's base and quote assets are present. The same validation is repeated after each accounted execution. A failed or stale refresh blocks further order placement. The snapshot remains a separate view of exchange availability: wallet balances, manual inventory, and deposits are **not** copied into the strategy-owned Portfolio.

This does not yet solve account-wide budget allocation or order reservations. Multiple pairs can share a quote asset, and the order lifecycle must reserve and release free/locked balances before any strategy is allowed to submit orders.

## Strategy decision execution

The `makeExecuteStrategyDecision` use case is the application boundary between
pure strategy order intents and broker submission. It first creates and validates every local PENDING
`CanonicalOrder` in the decision, so a malformed second intent cannot leave a
first order partially submitted. It then registers each pending order before
the network request and requires a canonical broker acknowledgement with the
same client order ID. A local acknowledgement-registration failure is also
reported as an unknown broker outcome and pauses the pair. A transport failure or malformed
acknowledgement is treated as an unknown outcome: the caller pauses the pair and
must not blindly retry. The use case never decides whether to BUY or SELL and
never mutates Portfolio.

The Binance adapter prefers the broker's canonical order-placement operation
so the application receives a `CanonicalOrder` acknowledgement rather than a
raw exchange response.


## In-process Conservative trading engine

`makeConservativeTradingEngine` connects market-price events to the pure
Conservative policy and validated order-submission use case. It owns the
in-process order registry, latest market prices, last completed BUY reference
prices, and pair pause flags. Portfolio and RecoveryLedger remain owned by the
bootstrap domain workflow and are supplied through explicit callbacks.

Only order updates matching a registered Harvester client order ID are
accepted. TRADE events must contain a canonical Fill and are applied through
the injected accounting use case. A partial order fill updates actual
accounting but does not advance the strategy; the engine waits for the order's
terminal state. Unknown/manual order events pause the pair and never alter
strategy inventory. A fully filled order triggers immediate strategy
reevaluation from the latest known price.

## Conservative recovery SELL replacement

When a BUY order becomes fully filled while a recovery SELL is still active,
the engine cancels the old SELL before planning a replacement. It requires a
canonical terminal cancellation acknowledgement, then queries the broker's
canonical fills for that exact order. Every returned fill is identity-checked
and applied through the idempotent Portfolio/RecoveryLedger accounting use
case. The sum of reconciled fill quantities must equal the canceled order's
cumulative executed quantity before the strategy is allowed to continue.

If cancellation is unconfirmed, fill history is unavailable or incomplete,
the order actually filled during cancellation, or any fill does not match the
registered order, the pair pauses. No replacement SELL is submitted from
unreconciled quantities. This covers the ordinary cancel/replace path without
claiming durable restart or stream-recovery reconciliation.

## Trailing BUY lifecycle

The engine tracks whether the pair is in a trailing phase. A newly initialized
pair and a pair whose recovery SELL has completed may trail its standing BUY
upward. A BUY that has fully filled turns trailing off; the next standing BUY
is fixed while the new recovery cycle is active. A profitable recovery SELL
turns trailing back on, including for a next BUY that was already resting.

A trailing adjustment occurs only after the last traded price rises by at
least one full percentage step from the reference used for the current BUY.
The engine cancels the old BUY, queries canonical fills, and verifies the final
cumulative execution quantity. If any quantity filled during cancellation,
the fills are accounted and the pair pauses; it never submits a replacement
from uncertain inventory. A clean zero-fill cancellation is followed by a
new BUY below the current last trade, rounded down to the exchange tick.


## Operational event journal

**Current status:** Harvester composes one `@coinzilla/event-bus` instance in `src/index.js`, defines stable lifecycle names and DTO mappings, and composes `@coinzilla/journal` through `src/infrastructure/journal/prepare-optional-journal.js`. Process, configuration, broker connection, subscription, and selected user-data stream recovery lifecycle events are published from application/bootstrap boundaries. Step 5a adds actionable Conservative decisions and order submission request/acknowledgement/failure events from the application engine boundary. Journal startup remains asynchronous; events published before its subscription becomes active are not captured. Initialization/write failures do not gate bootstrap. Coordinated shutdown draining remains Step 7.

Harvester may add an application-level EventBus and an optional Journal subscriber independently of trading progress. The first use case is ordinary operational visibility: configuration validated, application started/stopped, and broker connected/disconnected. This works without enabling trading and does not require TESTNET orders or fills. Composition belongs to the process/bootstrap boundary. The domain and strategy policies must remain independent of both packages. The broker adapter continues to normalize exchange messages; application workflows publish Harvester-owned, plain-object facts at meaningful lifecycle boundaries.

The Journal is an observer, never a trading dependency:

- Journal initialization must not gate application startup or trading readiness.
- Strategy evaluation, market-price handling, order submission, execution accounting, and the serialized user-data queue must never await Journal I/O, flush, or close.
- Event publication is best-effort. A synchronous EventBus publication exception or failed result must be contained and reported without escaping into the trading workflow.
- EventBus subscriber delivery and Journal writes remain asynchronous. A successful publish means accepted for in-memory delivery, not durably persisted.
- Only selected strategy decisions and meaningful order/execution/state transitions should be published. Do not publish every market-price update.
- Publish small serializable DTOs with stable order/fill identifiers and exact decimal strings. Do not pass domain class instances, SDK objects, raw exchange payloads, credentials, or whole account snapshots.
- On normal shutdown, stop trading intake and drain the existing user-data queue before publishing final lifecycle events, flushing EventBus, and closing Journal/EventBus. A failed Journal close must not skip broker/resource cleanup.
- Document possible capture gaps before Journal becomes ready, after capacity/write failures, and on abrupt process or machine termination. Do not claim exactly-once delivery or unconditional durability.

Bot-Free-Roll is a reference for package composition, event publication, and shutdown ordering, not a template for Harvester's startup policy or domain contracts. In particular, Harvester must not inherit a startup sequence in which Journal initialization failure prevents trading.

### Initial lifecycle event contract

The application-owned event names are exported from `src/application/events/event-names.js`: `harvester.started`, `harvester.startup_failed`, `harvester.stopped`, `config.validated`, `broker.connected`, `broker.connection_failed`, `broker.disconnected`, `broker.status_changed`, `broker.subscription_established`, and `broker.subscription_failed`. `HARVESTER_EVENT_SOURCE` is `harvester`.

`src/application/events/lifecycle-event-dtos.js` maps explicit application facts into small allowlisted `toResult({ data })` DTOs. Startup/configuration DTOs contain the broker identifier, current strategy mode, enabled market symbols, and trading-enabled flag as applicable; they never copy the full trading config, credentials, or account snapshot. Failure DTOs contain a bounded error name/message only: stack and cause are omitted, and common labelled secret/token/authorization values and URL credentials are redacted. These mappings are published from the process and bootstrap lifecycle boundaries. `broker.status_changed` is limited to meaningful user-data transitions exposed by the broker callback; `recovered` means the remote stream is restored but does not prove Harvester account/order reconciliation. Journal persistence remains best-effort and can miss events published before its asynchronous subscription is active. No financial decimal values are part of these initial lifecycle DTOs; future financial event contracts must preserve canonical decimal strings.

The implementation is deliberately split into independently testable PRs and has no TESTNET prerequisite. Follow the [Journal Integration Roadmap](./JOURNAL_INTEGRATION_ROADMAP.md) and [AI implementation task](./tasks/AI_TASK_JOURNAL_INTEGRATION.md). Do not implement replay, durable trading-state recovery, an outbox, or a database as part of the initial operational journaling work.


### Strategy decision and order submission events

The Step 5a contract adds `strategy.decision`, `order.submission_requested`,
`order.submitted`, and `order.submission_failed`. Only actionable decisions
are published, after available-balance filtering; repeated NO_ACTION evaluations
are omitted. The decision DTO contains the strategy, market symbol, reference
price, and allowlisted order intents.

The order-request event is published after the local PENDING canonical order
has been registered and immediately before broker I/O. The submitted event is
published only after the broker returns a canonical acknowledgement with the
matching client order ID and the local order registry accepts it. Rejected or
unknown outcomes include only safe identifiers plus a sanitized error
name/message. The current broker result contract reports failed results as
`REJECTED_OR_UNKNOWN`; transport exceptions and acknowledgement-registration
failures are `UNKNOWN`. Do not claim a definitive exchange rejection unless the
broker port later exposes that distinction. Price and quantity remain exact decimal strings.

These events are emitted through the existing best-effort publisher. The engine
does not await subscriber delivery or Journal persistence, and publication
failure cannot prevent broker submission. Pair pause and trailing BUY
cancellation events are Step 5b; recovery SELL cancellation is Step 5c.
Execution and accounting facts remain Step 6.


### Strategy pause and order cancellation events

Step 5b adds `strategy.paused`, `order.cancelled`, and
`order.cancel_failed`. A pause event is emitted only when a market first enters
the paused set; repeated causes do not create duplicate transition events.
The current engine has no pair-resume operation, so no resume event or new
resume behavior is introduced.

Trailing BUY cancellation success is published only after a canonical
cancellation result has been accepted by the local order registry. Cancellation
failure events contain stable order identifiers, a bounded outcome
classification, and sanitized error details. A confirmed cancellation is still
recorded even if subsequent fill reconciliation fails; that later failure
remains represented by the existing pause/error behavior. Recovery SELL cancellation events are implemented separately in Step 5c, after the first pause and trailing BUY cancellation milestone. All event publication is best-effort
and does not wait for subscriber delivery or Journal persistence.


### Recovery SELL cancellation events

Step 5c publishes the same `order.cancelled` and `order.cancel_failed`
contracts for recovery SELL cancellation. Success is emitted only after the
canonical broker response has been accepted by the local order registry.
Unknown order state, unconfirmed cancellation, unregistered order, and a
non-CANCELED broker response are represented as safe failure outcomes.

The existing recovery SELL fill reconciliation remains authoritative and runs
unchanged after the cancellation response. Event publication does not wait for
Journal delivery and cannot alter accounting or pause behavior.


### Applied execution events

Step 6a adds `execution.fill_applied`. The event is published only after the
existing serialized accounting workflow succeeds and reports `applied: true`,
which means both immutable Portfolio and RecoveryLedger projections have
already been committed by the composition boundary. Duplicate/idempotent Fill
deliveries do not emit a second applied event.

The DTO contains only stable fill/order identifiers, market symbol, side,
exact decimal price and quantity values, liquidity role, optional execution
time, and commission status. It does not contain raw exchange messages,
commission objects, account snapshots, credentials, or mutable domain values.
Event publication is best-effort and is not awaited by the user-data queue.
Invalid/unowned execution and accounting-failure diagnostics remain Step 6b.


### Duplicate Fill and recovery completion events

Step 6c adds `execution.duplicate_fill` only when the accounting workflow
explicitly reports `duplicate: true`; it does not re-apply or re-publish a
duplicate as a newly applied Fill. It also adds `recovery.cycle_completed`
only after the existing recovery completion workflow reports `eligible: true`
and returns after committing the Portfolio free-quantity allocation and
RecoveryLedger cycle reset.

The recovery event contains only the market identifier, allocated free
quantity, and realized net profit. It does not expose the full ledger or
account snapshot. Both events are best-effort and are not awaited by trading
or user-data workflows.


## In-process engine transition serialization

The Conservative engine serializes its public market-price, user-data, and explicit evaluation entry points through one in-process promise tail. Each transition holds the turn across strategy evaluation, pending-order registration, broker submission and acknowledgement, cancellation, fill-history reconciliation, and accounting callbacks. Internal workflow steps call their already-held transition functions directly; they must not enqueue themselves again. A rejected transition is isolated from the tail so later events can still run. This is process-local ordering only: it is not a cross-process lock, durable queue, exactly-once delivery guarantee, or restart-recovery mechanism.

## Cancellation preconditions

Harvester validates cancellation eligibility before invoking the broker: only acknowledged OPEN and PARTIALLY_FILLED orders with a broker identifier are cancellable. PENDING, UNKNOWN, and terminal orders fail closed and pause the affected market where appropriate. The Binance adapter repeats the lifecycle check for order-shaped requests and normalizes every Binance order ID with the shared broker-package normalizeBinanceId utility before calling the exchange client. Raw ID-only adapter requests still receive identifier validation, but they do not carry enough lifecycle context for application-state eligibility checks.
