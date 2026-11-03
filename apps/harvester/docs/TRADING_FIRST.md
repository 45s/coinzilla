# Harvester: Trading First — Mandatory Agent Priority

**This document is a mandatory execution-priority rule for every AI agent working on Harvester. It overrides any roadmap ordering, architecture ambition, optional capability, or agent preference that would delay the first working trading workflow.**

## The mission

**FIRST MAKE IT WORK. THEN MAKE IT BETTER.**

Harvester's first product deliverable is a running trading application that can repeatedly execute its selected strategy on Binance TESTNET. The main task is TRADING: read configuration, receive prices, decide, place orders, process executions, and repeat.

Do not turn the first trading milestone into a persistence, journal, recovery-framework, observability, architecture, or optimization project. Those are secondary. They must not be prerequisites for implementing or demonstrating the first working trading cycle unless a specific minimal safety requirement makes a particular capability unavoidable.

## Mandatory implementation order

Agents MUST work in this order:

1. **Start the application.** Read and validate the trading configuration. Resolve enabled pairs and their strategy settings. Fail with actionable errors for invalid configuration.
2. **Connect to the broker.** Establish the required broker connection and subscribe to prices for enabled pairs. Keep exchange-specific details inside the broker adapter.
3. **Receive usable market prices.** Validate incoming prices and make the latest usable price available to the trading workflow. Handle missing/stale prices safely.
4. **Evaluate the first strategy.** Conservative is the first executable policy. Its initial BUY trails upward by one configured step; after a BUY fills, the next standing BUY is fixed; trailing resumes after a profitable recovery SELL. Recovery SELLs cover cumulative actual BUY cost, actual commissions, and minProfit while retaining keepQuantity. A new BUY fill cancels and reconciles any old recovery SELL before replacement. Do not start Aggressive first or place runtime/broker concerns inside the domain.
5. **Create and submit orders.** Turn the strategy's decision into an order intent, apply the minimum necessary TESTNET execution checks and exchange filters, and submit a real TESTNET order through the broker.
6. **Receive order updates and executions.** Process acknowledgements, partial fills, final fills, cancellations, and rejections. Update trading state only from actual executions; do not count a requested or acknowledged quantity as filled.
7. **React and repeat.** Re-evaluate when a relevant price, order-state, or fill event arrives. Place the next required order without waiting for an unrelated new price event. Continue the strategy cycle.
8. **Demonstrate the complete cycle.** Verify the full flow on TESTNET with bounded test funds and a reproducible runbook: config → price → decision → order → execution → state update → next decision/order.

The current branch has deterministic fake-broker coverage of the complete first recovery cycle and trailing/cancel-replace behavior. The first milestone is complete only when the application has demonstrably placed and managed orders and repeated the cycle on Binance TESTNET. A collection of pure calculators, entities, adapters, placeholders, NO_ACTION decisions, or disconnected use cases is not a working trading application.

## Keep startup and execution simple

