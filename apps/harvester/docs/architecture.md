# Harvester Architecture

> **Audit companion:** See [DDD and Clean Architecture Audit](./DDD_CLEAN_ARCHITECTURE_AUDIT.md) for the source-based assessment, scorecard, current architectural risks, and sequenced follow-up roadmap. The audit is pinned to the source revision stated in that report; it is not a live status feed. The roadmap remains authoritative for delivery priority and implementation status.
>
> **Documentation rule:** this guide contains both stable architecture rules and implementation examples/snapshots. Treat claims about what is currently wired or not wired as time-sensitive; verify them against the current source and [Harvester Roadmap](../ROADMAP.md). Historical snapshots must not be used as current implementation instructions.

## Purpose

Harvester uses one shared Trading Engine with multiple strategy policies. The engine coordinates trading workflows; a strategy decides what trading action should be taken. This lets Conservative and Aggressive use the same execution, broker, and portfolio capabilities without sharing their trading rules.

This document records the current architectural direction. It does not define implementation APIs or settle the strategy and portfolio decisions listed in the roadmap.

## Product priority: make the trading loop work first

The architecture exists to deliver a running trading application, not to postpone it. The mandatory first workflow is: load configuration → connect and subscribe to enabled-market prices → evaluate Conservative → validate and submit a broker order → process order updates and actual fills → update trading state → evaluate again and place the next required order. See [Trading First](./TRADING_FIRST.md), which takes precedence over optional architecture work.

For the first controlled TESTNET cycle, implement only the minimum execution safeguards needed for valid orders, balance/market-rule checks, fill correctness, duplicate prevention, and safe pause on uncertain state. Journal integration, durable state, comprehensive restart recovery/reconciliation, dashboards, optimization, and Aggressive are later work. Do not build those systems before the actual strategy-to-order-to-execution path exists and works. Keep the code simple and use existing contracts; do not add abstractions solely for hypothetical future needs.

## Product rule: DDD must not delay the trading loop

Harvester implements the Conservative strategy through its own domain, application, and infrastructure boundaries. Keep the lifecycle simple and improve it incrementally without changing approved financial behavior.

The reference workflow is config → broker connection/price subscription → price → strategy decision → BUY/SELL submission → execution report → actual-fill accounting → next decision. DDD means pure strategy/domain rules, state-owning entities, injected use cases, broker adapters, and bootstrap composition. It does not mean adding a new layer, state machine, persistence store, or reconciliation process for every event.

**Account/readiness rule:** use in-process actual-fill accounting for the ordinary strategy loop. Do not fetch a full account snapshot after each execution report unless a concrete broker-state uncertainty requires it. Perform the minimum specific free-balance/market-rule checks before submission. A clean TESTNET account is a controlled-test recommendation, not a reason to permanently prevent app startup. Never silently adopt external balances/orders as strategy-owned inventory.

**Pending-order rule:** register PENDING before submission so events can be correlated, but keep it non-cancellable until broker acknowledgement provides a validated broker order ID. If a replacement is needed while submission is pending, defer that replacement intent; after acknowledgement, cancel and reconcile fills before placing the replacement.

**Cancellation-outcome rule:** the broker reports `NOT_SENT` only when a local guard proves the exchange cancellation RPC was never invoked. Harvester preserves the last known canonical order state for that result, publishes `order.cancel_failed` with outcome `NOT_SENT`, and still pauses the pair. A failed/ambiguous state-changing RPC remains `UNKNOWN` / `UNCONFIRMED` until authoritative reconciliation. Harvester accepts `NOT_SENT` only on an unsuccessful broker result (`ok: false`) with that exact classification. A success-shaped, contradictory, missing, or unknown classification is treated as unconfirmed and remains fail-closed.

Before changing an execution path, compare it with the approved Conservative Domain Specification and the current Harvester implementation. Keep only the minimum safeguards that prevent a demonstrated duplicate, oversell, double-accounting, or unknown-outcome hazard. Do not build generic polling, sleeps, or broad reconciliation to handle ordinary event ordering.

## Architectural roles

| Concept | Responsibility | Architectural role |
| --- | --- | --- |
| Portfolio | Holds spot positions and applies fill-driven state changes | Domain entity |
| Position | Tracks holdings and quote cash flow for its defined market scope | Domain entity |
| Conservative strategy | Defines Conservative capital-recovery and retained-inventory rules | Domain policy |
| Aggressive strategy | Defines rules for managing multiple BUY and SELL orders | Domain policy |
| Trading Engine | Coordinates market updates, strategy evaluation, order workflows, and fill processing | Application layer / orchestrator |
| Use case | Performs an application goal by coordinating domain objects and ports | Application layer |
| Broker adapter | Communicates with an exchange and translates exchange-specific messages | Infrastructure / interface adapter |

These are responsibility boundaries, not a requirement that every concept must be represented by a class. The Trading Engine is not a Portfolio-like domain entity. A strategy policy is implemented as a plain pure function when its decision is deterministic. Calling it a domain policy describes its business responsibility; it does not imply a class or stateful strategy object.

## Volatility market-data intake (current implementation)

The runtime composes `createCandleHistoryService` after the existing price intake. It subscribes to each enabled market's one-minute Kline stream before requesting 101 historical candles, retains up to 100 completed candles, buffers live events during warm-up, and backfills detected gaps through the application broker port. It computes ATR(14), NATR and the current/reference ratio using the previous 60 NATR observations. The per-market snapshot is available through runtime `getVolatilityData({ symbol })`.

The candle-history service allows one 1-minute interval plus a 5-second grace before marking its Kline feed stale. This timeout is separate from the trading engine's 5-second market-price and order-book freshness gates. The runtime sends snapshots to the per-market volatility protection state machine; PROTECTED and RECOVERING block ordinary strategy actions, the central submission gate permits only explicitly marked recovery SELLs, and only Harvester-owned active BUYs are eligible for protection cancellation. Existing recovery SELLs and their accounting remain active. Initial ratio thresholds are provisional pending offline historical validation.

## Operational notifications

Telegram is an optional outbound observer composed at the process boundary. The named `appConfig` export in `apps/harvester/config/index.js` owns the `notifications.telegram` profile, per-event overrides, market filter, and enabled switch. It imports the named `NOTIFICATIONS_TG_PROFILES` constants from `apps/harvester/config/notifications-tg-profiles.js`; the validator checks the selected identifier at runtime. Harvester resolves that policy, maps application events, and formats Harvester-specific Telegram messages; `@coinzilla/notifiers` owns generic event subscription, bounded serialized delivery queueing, transport delivery, and transport validation. The notifier package must not own Harvester event semantics or message templates. The domain and trading engine must not depend on Telegram or its credentials.

