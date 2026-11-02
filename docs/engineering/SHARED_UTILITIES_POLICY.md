# Shared utilities: reuse before implementation

**Status:** Mandatory repository-wide engineering policy  
**Owner:** Utilities domain (packages/utils)  
**Applies to:** Every application, package, contributor, and AI coding agent

## Purpose

Coinzilla should implement domain-neutral functionality once, test it thoroughly, document its contract, and reuse it. Reimplementing a generic capability inside each application creates inconsistent behavior, duplicated bug fixes, and unnecessary maintenance.

Before writing a helper, utility, logger, formatter, validator, decimal operation, retry helper, or other cross-cutting capability, search the existing repository—starting with packages/utils.

## Mandatory search-first workflow

Before implementing functionality that might already exist:

1. Search packages/utils/src/ and its tests for the behavior, not only the proposed function name.
2. Read packages/utils/src/index.js to confirm the supported public API. Do not import private package files from consumers.
3. Read packages/utils/README.md and packages/utils/AGENTS.md for the current contract and ownership rules.
4. Search the monorepo for existing implementations and consumers, including application-local helpers/, utils/, common/, and infrastructure modules.
5. Compare behavior, input/output shape, precision, error semantics, side effects, limits, and compatibility—not just similar names.
6. Reuse the public utility if it satisfies the requirement. Extend it in the Utilities domain if the capability is genuinely generic and the current contract can be evolved safely.
7. If the behavior is domain-specific, keep it in its owning domain. If a shared utility is missing, create a cross-domain request and link the consumer task to it.
8. Record why a new implementation is not reusable when intentionally duplicating a similar-looking function.

**Do not implement a new generic helper before completing this search.** A search that finds no exact name is not enough; inspect semantically similar behavior.

## What belongs in packages/utils

A capability belongs in shared utilities when it is independent of a specific application's business rules, exchange protocol, domain model, or workflow, and has a stable contract useful across domains.

Typical candidates:

- Exact decimal-string arithmetic primitives and other domain-neutral numeric operations.
- Generic parsing, formatting, normalization, validation, comparison, and collection helpers.
- Logging and safe diagnostic formatting.
- Error/result helpers such as toResult.
- Time, duration, UUID, and environment helpers.
- Small generic filesystem/platform helpers where their side effects and contract are explicit.

A capability does not become generic merely because it is a pure function or appears in two files. Reuse must not make the package depend on application concepts or force unrelated domains into one policy.

## What must remain in its owning domain

Keep business and integration rules with the domain that owns them, even when they are implemented as pure functions:

- Trading strategy, order planning, fee policy, portfolio/position accounting, and application lifecycle rules stay in their application/domain.
- Asset, money, quantity, order, fill, and other domain-value invariants stay in packages/entities.
- Exchange request/response adaptation, signing, stream protocols, and broker-specific normalization stay in packages/brokers.
- Event delivery guarantees, event-name contracts, and event-bus lifecycle behavior stay in packages/event-bus.
- Journal persistence and journal-specific contracts stay in packages/journal.
- Telegram message formatting and Telegram API behavior stay in packages/notifiers.

Shared low-level primitives may support these packages, but packages/utils must not own their business decisions.

## Logging policy

- Use Logger or defaultLogger from the public @coinzilla/utils API for application and package diagnostics.
- Do not introduce direct console.log, console.info, console.warn, or console.error calls in business logic or application workflows.
- Direct console access is permitted only inside the logger implementation or deliberate CLI output where stdout/stderr is the product interface. A synchronous `process.stderr.write` fallback is also permitted for fatal startup/shutdown diagnostics only when the shared logger is unavailable or has failed; it must not become routine application logging. Explain any other exception.
- Prefer injecting a logger into workflows/adapters when it improves testability and makes the side effect explicit. Do not create a wrapper logger in every application.
- Use structured context and stable fields. Never log secrets, credentials, access tokens, private keys, or sensitive payloads. Do not log the same failure redundantly.
- If the current logger lacks a required generic capability, improve packages/utils first rather than creating an application-specific logger.

Example:

    import { defaultLogger } from "@coinzilla/utils"

    defaultLogger.info({
      message: "Market data subscription started",
      symbol,
    })

## Quality bar for shared utilities

Every new or materially changed shared utility must have:

1. A documented public contract: purpose, object input shape where applicable, output shape, errors, precision/rounding rules, limits, and side effects. Include at least one copy-paste usage example showing concrete input and output.
2. Deterministic native Node.js tests covering normal cases, invalid inputs, boundaries, edge cases, and failure paths.
3. Adversarial tests where relevant (very large values, malformed input, hostile objects, serialization failures, overflow/underflow, rounding boundaries, and unusual Unicode).
4. Meaningful line and branch coverage. For arithmetic, test signs, scales, zeros, carry/borrow, precision limits, rounding modes, and divide-by-zero.
5. No business-domain imports or hidden access to network, filesystem, clock, randomness, process environment, or mutable global state in pure helpers.
6. A deliberate public export from packages/utils/src/index.js; consumers must not reach into private source paths.
7. An updated README, tests, and Utilities roadmap entry. Examples must show real input/output values and explicitly demonstrate important options such as rounding or failure behavior.
8. Consumer compatibility review before changing an existing public contract.

