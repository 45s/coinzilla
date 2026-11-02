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
- Direct console access is permitted only inside the logger implementation itself, or for deliberate command-line output where stdout/stderr is the product interface (for example, a CLI result). Explain any other exception.
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

1. A documented public contract: purpose, object input shape where applicable, output shape, errors, precision/rounding rules, limits, and side effects.
2. Deterministic native Node.js tests covering normal cases, invalid inputs, boundaries, edge cases, and failure paths.
3. Adversarial tests where relevant (very large values, malformed input, hostile objects, serialization failures, overflow/underflow, rounding boundaries, and unusual Unicode).
4. Meaningful line and branch coverage. For arithmetic, test signs, scales, zeros, carry/borrow, precision limits, rounding modes, and divide-by-zero.
5. No business-domain imports or hidden access to network, filesystem, clock, randomness, process environment, or mutable global state in pure helpers.
6. A deliberate public export from packages/utils/src/index.js; consumers must not reach into private source paths.
7. An updated README, tests, and Utilities roadmap entry.
8. Consumer compatibility review before changing an existing public contract.

Do not claim a utility is complete or reusable merely because it has a test. Tests must validate its contract and failure behavior. Keep package coverage thresholds enforced by CI and improve them when new code is added.

## Initial repository audit findings

This is an initial source-tree and targeted implementation scan, not a claim that every helper in every file has been fully reviewed. The follow-up audit must inspect each candidate's implementation, tests, exports, and consumers before any migration.

| Area | Existing implementations observed | Initial disposition |
| --- | --- | --- |
| Shared logger | packages/utils/src/logger.js, exported as Logger and defaultLogger | Reuse this public API; inspect application adapters and direct console usage during the audit. |
| Exact decimal arithmetic | apps/bot-free-roll/src/bot/helpers/decimal.js, apps/harvester/src/domain/portfolio/decimal-arithmetic.js, apps/market-simulator/src/domain/decimal.js | Strong duplication candidate for a shared low-level decimal-string arithmetic module. Compare contracts and edge cases before designing one compatible API. |
| Decimal normalization | packages/entities/src/values/normalize-decimal-string.js | Entity-level validation/invariants may remain in entities; assess whether it can safely delegate to shared parsing/normalization primitives. |
| Numeric helpers | packages/utils/src/number-operations.js, number-helper.js and app-specific numeric calculations | Reuse existing Number-based helpers only for ordinary non-financial calculations. Do not use binary floating-point helpers for exact financial amounts. |
| Time and wait | packages/utils/src/calculate-time-diff.js, format-time-relatively.js, wait.js, wait-duration.js | Existing shared capability; search before adding alternatives. |
| Validation and results | packages/utils/src/validation.js, validator.js, to-result.js | Existing shared capability; compare contract before adding generic validators/result wrappers. |
| Broker adapters and protocol helpers | packages/brokers/src/**/helpers/**, utils/** | Keep protocol-specific transformations and transport behavior in brokers. Extract only protocol-independent primitives. |
| Event-bus helpers | packages/event-bus/src/helpers/** | Keep event contract and delivery policy local to the event-bus domain. |
| Telegram formatting | packages/notifiers/src/telegram/** | Keep Telegram-specific message rules local to notifiers. |

### Decimal arithmetic audit priority

The three application decimal modules are not interchangeable as-is:

- Free-Roll supports a broader set of operations and bounded decimal/exponent parsing; its formatDecimal() returns a JavaScript Number, while formatDecimalString() preserves exact decimal text. Financial callers must use string results.
- Harvester currently implements a smaller set of exact string operations.
- Market Simulator has a different API and rejects negative subtraction results.

The shared API must be designed around explicit decimal-string contracts and tested edge cases. Do not simply copy one implementation over the others or change business-level rounding/precision policy during a mechanical migration.

## Audit and migration plan

- [ ] Inventory all application and package helper/utility modules; inspect implementations, tests, public exports, and call sites.
- [ ] Search for direct console calls and application-specific logger wrappers; migrate business diagnostics to the shared logger where appropriate.
- [ ] Design and test a shared exact decimal arithmetic API, including explicit bounds and rounding behavior.
- [ ] Migrate Harvester, Market Simulator, and Free-Roll low-level decimal primitives through owner-coordinated changes; keep business-specific accounting and strategy rules local.
- [ ] Identify other duplicated generic helpers and classify each as shared, domain-local, or intentionally duplicated.
- [ ] Update package READMEs, exports, consumer tests, and domain roadmaps as migrations complete.
- [ ] Add automated checks where reliable (for example, detecting direct console usage outside approved infrastructure/CLI paths).

The audit is complete only when every identified candidate has a recorded disposition and the migration status is supported by tests and merged PRs.