The expected product workflow is the Conservative lifecycle defined in [Trading Strategies](./trading-strategies.md) and the [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Do not add extra startup phases unless they prevent a specific unsafe first order.

- A full account snapshot after every TRADE execution is **not** a default requirement. Actual canonical fills update the in-process Portfolio/RecoveryLedger.
- A clean TESTNET account is recommended for a controlled first verification, but "no open orders / zero base inventory" must not become a permanent generic startup gate. Do not silently take ownership of external inventory or orders; report ambiguity and keep strategy ownership explicit.
- Check the specific free quote/base balance and in-process commitments required for the order being submitted. Refresh account/order state when there is a concrete reason (startup facts needed by the current implementation, reconnect, or unknown outcome), not as a ritual after every fill.
- If an evaluation is temporarily deferred while an event is processed, retain and resume it automatically after that transition. Do not wait for a new price event.
- PENDING means the broker submission has not yet been acknowledged. Track it; do not cancel it or call cancellation with a missing broker order ID. After acknowledgement, validate the ID, cancel, reconcile fills that raced with cancellation, and only then replace.
- Never classify a local readiness deferral as a Binance rejection. Keep definite rejection, unknown network outcome, expected deferral, and invariant failure distinct.
- Before adding any mechanism, identify the concrete failure in Harvester's current workflow that it prevents.

## Minimum safety required for the first TESTNET cycle

Trading first does not mean careless execution. Implement the smallest safety boundary that makes the TESTNET cycle controlled and testable:

- Require explicit `HARVESTER_ENABLE_TRADING=true` and `HARVESTER_TRADING_MODE=testnet`; reject production NODE_ENV. The default remains read-only. Live trading stays disabled and cannot be enabled implicitly.
- Validate the enabled pair, current price, exchange tick/step rules, supported order type, minimum quantity/notional, and available balance needed for the specific order.
- Use stable client order identifiers where the broker supports them and retain enough in-process order state to associate updates/fills with submitted orders.
- Never submit duplicate orders because of repeated market events or duplicate execution events.
- Apply only incremental actual fills; handle partial fills without double-counting.
- Do not sell more base quantity than is available to the strategy's current in-process position and not already committed to another active SELL.
- On disconnect, stale data, unknown order outcome, unsupported commission, or inconsistent state: stop creating new orders, expose the reason, and require safe refresh/reconciliation before continuing.
- Use a clean, controlled TESTNET account for the first cycle. If pre-existing open orders or unexplained inventory make the test state ambiguous, do not trade blindly; report the blocker.

These are execution safeguards, not a demand to build a comprehensive production reconciliation or persistence subsystem before the first TESTNET order.

## Explicitly secondary — defer until the first TESTNET cycle works

Unless one narrowly scoped part is essential to prevent an immediate unsafe TESTNET action, agents MUST NOT prioritize or block trading implementation on:

- Journal read/replay integration or a comprehensive event/audit journal.
- Durable Portfolio, RecoveryLedger, reservation, and execution-identity persistence.
- Full process-restart recovery and exactly-once delivery guarantees.
- Comprehensive reconciliation of all historical exchange executions and long-term account history.
- Generic recovery frameworks, storage abstractions, or app-local persistence frameworks.
- Advanced health dashboards, alerting, operator controls, analytics, and performance optimization.
- Aggressive strategy, multiple strategy modes, or additional trading features.
- Refactoring or expanding architecture solely for theoretical future extensibility.

The shared Journal package already exists and may be used later. Its existence does not make Journal integration the current task. Do not implement Journal consumers, schemas, replay, or persistence while the main trading workflow is still missing.

## What to do when a secondary gap is discovered

1. Ask: does this gap directly prevent the minimum TESTNET trading workflow, or create an immediate material risk in that workflow?
2. If **no**, record it under the deferred/hardening roadmap and continue implementing trading.
3. If **yes**, implement only the smallest targeted safeguard needed for the current TESTNET cycle. Do not expand it into a generic subsystem.
4. Explain the concrete order-flow failure the safeguard prevents and add focused tests.
5. Return immediately to the next missing step in the trading workflow.

Do not use "production readiness", "future recovery", "complete architecture", or "best practice" as vague reasons to postpone order placement. Identify the specific failure, the minimum necessary control, and the narrowest implementation.

## Engineering standards still apply

Follow the canonical [repository engineering standards](../../../ENGINEERING_STANDARDS.md) and [Harvester agent instructions](../AGENTS.md). This document defines Harvester's product priority and TESTNET execution sequence only.
## Current implementation status

The Conservative policy and in-process TESTNET workflow are implemented and have deterministic fake-broker coverage for initial BUY, trailing replacement, BUY-driven SELL replacement, full recovery SELL, and free-inventory allocation. The remaining first-milestone proof is a real Binance TESTNET run. The committed default config enables only ZROUSDT. Use the [controlled TESTNET runbook](../README.md#controlled-testnet-runbook); do not use production credentials.

## Definition of done for the first trading milestone

All of the following must be demonstrated, not merely described:

- [ ] App starts from documented instructions and loads/validates real configuration.
- [ ] Enabled market price subscriptions connect and deliver validated prices.
- [ ] Conservative strategy evaluates actual current context and produces actionable order intents.
- [ ] Broker adapter submits actual bounded TESTNET orders.
- [ ] Order acknowledgements and all execution updates are received and normalized.
- [ ] Partial and final fills update Position/Portfolio correctly using actual commission facts.
- [ ] The strategy reacts to fills/order transitions and submits the next required order.
- [ ] At least one complete BUY → fill → SELL → fill → next-cycle sequence succeeds on TESTNET.
- [ ] Disconnect/unknown-outcome behavior pauses new orders rather than blindly duplicating them.
- [ ] Tests, CI, and a concise TESTNET runbook support the demonstrated behavior.
- [ ] Live trading remains disabled.

Only after this definition of done is met should the team move the main priority to durable Journal integration, restart recovery, comprehensive reconciliation, operational hardening, or Aggressive strategy work.

## Required agent progress report

At the end of each task, state:

1. Which exact step of the mandatory trading workflow was completed.
2. What now works end to end and what is still only a foundation or placeholder.
3. The next missing trading step.
4. Why any secondary work was necessary to unblock that step.
5. Exact tests/checks run and their outcomes.