Do not claim a utility is complete or reusable merely because it has a test. Tests must validate its contract and failure behavior. Keep package coverage thresholds enforced by CI and improve them when new code is added.

## Initial repository audit findings

This is an initial source-tree and targeted implementation scan, not a claim that every helper in every file has been fully reviewed. The follow-up audit must inspect each candidate's implementation, tests, exports, and consumers before any migration.

| Area | Existing implementations observed | Initial disposition |
| --- | --- | --- |
| Shared logger | packages/utils/src/logger.js, exported as Logger and defaultLogger | Reuse this public API; inspect application adapters and direct console usage during the audit. |
| Exact decimal arithmetic | Previously duplicated in Free-Roll, Harvester, Market Simulator, and Entities | [x] Consolidated in `packages/utils/src/decimal.js`; consumers now import the shared API. Domain-level accounting, trading rules, and market validation remain local. |
| Decimal normalization | Previously implemented in packages/entities/src/values/normalize-decimal-string.js | [x] Generic canonicalization now lives in `@coinzilla/utils`; Entities retains its result-envelope adapter and domain-facing validation contract. |
| Percentage arithmetic | Previously implemented in apps/bot-free-roll/src/bot/helpers/percentage.js | [x] Exact percentage-rate, percentage-of, percentage-change, and apply-change functions now live in `@coinzilla/utils`. |
| Keyed async queue | Previously implemented in apps/bot-free-roll/src/bot/helpers/lifecycle.js | [x] Generic per-key serial task queue now lives in `@coinzilla/utils`; subscription disconnection remains app-local. |
| Object input assertion | Previously implemented in packages/event-bus/src/helpers/object-input.js | [x] Generic non-null, non-array object assertion now lives in `@coinzilla/utils`; EventBus still owns its event-specific input semantics. |
| Numeric helpers | packages/utils/src/number-operations.js, number-helper.js and app-specific numeric calculations | Reuse existing Number-based helpers only for ordinary non-financial calculations. Do not use binary floating-point helpers for exact financial amounts. |
| Time and wait | packages/utils/src/calculate-time-diff.js, format-time-relatively.js, wait.js, wait-duration.js | Existing shared capability; search before adding alternatives. |
| Validation and results | packages/utils/src/validation.js, validator.js, to-result.js | Existing shared capability; compare contract before adding generic validators/result wrappers. |
| Broker adapters and protocol helpers | packages/brokers/src/**/helpers/**, utils/** | Keep protocol-specific transformations and transport behavior in brokers. Extract only protocol-independent primitives. |
| Event-bus helpers | packages/event-bus/src/helpers/** | Keep event contract and delivery policy local to the event-bus domain. |
| Telegram formatting | packages/notifiers/src/telegram/** | Keep Telegram-specific message rules local to notifiers. |

### Decimal arithmetic audit priority

The original three application decimal modules were not interchangeable as-is:

- Free-Roll had the broadest operation set, including division, rescaling, increment rounding, and bounded exponent parsing. Its old `formatDecimal()` returned a JavaScript Number; that lossy formatter was not carried into the shared API.
- Harvester had a smaller signed decimal-string API.
- Market Simulator had positional arguments and rejected negative subtraction results; its market/order rules remain domain-owned.
- Entities had independent canonicalization and subtraction implementations; both now delegate to shared primitives while preserving the existing `toResult` contract.

The shared API accepts decimal strings (and bigint for parsing) and intentionally rejects JavaScript Number operands. It defines bounded precision, explicit division/rescaling rounding, and exact string outputs. The migration removes duplicate arithmetic implementations without changing domain-level trading/accounting decisions.

## Audit and migration plan

- [~] Inventory application and package helper/utility modules and classify candidates. The source-tree/helper inventory and current dispositions are recorded below; routine console-use verification and any future candidates remain.
- [~] Review direct console use and application logger adapters; Harvester's default logger was migrated and existing shared logger consumers were confirmed. A repository-wide automated guard remains.
- [x] Design and test the shared exact decimal API with explicit bounds and rounding behavior.
- [x] Migrate Harvester, Market Simulator, Free-Roll, Entities, and EventBus consumers while keeping business-specific rules local.
- [x] Identify and extract additional generic helpers (percentage calculations, keyed task queue, object-input assertion); classify remaining package helpers by domain ownership.
- [x] Update package READMEs, exports, consumer tests, and domain roadmaps for the extracted capabilities.
- [ ] Add automated checks where reliable (for example, detecting direct console usage outside approved infrastructure/CLI paths).

The audit is complete only when every identified candidate has a recorded disposition and the migration status is supported by tests and merged PRs.


## Repository-wide audit disposition (implementation pass)

The source-tree audit covers the applications and workspace packages present in the repository. The classification below is based on module responsibilities and observed imports; it does not claim that every line of every module has been formally reviewed.

| Area | Audit disposition |
| --- | --- |
| Free-Roll exact arithmetic | [x] Removed app-local decimal engine; imports shared arithmetic from `@coinzilla/utils`. Trading/accounting calculations remain in Free-Roll. |
| Harvester portfolio arithmetic | [x] Removed app-local decimal engine and its duplicate unit suite; position accounting imports shared arithmetic. Position and fill invariants remain in Harvester/Entities. |
| Market Simulator arithmetic | [x] Removed app-local arithmetic engine; order matching uses shared comparison and a thin object-input facade delegates arithmetic while preserving the simulator's non-negative subtraction invariant. Candle validation and fill semantics remain local. |
| Entities decimal values | [x] Canonical decimal normalization and subtraction delegate to shared primitives; `toResult` and entity validation behavior remain in Entities. |
| Generic percentage, queue, and input helpers | [x] Percentage arithmetic and keyed task serialization were extracted from Free-Roll; generic object-input assertion was extracted from EventBus. App-specific trading thresholds, subscription cleanup, and event contracts remain local. |
| Logging | [x] Harvester now defaults to `defaultLogger`; Free-Roll uses `defaultLogger`; Coin Farmer's adapter intentionally narrows the shared logger to its application port. |
| Brokers | Keep Binance signing, protocol payloads, stream adapters, and broker-specific normalization in `packages/brokers`; they depend on exchange contracts. |
| Event Bus | Keep event-name validation, payload rules, queue capacity, and delivery semantics in `packages/event-bus`; they define event-bus contracts. |
| Notifiers | Keep Telegram formatting, Telegram API validation, and Telegram delivery behavior in `packages/notifiers`; these are channel-specific. |
| Journal | Keep persistence, journal lifecycle, and record contracts in `packages/journal`; these are storage-domain behavior. |
| Applications | Keep configuration schemas, trading strategies, order planning, portfolio policy, market-history schema, and simulator matching rules with their owning application/domain. |
| Existing general utilities | Reuse existing logger, result, validation, UUID, time, wait, feature-flag, and numeric helpers through the public `@coinzilla/utils` API. `NH` remains Number-based and must not be used for exact financial arithmetic. |

### Remaining audit work

- [ ] Complete a repository-wide direct console/stderr scan and document the exact approved runtime/CLI exceptions.
- [ ] Add an automated repository check for routine direct console usage outside approved files, after the allowlist is agreed.
- [ ] Continue to classify new generic candidates when they appear; do not move single-domain helpers without a stable domain-neutral contract.
- [ ] Complete consumer migration verification through workspace CI and remove any stale imports or unused duplicate tests.


### Helper inventory: intentionally domain-local

The following helper groups were inspected and retained because their behavior belongs to a domain or protocol rather than to general-purpose utilities:

| Location | Examples | Why it stays local |
| --- | --- | --- |
| `packages/brokers/src/binance/**/helpers` and `utils` | Binance message/trade adapters, history query parameters, user-data event deduplication, RPC/stream protocol, signing, transport | These encode Binance wire formats, authentication, or broker lifecycle contracts. |
| `packages/brokers/**/test-helpers` | Fake broker clients, fake clock, fake WebSocket | Test doubles are scoped to broker protocol tests; they are not production runtime utilities. |
| `packages/event-bus/src/helpers` | Event-name validation, payload/options validation, delivery capacity | These define EventBus-specific contracts. The one generic object-shape assertion was extracted. |
| `packages/notifiers/src/telegram` | Telegram request/message validation and token-aware safe error formatting | These depend on Telegram API behavior and token handling. |
| `apps/bot-free-roll/src/bot/helpers` | Exchange result handling, fee/accounting, order planning, trading-rule validation, price thresholds, config validation | These depend on Free-Roll strategy, broker results, or trading constraints. Generic decimal/percentage/queue primitives were extracted. |
| `apps/harvester/src/domain` | Position fill accounting, portfolio transitions, strategy decisions | These enforce Harvester domain invariants and policies. Only arithmetic primitives were extracted. |
| `apps/market-simulator/src/domain` | Market history schema and limit-order matching | These define simulator-specific input and matching rules. Its arithmetic facade only preserves the simulator's subtraction invariant. |
| `apps/bot-coin-farmer/test/helpers` | Configuration test fixtures | Test-only fixtures are not production shared utilities. |

The shared package already contained and continues to own the general-purpose logger, result normalization, validators, UUID generation, date/time formatting and differences, waits, feature flags, event emitter, file append helper, log formatting/redaction, string capitalization, and Number-based convenience helpers. The new decimal, percentage, keyed queue, and object-input modules extend that existing public utility set.
