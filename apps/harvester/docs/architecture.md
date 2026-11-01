# Harvester Architecture

## Purpose

Harvester uses one shared Trading Engine with multiple strategy policies. The engine coordinates trading workflows; a strategy decides what trading action should be taken. This lets Conservative (Free-Roll) and Aggressive use the same execution, broker, and portfolio capabilities without sharing their trading rules.

This document records the current architectural direction. It does not define implementation APIs or settle the strategy and portfolio decisions listed in the roadmap.

## Architectural roles

| Concept | Responsibility | Architectural role |
| --- | --- | --- |
| Portfolio | Holds spot positions and applies fill-driven state changes | Domain entity |
| Position | Tracks holdings and accounting for its defined scope | Domain entity |
| Conservative strategy | Defines Free-Roll capital-recovery and free-asset rules | Domain policy |
| Aggressive strategy | Defines rules for managing multiple BUY and SELL orders | Domain policy |
| Trading Engine | Coordinates market updates, strategy evaluation, order workflows, and fill processing | Application layer / orchestrator |
| Use case | Performs an application goal by coordinating domain objects and ports | Application layer |
| Broker adapter | Communicates with an exchange and translates exchange-specific messages | Infrastructure / interface adapter |

These are responsibility boundaries, not a requirement that every concept must be represented by a class. The Trading Engine is not a Portfolio-like domain entity. A strategy may eventually be represented by an object, module, or function; calling it a domain policy describes its business responsibility, not its implementation form.

## Entity versus policy

A **domain entity** represents something whose state and business invariants matter to the domain. Portfolio and Position are examples: actual executions change their state, and their rules govern valid accounting transitions.

A **domain policy** expresses a business decision rule: given relevant facts, what action should be taken? Conservative and Aggressive are policies because they define different trading decisions. They do not need exchange connectivity or order-submission mechanics.

A policy can use domain entities such as Portfolio as input. It should not own broker clients, WebSocket subscriptions, timers, or exchange SDK objects.

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
