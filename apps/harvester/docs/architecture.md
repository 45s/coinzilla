# Harvester Architecture

## Purpose

Harvester uses one shared Trading Engine with multiple strategy policies. The engine coordinates trading workflows; a strategy decides what trading action should be taken. This lets Conservative (Free-Roll) and Aggressive use the same execution, broker, and portfolio capabilities without sharing their trading rules.

This document records the current architectural direction. It does not define implementation APIs or settle the strategy and portfolio decisions listed in the roadmap.

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

### Implemented market-price and Portfolio flow

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

Both initial strategy modes use the same Trading Engine and Portfolio:

- **Conservative (Free-Roll):** aims to recover invested quote capital while accumulating free base-asset quantity from realized net profit.
- **Aggressive:** may maintain multiple active BUY and multiple active SELL orders. Its exact order planning, inventory allocation, and risk rules remain undecided.

Do not assume Aggressive is a particular grid algorithm, that each BUY fill automatically creates a SELL, or that both strategies can safely own the same pair simultaneously. Those are unresolved product/domain decisions.

## Non-negotiable boundaries

- Market-price updates do not directly change Portfolio holdings.
- Order requests, acknowledgements, cancellations, rejections, and expirations without execution do not change holdings.
- Actual fills, including partial fills and actual commissions, drive Portfolio updates.
- Strategies return decisions; they do not submit exchange requests directly.
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

The Binance adapter owns the translation from the shared order request to exchange-specific parameters. A simulator adapter, if present, should implement the same application-facing broker contract so the use case does not branch on the concrete broker. See [Broker Port and Adapter](./infrastructure/broker-port-and-adapter.md) for the chosen Harvester-owned port boundary, current `@coinzilla/brokers` method mapping, composition example, and recovery requirements. See [Broker Port and Adapter](./infrastructure/broker-port-and-adapter.md) for the chosen Harvester-owned port boundary, current `@coinzilla/brokers` method mapping, composition example, and recovery requirements.

### Example: applying an actual fill to Portfolio

`update-portfolio` is a different use case with a different trigger and invariant:

1. An adapter/event boundary normalizes an exchange execution into the shared Fill contract.
2. The `updatePortfolio({ portfolio, fill })` workflow receives that normalized fill; it does not parse a raw Binance event.
3. The use case locates/loads the relevant Portfolio or Position through its injected dependency, then delegates the state transition to the domain.
4. It persists or publishes the resulting state only through explicit ports, according to the implemented persistence contract.
5. Duplicate fills, partial fills, invalid quantities, and commissions in third assets must follow explicit domain/application rules—not be silently discarded.

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