Profiles are `minimal`, `trader`, `verbose`, and `custom`. Per-event overrides merge with the chosen profile; `markets: []` means all markets. Critical startup, broker-disconnect, order-failure, pair-pause, recovery-failure, account-safety, blocked user-data readiness, and confirmed readiness-restoration alerts cannot be disabled and bypass market filters. The stable Harvester lifecycle vocabulary includes `user_data.readiness_changed`; transitions are validated by the dedicated `user-data-readiness-event-dto.js` application event mapper before publication. A recovered user-data transport remains explicitly BLOCKED until authoritative application reconciliation and broker-wide acknowledgement complete. `recoveryFailed` and `executionNormalizationFailed` statuses alert even if the broker omits the recovery-required flag; `rpcError` and `terminated` alerts require an explicit recovery-required flag, while retry-progress and diagnostic-only RPC errors are suppressed. Blocked recovery-cycle outcomes alert; expected sell-through continuation does not. Telegram bot token and chat ID remain environment-only secrets.

The table below is the canonical icon contract for **producer-backed outbound Telegram notifications**. It describes the message actually formatted after the Harvester event bridge maps a source event; it is not a list of every formatter key. Order-failure icons use the bridge's explicit `operation` and `side` fields. Account-safety icons use the mapped alert `category`, because several distinct source events share the `account.safety_alert` notification name.

| Active Telegram notification | Producer-backed condition | Icon |
| --- | --- | :---: |
| Bot started | `bot.started` | 🚀 |
| Bot stopped | `bot.stopped` | 🔒 |
| Startup failed | `bot.startup_failed` | 🛠️ |
| Market paused | `bot.pair_paused` | ⏸️ |
| Broker disconnected | `broker.disconnected` | 💤 |
| Broker subscription failed | `account.safety_alert` · `broker-subscription-failed` | 🚨 |
| User-data stream ready | `bot.user_data_ready` | 🔗 |
| User-data readiness blocked | `account.safety_alert` · `user-data-readiness-blocked` | 🚨 |
| Reconnected; reconciliation pending | `account.safety_alert` · `user-data-reconnected-reconciliation-pending` | 🚨 |
| User-data recovery failed | `account.safety_alert` · `user-data-recovery-failed` | 🚨 |
| User-data stream terminated | `account.safety_alert` · `user-data-stream-terminated` | 🚨 |
| Execution normalization failed | `account.safety_alert` · `user-data-execution-normalization-failed` | 🚨 |
| User-data stream error | `account.safety_alert` · `user-data-stream-error` | 🚨 |
| Order submission failed — BUY / SELL | `order.failed` · `operation=submission` | ❌ / ❌ |
| Order cancellation failed — BUY / SELL | `order.failed` · `operation=cancellation` | 🚫 / ⛔ |
| Fill received — BUY / SELL | `fill.received` | ✔️ / 💸 |
| Recovery completed | `bot.recovery_completed` | 💰 |

The user left five notifications without a replacement selection. They deliberately retain their previous formatter icons until a separate choice is made:

| Notification | Existing icon retained |
| --- | :---: |
| Recovery cycle blocked | 🚨 |
| Execution accounting failed (`bot.recovery_failed`) | 🚨 |
| Unowned order detected | ⚠️ |
| Invalid fill | ⚠️ |
| Account-wide open orders blocked | 🚨 |

Successful order submission, successful order cancellation, broker connected, and `order.filled` remain formatter/policy vocabulary only: the current Harvester Telegram bridge has no producer mapping that sends them. They are therefore not part of the active notification icon contract. Fill direction is taken from the canonical applied-fill event and carried through the Telegram bridge; notification formatting does not affect trading or accounting.

Notification setup and delivery are best-effort. An explicit `enabled: false` or missing credentials disables notifications; malformed application configuration fails normal configuration validation rather than silently falling back. Transport/setup failures remain isolated from the trading workflow. Notifications must never be awaited from order submission, fill accounting, strategy evaluation, or recovery transitions. Telegram delivery failures/overflow are observable through structured logs containing immutable process-local delivery counters, and a final summary is logged after shutdown drains and closes the subscriber; the notifier does not send recursive health alerts to itself. During process shutdown, stop event production, flush accepted EventBus work, and drain/close the notifier before closing the EventBus. Delivery is not durable and must not be represented as an audit record or trading-state authority. Automatic retries remain disabled because an ambiguous timeout may duplicate a Telegram message.

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

**Shared repricing safety invariant:** all strategy BUY repricing paths must consult
the latest Portfolio Position inside the serialized engine transition before
threshold evaluation or BUY cancellation/replacement. Repricing is allowed only
when active `baseQuantity.amount` is exactly zero (or the Position is absent);
retained `freeBaseQuantity` does not count. Conservative trailing BUY already
enforces this. Aggressive grid repricing is not executable yet and must use the
same gate when implemented.

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

The diagram is a responsibility flow, not a mandated synchronous call sequence. The accepted target contract for process-restart durable facts and readiness is defined in [ADR-0001](./architecture/decisions/0001-application-owned-recovery-facts.md); runtime restoration and replay remain disabled until the roadmap's later implementation and verification steps are complete.

### Historical implementation snapshot — superseded

> **Historical note:** The following paragraphs describe an earlier Aggressive-first implementation snapshot. They are retained only as migration history and are not authoritative for current runtime behavior. In particular, statements below that the user-data stream is not normalized into canonical fills and that Aggressive is the only composed policy are obsolete. Use the [Harvester Roadmap](../ROADMAP.md) for current implementation status and the [DDD/Clean Architecture audit](./DDD_CLEAN_ARCHITECTURE_AUDIT.md) for the assessment and documentation follow-up.

Bootstrap dynamically imports the named `appConfig` export from `config/index.js`, validates it before connecting the selected broker, and subscribes only to enabled markets. The Binance adapter receives the broker package's normalized aggregate-trade stream; the application validates the symbol, decimal price string, and event timestamp before invoking the strategy. A failed subscription aborts startup and cleans up subscriptions already created. Shutdown unsubscribes before disconnecting.

For TESTNET trading, bootstrap establishes the aggregate-trade subscription first, then requests the current Binance `ticker.price` snapshot through the existing broker `getPrices()` operation. If no fresh WebSocket event has already arrived, the snapshot is validated and immediately seeds Conservative evaluation; if neither source provides a usable price, startup fails and cleans up. Binance `ticker.price` is a request/response WebSocket API operation (not an HTTP REST call) and does not include a source timestamp, so Harvester stamps it at receipt. Aggregate-trade timestamps are checked against a 5-second maximum age and 1-second future-clock tolerance before evaluation. Cached prices are checked again before later order decisions, including decisions resumed by order/fill events. Stale events are ignored without canceling existing standing orders; a fresh price is required before another strategy decision. The engine enforces cached-price freshness at both order-submission gates, including after PENDING registration and before each action in a multi-order decision. If the price expires, the pending local record is removed and broker I/O is deferred until a fresh event. This does not add timers or persistence.

Bootstrap composes the plain pure function `evaluateAggressiveStrategy`, an in-memory immutable Portfolio, and the `updatePortfolio` application workflow. Each strategy evaluation receives the latest Portfolio snapshot. A normalized Fill can be applied through runtime.updatePortfolio({ fill }); the current runtime workflow is CG-owned and resolves its stable CG Position identity internally. a successful transition replaces the current snapshot and becomes visible to the next market-price evaluation. Portfolio updates are serialized within the process to prevent concurrent fill callbacks from overwriting one another.

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

Conservative and Aggressive are the two CG strategy modes. They use the same Trading Engine and CG-owned Position, but do not control a pair simultaneously:

- **Conservative:** aims to recover invested quote capital while accumulating free base-asset quantity from realized net profit.
- **Aggressive:** may maintain multiple active BUY and multiple active SELL orders while it controls the pair. Its exact order planning and risk rules remain partly undecided.

Conservative and Aggressive share one CG-owned Position per trading pair; they are modes within CG, and the Trading Engine grants control to only one CG mode at a time. RS may own independent Position(s) for the same market in the shared Portfolio; it does not receive a duplicate wallet or custody balance. A configurable `conservativeTakeoverPercent` setting defaults to `20` (20%). It switches from Aggressive to Conservative when actual executed BUY investment exceeds that percentage of the pair's planned total quote budget; open/unfilled BUY orders and their reserved quote commitment are excluded. Conservative retains control until the entire position is sold and the invested quote capital has been recovered. If the position is losing money, the strategy must stop creating new BUY orders while keeping existing SELL orders active; it must never force a sale at a loss merely to switch strategies. Aggressive resumes only after the full position is closed and the invested capital is back. During a handover, the outgoing strategy stops issuing new orders and the engine reconciles/cancels its outstanding orders before the incoming strategy acts. The exact reservation lifecycle and cross-pair account-balance coordination remain unresolved. See [Trading Strategies](./trading-strategies.md) for the behavior contract.

### Planned Recovery Seller and Conservative concurrency

The current Conservative/Aggressive handover above describes those two existing strategy modes; it is not a general rule that only one strategy may operate a market. The planned Recovery Seller requirement explicitly allows RS and CG to run concurrently, including on the same market when both are enabled.

For that integration:

- Keep one shared Portfolio aggregate that may contain multiple independent strategy-owned Positions per market; keep RS/CG policy state and Position attribution separate.
- Preserve originating-strategy identity on every order and canonical fill.
- Serialize order submission and Portfolio/strategy-attribution commits through the shared Trading Engine.
- Aggregate quote and base reservations across both strategies before accepting any new intent.
- Resolve competing intents deterministically; never rely on timing to avoid double-spend or oversell.
- Pause/disable remains strategy-scoped and must not silently stop the other strategy.

This is a target requirement, not current runtime behavior. See the [Recovery Seller Domain Specification](./domain/recovery-seller-domain-specification.md) and [implementation roadmap](./domain/recovery-seller-implementation-roadmap.md).

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
- [Broker–Harvester Trading Flow](./architecture/BROKER_HARVESTER_TRADING_FLOW.md)

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
2. The `updatePortfolio({ portfolio, fill, positionId, strategyId })` workflow receives that normalized fill and its resolved owner; it does not parse a raw Binance event.
3. The use case supplies the originating stable `positionId` and `strategyId` from order ownership; Portfolio applies the fill to exactly that Position and records the attribution with its global fill identity.
4. It persists or publishes the resulting state only through explicit ports, according to the implemented persistence contract.
5. Duplicate fills, partial fills, invalid quantities, and third-asset commissions must follow the canonical domain rules—not be silently discarded. A third-asset commission requires reliable quote-currency valuation; otherwise the affected accounting transition fails closed. See [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

**Critical accounting rule:** order submission, acknowledgement, cancellation, rejection, and market-price updates do not change holdings. Only actual normalized fills change Portfolio state, including partial fills and actual commissions. See [Portfolio Domain](./domain/portfolio.md).

### Where responsibilities belong

| Responsibility | Harvester location / owner |
| --- | --- |
| Trading invariants, value construction, calculations, deterministic policy | `src/domain/` |
| Market-data timestamp freshness | `src/domain/market/is-market-data-fresh.js`; caller supplies current time and policy bounds |
| Candle shape validation, UTC interval alignment, contiguous-series validation and ATR/NATR metric composition | `src/domain/market/volatility-candle.js`; indicator formulas are delegated to `@coinzilla/indicators` |
| Historical/live Kline warm-up, buffering, freshness snapshots and bounded gap backfill | `src/use-cases/create-candle-history-service.js`; uses the application-owned BrokerPort and owns no exchange protocol details |
| One application goal and coordination of dependencies | Focused module under `src/use-cases/` |
| Shared contracts/ports required by application workflows | Existing agreed application boundary; coordinate missing shared contracts with their owning package |
| Binance/simulator request translation and response normalization | `src/infrastructure/` |
| Dependency construction, configuration, process lifecycle | `src/bootstrap/` |

`src/index.js` is the process entry/composition root. It creates the immutable process identity and EventBus, loads and validates configuration, acquires the host/global process locks, verifies the existing ADR-0001 Operational State Store before broker startup, starts the Journal observer, and passes the same Operational State Store into `startHarvester`. A clean `PROCESS_STOPPED` fact is appended only after runtime shutdown is confirmed; Journal close and process-lock release retain their existing failure gates. The Journal is an operational observer, not the restart-recovery authority.

`src/bootstrap/start-harvester.js` composes the application runtime: it resolves enabled markets and exchange settings, prepares optional Telegram operator control, verifies/projects existing Operational State Store records (and refuses a second process session while restart restoration is disabled), records the configuration/process-start facts, connects the Binance adapter, and creates the Portfolio workflow, account-snapshot manager, Conservative engine, user-data event/status/recovery handlers, market-data subscriptions, candle-history service, and shutdown handler. The sequence is source-defined: load exchange market metadata; activate the engine; start the optional operator adapter; establish user-data subscription and pass the durable PREFLIGHT account/open-order audit; then subscribe to market data and start candle history. Same-process transport recovery repeats the RECOVERY account/open-order audits before broker recovery acknowledgement. Shutdown stops operator polling, delegates order/user-data cleanup to the shutdown handler, writes the trading-enabled CLOSING account audit, disconnects, and only then records the Operational State Store process-stop record.

### Operational State Store implementation

The ADR-0001 Operational State Store boundary is split between deterministic serialization and the filesystem adapter:

- `src/infrastructure/operational-state/operational-state-canonical.js` contains pure helpers for bounded canonical JSON cloning/serialization, SHA-256 record digests, canonical timestamp normalization, and canonical non-empty-string validation. Object keys are recursively sorted, array order is retained, economic decimals remain strings, and every numeric value must be a safe integer other than negative zero. Negative zero is rejected before JSON serialization can silently turn it into ordinary zero.
- `src/infrastructure/operational-state/create-file-operational-state-store.js` owns the filesystem protocol and the versioned fact-type schema. It creates genesis only through explicit initialization, requires private directory/file permissions, serializes operations per resolved directory, appends and syncs the fact record before its matching committed-head checkpoint, verifies both streams before acknowledging durability, and poisons the current store instance after an uncertain write.
- `src/domain/time/is-canonical-non-negative-safe-integer.js` is the shared pure timestamp guard used by MarketPrice, AccountSnapshot, VolatilityCandle, account reconciliation, and market-history coverage/fact recording. It accepts zero and positive safe integers, and rejects negative zero, negative, fractional, unsafe, and non-number values before they cross domain or persistence boundaries.
- Genesis initialization and each new fact append capture the injected clock once. The store accepts either a `Date` or an already-canonical UTC ISO-8601 string, and an append uses that same captured timestamp for market-history future-time validation and the record envelope. The Operational State Store projector validates operator pause facts as session-bound audit records but excludes them from the restart candidate; only durable strategy pauses and sticky safety blockers are projected. An idempotent duplicate returns the existing record without consuming a new clock value.
- `src/infrastructure/operational-state/project-harvester-operational-state.js` validates the verified stream and projects facts into candidate recovery events; it does not make the Journal authoritative or enable runtime restart restoration.

These boundaries are covered by the Operational State Store regression suite and the independent pure-helper tests in `operational-state-canonical.test.js`. The canonical JSON helper is application/domain-specific: do not move it to `@coinzilla/utils` because its bounds and secret-key rejection are part of the ADR-0001 durable evidence contract.

Broker adapter construction, port validation, connection, and failure cleanup are coordinated by `src/bootstrap/broker/connect-broker.js`. Broker intake teardown and disconnect aggregation are composed by `src/bootstrap/broker/cleanup-broker.js`. Account balance/open-order capture and mandatory Operational State Store plus Journal audit publication are coordinated by `src/bootstrap/account/create-account-snapshot-manager.js`; it owns broker reads and lifecycle barriers, not strategy inventory. Configured market filters and enabled-pair readiness are loaded by `src/bootstrap/market/load-market-metadata.js`; disabled-pair metadata is retained for account-audit asset coverage without enabling trading. The normalized user-data event queue and observer boundary are handled by `src/bootstrap/user-data/create-user-data-event-handler.js`; the process coordinator supplies mutable readiness state and safety actions. User-data subscription establishment and the durable PREFLIGHT readiness gate are coordinated by `src/bootstrap/user-data/subscribe-to-user-data.js`. Broker status/readiness transitions are handled by `src/bootstrap/user-data/create-user-data-status-handler.js`; transport recovery remains distinct from application reconciliation. The application recovery task and its WebSocket API/stream sequence plus durable RECOVERY audit barriers are coordinated by `src/bootstrap/user-data/create-user-data-recovery-handler.js`. The shutdown sequence is owned by `src/bootstrap/shutdown/create-shutdown-handler.js`, including shared in-flight shutdown completion for concurrent stop callers. Market-price/book subscription setup and initial Binance WebSocket API `ticker.price` request/response seeding are composed by `src/bootstrap/subscriptions/subscribe-to-market-data.js`, which owns the WebSocket Streams-before-WebSocket API request/response ordering.
| Strategy-specific decisions | `src/domain/strategies/` (or the established strategy boundary) |
| Trigger handling for inbound events/commands | Application entry/handler boundary; add controllers only if an actual inbound protocol requires them |

Startup configuration validation and exchange selection are coordinated by `src/bootstrap/config/resolve-harvester-options.js`. `TRADING_MODE` is mandatory and selects Binance TESTNET or LIVE independently of `NODE_ENV`; there is no exchange-mode runtime profile, no broker selector, or read-only startup fallback. Telegram notification profiles are separate and do not affect exchange selection.

Use dependency-injected functions for application workflows and plain pure functions for all meaningful deterministic calculations and policies. The market-price workflow injects `evaluateStrategy`. The state-owning `createPortfolioWorkflow` factory in `src/use-cases/create-portfolio-workflow.js` sends canonical fill accounting and recovery-cycle completion through the same serialized transition queue. A completion therefore observes every earlier accepted fill and cannot durably reset a stale Portfolio/RecoveryLedger snapshot while a fill append is still pending. It requires a canonical, fully filled terminal SELL for the same market through the pure `src/domain/orders/assert-terminal-recovery-sell-order.js` guard. The workflow stages both immutable projections, commits the durable cycle outcome first, and only then publishes the paired in-memory reset. Third-asset commission baselines are durably recorded before the corresponding `EXECUTION_FILL_APPLIED` fact; a failed optional baseline write does not discard a valid fill, but the later account audit fails closed. Use classes only for concepts that own state and enforce lifecycle invariants. Do not introduce classes or one-function files mechanically; follow the class-versus-function rules above and the repository's cohesion standards.

### Testing pattern

- **Domain:** direct unit tests of invariants, calculations, and state transitions; no broker, database, network, or framework mocks.
- **Use case:** inject fake ports and assert the observable request, result, and error behavior. Cover rejected dependencies and invalid domain input.
- **Adapter:** test translation and normalization against the shared broker contract; mock the external SDK boundary in default tests.
- **Composition:** verify wiring where composition mistakes could cause observable failures; do not duplicate every unit test as a bootstrap test.
- **Integration:** keep external exchange tests opt-in and TESTNET-only. Default unit tests must remain offline and credential-free.

The tutorial's companion implementation is a pattern reference, not a source of Harvester APIs. Reuse its separation of concerns and explicit dependency composition, while retaining Harvester's ports-and-adapters direction, existing package contracts, exact-decimal accounting, and reliability requirements.

## Exchange market metadata

The Binance infrastructure adapter converts raw exchange filters into canonical `Market` and `TradingRules` entities. Exact decimal strings are preserved; absent or disabled optional bounds are represented as `UNSUPPORTED`, never as guessed zero-valued limits. Required price/quantity increments, minimum quantity, minimum notional, and the configured order type are validated for every enabled pair before Harvester subscribes to account events or market prices.

Startup readiness also checks configured pair values against the exchange-reported assets and filters: `orderQuantity` is rounded down by the actual base-asset quantity increment and the effective quantity must satisfy supported minimum/maximum quantity bounds; the quote-asset `investment` allocation must be at least the minimum notional. The market symbol must match the configured pair. Applicable dynamic, account-level, exchange-wide, and unknown constraints are retained as immutable diagnostics; their presence alone does not block readiness. Binance remains authoritative for those additional constraints and a definite rejection is classified as a definite exchange filter rejection, never as an ambiguous submission. Missing or malformed authoritative metadata still fails closed. This is an early configuration-feasibility check, not a substitute for validating concrete orders.

Immediately before submission, `validateOrderAgainstTradingRules` independently checks each actual order's price and quantity increments and all supported minimum/maximum price, quantity, and notional bounds using exact decimal arithmetic. Account-wide available balances, quote/base reservations, and authoritative post-only crossing validation remain separate execution-safety requirements.

## Account balance snapshot

The broker account read returns the exchange's full raw balance response, but `create-account-snapshot-manager.js` constructs the runtime `AccountSnapshot` and durable audit from a deliberately bounded asset set:

- Base and quote assets from every configured market in `marketMetadata`, including disabled-pair metadata retained for audit coverage (not only currently enabled pairs).
- A third-asset commission asset only after a positive commission in that asset is observed on an applied fill and its original baseline is successfully published.

During PREFLIGHT, the manager temporarily retains the raw balance list in an in-memory lookup map. That map exists only so a later third-asset fee can be compared with its original PREFLIGHT free/locked/total balance. Unrelated wallet balances are not copied into the runtime `AccountSnapshot`, Operational State Store account-snapshot record, or Journal DTO; they are not strategy-owned inventory. The targeted `COMMISSION_BASELINE` event contains exactly one newly observed third-asset commission balance, and that asset is then included in subsequent tracked snapshots. The Operational State Store record schema rejects a targeted baseline unless its audit is `COMPLETE` and its balances array contains exactly one asset. The baseline fact must precede the first durable execution-fill fact that charges that asset; a later snapshot cannot retroactively explain an earlier fee debit.

The lifecycle phases are distinct: startup publishes durable `PREFLIGHT` account and account-wide open-order audits; same-process user-data reconnect publishes separate `RECOVERY` account and open-order audits before broker recovery acknowledgement; trading-enabled graceful shutdown publishes a `CLOSING` account-balance audit (the shutdown handler does not publish a CLOSING open-orders snapshot). `COMMISSION_BASELINE` is a targeted one-asset audit, not a lifecycle phase. There is no `OPENING` phase. Account-snapshot durable facts are committed before the corresponding Journal event is published and durably flushed.

The filtered snapshot is the exchange-availability view used by balance/commitment checks; it is not the strategy ledger. Wallet balances, manual inventory, and deposits are **not** copied into the strategy-owned Portfolio.

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

`makeConservativeTradingEngine` receives a broker-independent strategy policy
from bootstrap and connects its decisions to the validated order-submission
use case. The policy supplies pure decision evaluation and trailing-BUY
repricing calculations; the engine does not import strategy calculators.
`createPortfolioWorkflow` remains the owner of Portfolio and RecoveryLedger
accounting and supplies explicit callbacks.

The engine remains the serialized Conservative application boundary. Its
transition queue coordinates the order registry, latest market prices/books,
BUY reference prices, processed-fill identities and execution totals, durable
pause/recovery markers, deferred evaluations, volatility state, operator
pause/resume, broker order lifecycle and shutdown-facing order operations.
The central final order-submission gate and serialized state application remain
engine-owned; the engine is not a domain policy and does not parse raw Binance
messages.

P3 has introduced four cohesive use-case boundaries on the current branch:

- `makeCollectOwnedOrderSnapshots` in
  `src/use-cases/collect-owned-order-snapshots.js` performs read-only REST
  evidence collection for registered orders: account-wide open-order reads per
  affected symbol, canonical order-history identity checks, complete paginated
  fill-history retrieval, and parity checks against Journal fill evidence supplied in the engine's initial state.
  It returns validated snapshots and does not mutate the order registry or
  accounting. `applyOwnedOrderSnapshotsTransition` remains in the engine and
  applies those snapshots inside the serialized transition queue.
- `makeVolatilityProtectionWorkflow` in
  `src/use-cases/volatility-protection-workflow.js` owns per-market volatility
  snapshot deduplication, protection-state transitions, cancellation retry
  timing, and recovery-triggered reevaluation. It receives the engine's
  serialized transition, owned-BUY cancellation, and latest-evaluation
  callbacks. The central order gate still reads the protection state and
  prevents disallowed submissions.
- `makeOrderEventWorkflow` in
  `src/use-cases/order-event-workflow.js` coordinates normalized user-data
  order events, external-order ownership policy, execution-fill application,
  terminal order handling and recovery-cycle transitions. It receives the
  engine's serialization, accounting, cancellation and strategy callbacks;
  Portfolio/RecoveryLedger mutation remains owned by
  `createPortfolioWorkflow`.
- `makeReconcileTerminalOrderFills` in
  `src/use-cases/reconcile-terminal-order-fills.js` reads canonical REST fill
  history, unions it with already-processed and current stream fills, validates
  order identity and duplicate facts, proves cumulative executed-quantity and
  terminal-status parity, then delegates each fill to the order-event
  workflow's existing accounting transition. It owns no Portfolio/RecoveryLedger
  state and does not bypass the engine's durable fill barriers.

The engine was reduced from 3,335 lines at the verified pre-P3 `develop`
baseline to 2,266 lines by the incremental extraction merged in [PR #1075](https://github.com/45s/coinzilla/pull/1075). This is not a completed
lifecycle redesign. Strategy evaluation/commitment allocation, execution
totals and recovery markers, owned-order cancellation/replacement, and the
central submission gate remain coordinated by the engine. The engine still
owns the serialized state transition queue; the extracted workflows do not
create a second concurrency boundary. See the [Harvester roadmap](../ROADMAP.md)
and the merged [P3 implementation PR #1075](https://github.com/45s/coinzilla/pull/1075).

Only order updates matched to a registered Harvester client order ID may
mutate the order registry or accounting. TRADE events must contain a canonical
Fill and pass the durable execution-fact barrier before Portfolio/RecoveryLedger
state is committed. A partial fill updates actual accounting but does not
advance the strategy; the engine waits for the order's terminal state.
Unmatched manual/external reports are diagnostic-only under the default
per-pair `externalOrdersPolicy: "ignore"`; the explicit `"block"` policy
retains the same-symbol restriction. Unmatched Harvester-reserved `h-`
identities and malformed/conflicting identities remain fail-closed. A fully
filled order triggers immediate strategy reevaluation from the latest known
price.

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
pair may trail its standing BUY upward while its active Position quantity is
zero. A BUY that has fully filled turns trailing off; the next standing BUY is
fixed while active strategy inventory exists. A profitable recovery SELL may
turn the trailing phase back on, including for a next BUY that was already
resting, but the engine still suppresses trailing repricing until the actual
Portfolio Position has zero active `baseQuantity.amount`. Retained
`freeBaseQuantity` does not count as active inventory and does not prevent
trailing from becoming eligible once active quantity reaches zero.

A trailing adjustment occurs only after the last traded price rises by at
least one full percentage step from the reference used for the current BUY.
The engine cancels the old BUY, queries canonical fills, and verifies the final
cumulative execution quantity. If any quantity filled during cancellation,
the fills are accounted and the pair pauses; it never submits a replacement
from uncertain inventory. A clean zero-fill cancellation is followed by a
new BUY below the current last trade, rounded down to the exchange tick.

## Operational event journal

**Current status:** Harvester composes one `@coinzilla/event-bus` instance in `src/index.js`, defines stable lifecycle names and DTO mappings, and composes `@coinzilla/journal` through `src/infrastructure/journal/prepare-optional-journal.js`. Process, configuration, broker connection, subscription, and selected user-data stream recovery lifecycle events are published from application/bootstrap boundaries. Step 5a adds actionable Conservative decisions and order submission request/acknowledgement/failure events from the application engine boundary. Journal initialization is awaited for broker-connected startup and the mandatory durable PREFLIGHT account audit. Ordinary event delivery remains asynchronous, while order-submission and cancellation intent events are durably flushed immediately before their broker writes. Coordinated shutdown draining remains Step 7.

Harvester may add an application-level EventBus and an optional Journal subscriber independently of trading progress. The first use case is ordinary operational visibility: configuration validated, application started/stopped, and broker connected/disconnected. This works without enabling trading and does not require TESTNET orders or fills. Composition belongs to the process/bootstrap boundary. The domain and strategy policies must remain independent of both packages. The broker adapter continues to normalize exchange messages; application workflows publish Harvester-owned, plain-object facts at meaningful lifecycle boundaries.

The Journal is not trading-state authority and ordinary event delivery remains asynchronous. Two narrow durability barriers are required before exchange side effects: each order-submission intent and each cancellation intent must be durably flushed before the corresponding broker call. Broker-connected startup also requires a durable PREFLIGHT account audit.

- Journal readiness and the PREFLIGHT audit gate broker-connected startup before market subscriptions or trading-engine activation.
- Strategy evaluation, market-price handling, fill accounting, and the serialized user-data queue must never await Journal I/O, flush, or close.
- Immediately before broker placement/cancellation, publish the allowlisted intent event and await a successful durable flush. If it fails, do not perform the exchange write and pause the pair.
- Ordinary event publication remains best-effort. A synchronous EventBus publication exception or failed result must be contained and reported without escaping into unrelated trading workflows.
- EventBus subscriber delivery and ordinary Journal writes remain asynchronous. A successful publish means accepted for in-memory delivery, not durably persisted; only the explicit barriers above establish durability.
- Only selected strategy decisions and meaningful order/execution/state transitions should be published. Do not publish every market-price update.
- Publish small serializable DTOs with stable order/fill identifiers and exact decimal strings. Do not pass domain class instances, SDK objects, raw exchange payloads, credentials, or whole account snapshots.
- On normal shutdown, stop market-price/book intake first and prevent new strategy decisions. Keep user-data intake active while the existing engine cancels only acknowledged, strategy-owned BUY orders and reconciles cancellation-racing fills. Preserve all SELL orders. Drain accepted user-data events, perform final owned-order reconciliation as verification only (without another BUY-cancellation pass), then stop user-data intake and drain again before the CLOSING audit and resource cleanup. Known open SELL orders are intentional and do not make CLOSING incomplete; unresolved BUYs or unknown order states do. For trading-enabled runs, unresolved cancellation, owned-order reconciliation, or user-data/accounting state fails shutdown and retains the trading-process lock. Other incomplete CLOSING audits remain recorded. A failed Journal close must not skip broker/resource cleanup.
- Document possible capture gaps before Journal becomes ready, after capacity/write failures, and on abrupt process or machine termination. Do not claim exactly-once delivery or unconditional durability.

Package composition, event publication, and shutdown ordering are defined by Harvester's own architecture and application contracts. Broker-connected startup intentionally fails closed when Journal readiness or the durable PREFLIGHT audit is unavailable; order and cancellation intents likewise require a durable pre-write barrier.

### Initial lifecycle event contract

The application-owned event names are exported from `src/application/events/event-names.js`: `harvester.process_started`, `harvester.started`, `harvester.startup_failed`, `harvester.stopped`, `config.validated`, `broker.connected`, `broker.connection_failed`, `broker.disconnected`, `broker.status_changed`, `broker.subscription_established`, and `broker.subscription_failed`. `HARVESTER_EVENT_SOURCE` is `harvester`.

`harvester.process_started` records the original process-entry timestamp, package version, build source, PID, and runtime-session ID. It is separate from `harvester.started`, which is emitted only after runtime startup succeeds. The process identity is captured once and attached to shared Logger context before startup diagnostics; DEBUG/TRACE file transports retain it separately from log data. Process-start Journal publication waits for Journal subscription readiness but remains best-effort and introduces no new durability barrier; broker-connected startup can include the admitted event in its existing PREFLIGHT flush. Configuration-only/no-broker startup does not wait for optional Journal setup. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. If the process exits before the Journal subscriber becomes ready, the Journal event is not guaranteed, while DEBUG/TRACE logs retain the process identity. If readiness is delayed, Journal append order may place the process event after `harvester.started`, while the payload retains the original process-entry timestamp.

`src/application/events/lifecycle-event-dtos.js` maps explicit application facts into small allowlisted `toResult({ data })` DTOs. Startup/configuration DTOs contain the broker identifier, current strategy mode, enabled market symbols, and trading-enabled flag as applicable; they never copy the full application config, credentials, or account snapshot. Failure DTOs contain a bounded error name/message only: stack and cause are omitted, and common labelled secret/token/authorization values and URL credentials are redacted. These mappings are published from the process and bootstrap lifecycle boundaries. `broker.status_changed` is limited to meaningful user-data transitions exposed by the broker callback; unchanged `recovered` reminders are published once per application recovery generation, while every reminder still reaches the recovery coordinator as a retry trigger. `recovered` means the remote stream is restored but does not prove Harvester account/order reconciliation. Journal persistence remains best-effort and can miss events published before its asynchronous subscription is active. No financial decimal values are part of these initial lifecycle DTOs; future financial event contracts must preserve canonical decimal strings.

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

### Recovery-cycle completion entry points and evidence

Recovery completion has three application entry paths, all of which must preserve the same terminal SELL identity:

1. The normal user-data execution-report path in `src/use-cases/order-event-workflow.js` forwards the reconciled canonical order after its terminal SELL fill has been applied.
2. The cancellation/reconciliation race path in `src/use-cases/conservative-trading-engine.js` forwards the broker-reconciled order when a cancellation query discovers that the SELL actually filled.
3. The exchange-constrained dust path forwards the terminal SELL previously retained for that market; a dust disposition alone is not proof that the sell-through completed.

All three converge on `createPortfolioWorkflow.completeRecoveryCycle`. The pure `assertTerminalRecoverySellOrder` guard requires a canonical `CanonicalOrder`, SELL side, FILLED status, broker identity, exact executed/original quantity equality, and the active market identity. The workflow shares its accounting queue with durable fill updates, waits for earlier accepted fills, persists the completion/not-completed fact, and only then commits the staged Portfolio and RecoveryLedger projections. Missing or inconsistent terminal evidence fails closed; it never authorizes a reset.

## In-process engine transition serialization

The Conservative engine serializes its public market-price, user-data, and explicit evaluation entry points through one in-process promise tail. Each transition holds the turn across strategy evaluation, pending-order registration, broker submission and acknowledgement, cancellation, fill-history reconciliation, and accounting callbacks. Internal workflow steps call their already-held transition functions directly; they must not enqueue themselves again. A rejected transition is isolated from the tail so later events can still run. This is process-local ordering only: it is not a cross-process lock, durable queue, exactly-once delivery guarantee, or restart-recovery mechanism.

## In-memory WebSocket API/stream order reconciliation

After the broker reports that its recovered user-data stream has completed
stream-level reconciliation, bootstrap keeps the trading gate closed and
starts WebSocket API request/response reads without blocking normal stream-event processing. Before the
broker snapshot is applied, bootstrap drains user-data events received during
the reads; the engine then validates and applies the snapshot in its serialized
transition queue. The trading gate is reopened only after both steps succeed.

During application recovery, the account-balance and account-wide open-orders audits are separate durability barriers. After the account snapshot is durably published, bootstrap revalidates the recovery generation and accounting state, drains queued user-data events, and compares the event sequence before it starts the open-orders audit. If the generation was superseded or an event changed the snapshot boundary, the open-orders audit is skipped and the snapshot window is retried. After the open-orders audit flush, bootstrap revalidates the generation and accounting state before draining more queued events; a superseded task does not drain under an obsolete generation. The final drain and stable event-sequence check must then succeed before broker acknowledgement.

Immediately after the asynchronous owned-order WebSocket API/stream reconciliation returns, bootstrap revalidates the recovery generation and accounting state before certifying canonical ownership. A superseded generation or accounting failure must not set the ownership-reconciled flag and must not proceed to account or open-orders audits.

The Conservative engine reconciles only orders already present in its
in-memory `OrderRegistry`. For each owned symbol it reads `getOpenOrders()`;
for each acknowledged owned order it reads exactly one matching
`getCanonicalOrderHistory()` record and the order's canonical `getFills()`.
Unknown/manual open orders are ignored and never registered or accounted.
A pending order without an exchange-assigned broker ID, a missing or
conflicting order-history record, an invalid open-order response, or a fill
quantity that does not equal the order's cumulative executed quantity keeps
the affected market paused and the application trading gate closed.

WebSocket API fill-history responses are validated as a complete set before any are applied, deduplicated
by stable `Fill.id` (market plus exchange trade ID), and ordered by execution
time with trade ID as a deterministic fallback. The history-response execution quantity
must match the canonical order's cumulative executed quantity, must not lag the
latest stream-updated order quantity, and must contain every execution ID
already processed from the stream. Each recovered execution is then passed
through the existing serialized user-data transition and paired
Portfolio/RecoveryLedger accounting workflow; there is no second accounting
path. Intermediate cumulative quantities are represented as partial order
updates, and the final recovered fill carries the authoritative terminal
status. A later overlapping stream event therefore reaches the same
idempotent accounting path and cannot account the execution twice.

This is deliberately process-local reconciliation. It does not restore orders
or accounting after a process restart, replay startup history, reconcile
balances or external inventory, or adopt manual orders. It also does not claim
durable exactly-once delivery. If broker request/response state is incomplete or inconsistent,
trading remains paused rather than guessing.

## Cancellation preconditions

Harvester validates cancellation eligibility before invoking the broker: only acknowledged OPEN and PARTIALLY_FILLED orders with a broker identifier are cancellable. PENDING, UNKNOWN, and terminal orders fail closed and pause the affected market where appropriate. The Binance adapter repeats the lifecycle check for order-shaped requests and normalizes every Binance order ID with the shared broker-package normalizeBinanceId utility before calling the exchange client. Raw ID-only adapter requests still receive identifier validation, but they do not carry enough lifecycle context for application-state eligibility checks.

Market-price subscription setup now awaits an already-received WebSocket Streams tick before deciding whether a Binance WebSocket API `ticker.price` request/response seed is needed; it does not issue that request when the stream price is fresh. Recovery-mode classification is passed consistently to both the trading engine and observer. Broker/shutdown fixtures and the PREFLIGHT cleanup regression test were corrected after the first exact-head CI run.

## Bootstrap composition and safety-halt workflow

`bootstrap/start-harvester.js` is the process composition root. It resolves
configuration, constructs domain/application state, connects adapters, wires
user-data and market-data handlers, establishes startup gates, and exposes the
runtime stop operation. It delegates account snapshots, market metadata,
subscription setup, user-data event/status/recovery handling, and shutdown
sequencing to focused bootstrap modules.

The account-integrity safety halt is an application workflow in
`src/use-cases/create-account-integrity-safety-halt.js`. When an unsafe
execution or accounting failure is observed, it reconciles broker-owned order
identities using `reconcileOwnedOrders({ recoveryMode: true })` before asking
the trading engine to cancel only strategy-owned BUYs. Recovery mode applies
canonical order and fill facts while suppressing strategy-driven recovery SELL
cancellation/replacement; it does not skip ownership or fill reconciliation.
The explicit `cancelOwnedBuyOrdersForSafetyHalt()` stage remains the only
exchange-mutation stage in this workflow. Concurrent triggers share one
in-flight task. Bootstrap supplies the live engine lookup, stopped-process
predicate, and logger; the use case does not depend on broker SDK or
process-global state.

The source-verified shutdown sequence, cancellation/fill-race handling,
CLOSING account audit, resource cleanup, and process-lock retention are defined
in [Journal Operations — Normal shutdown](./JOURNAL_OPERATIONS.md#normal-shutdown).

## Runtime API and process boundary

`startHarvester()` returns a frozen application runtime handle with the validated application configuration, strategy mode, selected event publisher and application capabilities such as market-price processing, Portfolio/account access, readiness/status, subscriptions and `stop()`. It does **not** expose the raw broker port or a standalone `placeOrder()` function. Order placement must flow through the Conservative Trading Engine so strategy decisions, market rules, balance/commitment checks, order ownership and fill lifecycle cannot be bypassed by runtime callers.

The process entry point in `src/index.js` composes process identity/logging, EventBus, the optional notifier, the Journal service, the broker-wide and Journal-directory process locks, runtime startup, signal handling and coordinated shutdown. Broker-connected startup requires the durable PREFLIGHT account audit before market subscriptions proceed. Detailed event payloads, Journal durability, lock acquisition/release, failure handling and shutdown ordering are maintained in [Journal Operations](./JOURNAL_OPERATIONS.md); do not duplicate those operational procedures here.

## Client order identity

The Conservative order executor creates one random process-local namespace at engine construction using a UUID-derived 22-hex-character value (88 bits), then increments a local sequence for each submitted order. Client IDs use the `h-<namespace>-<sequence>` shape; preflight validation uses a separate `preflight` marker within the same namespace. This avoids predictable counter-only identifiers being reused when a new process starts.

A unique client ID is an identity/correlation aid, **not** permission to retry an ambiguous submission. If the broker outcome is unknown, keep the order UNKNOWN, retain its commitment, pause the market and reconcile the original identity; never create a replacement order merely because an acknowledgement was lost. Durable cross-process retry idempotency and process-restart state restoration are not implemented.

## Recovery failure classification and retry contract

Engine event-processing failures carry an explicit `failure` object with
`category`, `stage`, and `retryable`. The outer event handler does not infer
accounting corruption from a generic non-success result.

`REST_RECONCILIATION` is a retained legacy failure-category identifier. It does not describe an HTTP REST transport: the current Binance broker performs canonical order/fill reads through WebSocket API request/response RPC.

| Category | Meaning | Retry policy |
|---|---|---|
| `OWNERSHIP_INTEGRITY` | Unknown/mismatched order or Fill identity, or invalid ownership transition | Terminal process-lifetime accounting gate; never acknowledge recovery |
| `ACCOUNTING_INTEGRITY` | Fill/accounting projection failure, conflicting duplicate, or order/fill quantity parity failure | Terminal process-lifetime accounting gate; never acknowledge recovery |
| `ORDER_TRANSITION` | Cancellation/replacement transition failed after the owned order was matched | Keep readiness closed; require a fresh authoritative order/fill reconciliation |
| `REST_RECONCILIATION` | Canonical order/fill history or owned-order WebSocket API request/response read failed/incomplete | Keep readiness closed; retry only through a new single-flight recovery attempt |
| `DURABILITY` | Required order-intent Journal durability barrier failed | Keep readiness closed; retry only after a new attempt revalidates canonical state and durability |

An unclassified engine failure defaults to terminal
`ACCOUNTING_INTEGRITY`; missing metadata never becomes permission to retry.
Retryable failures set a generation-scoped marker. A recovery attempt that
observes a marker while draining queued events must stop before audit
acknowledgement. A later broker reminder may clear that marker only at the
start of a new single-flight attempt, which must repeat the complete canonical
order/fill reconciliation, queued-event drain, account/open-order snapshots,
and both durable audit flushes. The process-lifetime accounting latch is never
cleared by a transport reconnect or by reclassifying an error.

```mermaid
flowchart TD
    A[Owned user-data event] --> B[Conservative engine transition]
    B --> C{Typed failure}
    C -->|Ownership or accounting integrity| D[accountingFailed = true]
    C -->|Order, broker request/response, or durability retryable| E[requiresReconciliation = true]

A failure from an asynchronous recovery stage may update application failure
state only while the attempt's captured recovery generation is still current.
If a disconnect supersedes the attempt while a REST read or durable audit is
pending, a later rejection from that obsolete operation is logged with the
captured/current generations and original error, then discarded as stale. It
must not set the process-lifetime accounting latch, create a retry marker for
the current generation, publish subsequent recovery audits, or acknowledge
the broker. The current generation remains blocked and must complete its own
single-flight reconciliation and durable audit barriers before readiness can

    D --> F[Readiness closed; no broker acknowledgement]
    E --> G[Generation-scoped retryable failure marker]
    G --> H[Abort current recovery before acknowledgement]
    H --> I[Next recovered reminder starts a new single-flight attempt]
    I --> J[Canonical orders and fills; drain queued events]
    J --> K[Fresh account and open orders; durable RECOVERY audits]
    K --> L[Revalidate generation and event sequence]
    L --> M[Exact broker generation acknowledgement]
    M --> N[Matching global reconciled status]
    N --> O[Readiness may return]
```

## External order ownership and per-pair policy

Account-wide open-order audits always record every observed order and leave unmatched orders unowned and untouched. Manual/external orders are classified separately from Harvester-generated orders using Harvester's reserved `h-` client-order ID prefix. Each pair may set `externalOrdersPolicy` to one of the named `EXTERNAL_ORDERS_POLICIES` values (`IGNORE` or `BLOCK`) from `src/domain/external-orders-policy.js`. Their serialized configuration values are `"ignore"` (default) and `"block"`. Under `"ignore"`, manual/external open orders do not defer that pair and unmatched external user-data reports are diagnostic-only; they never enter Portfolio or RecoveryLedger and do not pause Harvester. Under `"block"`, the existing same-symbol restriction remains in force. The policy is checked during strategy evaluation and again at the final broker-submission boundary.

An unmatched `h-` order is never treated as a manual order: it may be an order left by a prior Harvester process. It remains a blocker for its symbol regardless of `externalOrdersPolicy` until durable restart restoration and exchange reconciliation are implemented. Unknown/malformed order identities remain fail-closed. Harvester never adopts, cancels, or modifies manual/external orders. This policy does not make process-restart recovery safe.

Manual trading can still change exchange free balances or inventory; Harvester uses authoritative free balances and may receive normal exchange insufficient-balance rejections. Such manual activity is not attributed to Harvester strategy PnL.

## Operator control

The single application-wide named `appConfig` export is composed from focused named-export modules. Strategy-level switches are isolated in `config/strategies/cg-coin-grabber.js`; its pair map is imported from the separate `apps/harvester/cg-coin-grabber.js` `tradingPairs` export. Inbound Telegram defaults are isolated as `OPERATOR_CONTROL_CONFIG` in `config/operator-control.js`; all modules are composed by `config/index.js`. Validation remains at the single application configuration boundary. Harvester configuration and domain modules use named exports only.

Harvester operator control is an application capability, not a domain entity, strategy policy, broker adapter or generic command bus. The Conservative engine owns the serialized market-scoped operator-pause state; application use cases authorize a trusted `trading-operator` actor and append `OPERATOR_MARKET_PAUSED` / `OPERATOR_MARKET_RESUMED` through the ADR-0001 Operational State Store port before applying in-memory state. The first inbound transport is a private-chat Telegram Long Polling adapter with an explicit user-ID allowlist. The Command Center exposes `/start`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, and `/resume <SYMBOL>`, plus authorized inline navigation/refresh and confirmation-gated inline market pause/resume controls. It is runtime-wired but disabled by default; when enabled, bootstrap starts it after engine activation and before user-data subscription, and stops it before runtime shutdown. Read-only pages call application queries only. It never places, cancels, adopts or modifies exchange orders; a pause blocks new strategy BUYs and trailing-BUY replacements only, while resting BUYs may still fill and recovery SELLs/accounting continue. Pause state is process-lifetime and is not restored after restart. See [ADR-0002](./architecture/decisions/0002-transport-independent-operator-control.md), [ADR-0003](./architecture/decisions/0003-process-lifetime-operator-pause.md), the [operator-control contract](./operator-control/README.md), and the [Command Center runbook](./operations/telegram-command-center.md).
