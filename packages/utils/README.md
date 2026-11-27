# @coinzilla/utils

Domain-neutral helpers shared across the Coinzilla workspace. The package uses native Node.js APIs and has no runtime dependencies.

Public JavaScript APIs are documented with JSDoc for editor IntelliSense, parameter hints, and hover information. Runtime behavior and validation remain implemented and tested in JavaScript; JSDoc does not enable static type-checking or add TypeScript declarations.

## Public API

**Search here before writing a generic helper.** The repository-wide rules and current duplication audit are documented in [../../docs/engineering/SHARED_UTILITIES_POLICY.md](../../docs/engineering/SHARED_UTILITIES_POLICY.md). Consumers should import supported APIs from this package entry point, not private source paths.

Import the supported API from the package entry point:

- `Logger`, `defaultLogger`: structured logger with `trace`, `debug`, `info`, `warn`, `error`, `success`, and `system` methods, independently filtered output transports, runtime threshold changes, opt-in structured context, and safe structured-data redaction. `success` and `system` are semantic methods with `info` severity.
- `captureBuildMetadata`: one-time, allowlisted application build provenance capture from Git, with explicit `COINZILLA_BUILD_*` environment fallback.
- `EM`: shared error-message factories.
- `ensure`: generic input validation/assertions with direct helpers and an optional fluent pipeline. Every method takes one options object; direct methods return the validated value. Optional `errMsg` customizes assertion failures while preserving `TypeError` or `RangeError`. See [validation](#validation).
- `NH`: numeric helpers (`round`, `fix`, `precise`).
- `calculateTimeDiff`: signed, fractional difference between `Date` instances in seconds, minutes, or hours (default: hours); omitted `end` defaults to the current time, and an earlier end produces a negative result.
- `formatTimeRelatively`: English relative-time formatting via `Intl.RelativeTimeFormat` (default unit: hours; callers may select another supported unit).
- `wait`: promise-based delay; accepts a finite duration from 0 through 2,147,483,647 milliseconds.
- `generateUUID`: UUID v4 generation.
- `trimAndUppercase`: trims surrounding whitespace and uppercases the complete string.
- `toResult`: normalizes result objects; an explicit non-null `errors` property takes precedence over `error`, non-array errors are wrapped in an array, `ok` is recomputed from the normalized errors, and other input properties are preserved.
- `SystemCustomError`: shared native `Error` base for package-owned subclasses; preserves native `cause`, sets the concrete subclass name, and optionally exposes a stable `code`, safe scalar `context`, and boolean `retryable` classification.
- `createKeyedQueue`: creates independent serialized promise queues per key; tasks sharing a key run in enqueue order, different keys run concurrently, and `drain()` waits for tasks pending when it is called. An optional `onError({ key, error })` reports task failures without poisoning later tasks for that key.
- `assertObjectInput`: compatibility helper for operation input shape; delegates its generic object and operation-label checks to `ensure` and deliberately does not read input properties.
- `isFeatureEnabled`: enables a feature only when its environment variable is exactly `1`; warning diagnostics never include the variable's value.
- `addTextToFile`: append a string or `Uint8Array` to a file path supplied as a string or `URL`; the file is created when it does not exist.
- `handleErr`: report structured error context.
- `EVENTS`, `eventEmitter`: shared Node.js event names and singleton emitter; `EVENTS.PRICE_UPDATE` is the current event, and consumers should remove listeners during lifecycle cleanup.
- `isDevMode`, `isProdMode`, `isTestingMode`: environment-mode constants evaluated when the module is loaded.

## Shared logging

Follow the repository [Logging and Observability Standard](../../docs/engineering/LOGGING_OBSERVABILITY_STANDARD.md) for severity, correlation, redaction, and reporting boundaries. Use the existing logger rather than calling `console` from application or domain code. Prefer structured fields and never pass credentials, tokens, or private keys.

```js
import { defaultLogger } from "@coinzilla/utils"

defaultLogger.info({
  message: "Market data subscription started",
  symbol: "BTCUSDT",
})
// Emits one structured log entry through the shared logger.
```

Inject a logger into workflows/adapters when the dependency should be explicit or replaced in tests. Do not create an app-local logger just to wrap the shared implementation.

### Structured logger context

Use `Logger.setContext(context)` to attach process identity to every subsequent transport entry without changing the caller's `data` object:

```js
import { defaultLogger } from "@coinzilla/utils"

defaultLogger.setContext({
  application: "harvester",
  version: "1.0.001",
  runtimeSessionId: "runtime-session-id",
  processId: 12345,
  startedAt: "2026-11-09T00:30:00.000Z",
  source: {
    branch: "develop",
    shortCommit: "abcdef01",
    workingTree: "clean",
  },
})

defaultLogger.info({ message: "Broker startup requested" })
```

The transport entry receives an optional `context` object separate from `data`. Context is normalized by the same safe formatter and sensitive-field redactor, then frozen before delivery. Calling `setContext` replaces the complete context snapshot; call `setContext({})` to clear it. When context is empty, the historical entry shape remains `{ timestamp, level, method, data }`. The default console transport displays configured context alongside the log data. This context is shared by every subsequent record on that Logger instance and is intended for stable process identity only. Do not change it per request or operation in concurrent flows; put operation correlation IDs in each entry's `data` and propagate them explicitly.

### Build provenance

Capture build identity once when an application process starts. Pass process state explicitly so the utility is deterministic in tests and does not read arbitrary environment variables:

```js
import { captureBuildMetadata, defaultLogger } from "@coinzilla/utils"

const build = captureBuildMetadata({
  application: "harvester",
  version: "1.0.001",
  cwd: process.cwd(),
  env: process.env,
})

defaultLogger.setContext({
  application: build.application,
  version: build.version,
  source: build.source,
})

// build.source includes:
// {
//   branch: "develop",
//   commit: "<full commit SHA>",
//   shortCommit: "<first 8 SHA characters>",
//   commitMessage: "feat: example",
//   commitDate: "2026-11-08T22:00:00+00:00",
//   workingTree: "clean", // "dirty" or "unknown" when appropriate
//   metadataSource: "git", // "environment" or "unavailable"
// }
```

Git is queried synchronously once per call for the repository root, HEAD SHA, current branch, commit subject/date, and working-tree status. Call the utility once at process startup and reuse the returned immutable snapshot; do not call it for each log entry. The utility does not include changed file names or read `.env` files.

If Git is unavailable or `cwd` is not a readable Git working tree, the utility uses only these optional string variables:

| Variable | Meaning |
| --- | --- |
| `COINZILLA_BUILD_COMMIT` | Full 40–64 character hexadecimal commit SHA |
| `COINZILLA_BUILD_BRANCH` | Branch name |
| `COINZILLA_BUILD_COMMIT_MESSAGE` | Commit subject |
| `COINZILLA_BUILD_COMMIT_DATE` | Committer timestamp |
| `COINZILLA_BUILD_WORKING_TREE` | `clean` or `dirty`; other values become `unknown` |

Missing values are returned as `null`, and working-tree state becomes `unknown`; unavailable provenance never prevents application startup. `metadataSource` identifies whether the snapshot came from Git, explicit environment values, or neither. When Git is available, its values take precedence over environment fallback values.

The returned object contains only `application`, `version`, and the allowlisted `source` fields. `application`, `version`, and `cwd` are required non-empty strings. `env` must be an object; `execFileSync` may be injected for deterministic tests. Invalid required inputs throw `TypeError`; Git execution failures are treated as unavailable metadata.

### Severity levels and transports

Standard severity order is `trace < debug < info < warn < error`. Every transport has its own minimum severity; an entry filtered by one destination is still delivered to every other eligible destination. The default console transport starts at `debug` outside production and `info` in production. The legacy testing-mode suppression of console `warn` and production suppression of console `debug` are retained. These environment defaults affect only the built-in console transport.

```js
import { Logger, defaultLogger } from "@coinzilla/utils"

import { appendFile } from "node:fs/promises"

defaultLogger.addTransport({
  name: "development-file",
  level: "debug",
  write(entry) {
    return appendFile("logs/development.log", `${JSON.stringify(entry)}\n`)
  },
})

defaultLogger.addTransport({
  name: "diagnostics",
  level: "trace",
  write(entry) {
    return appendFile("logs/diagnostics.log", `${JSON.stringify(entry)}\n`)
  },
})

// Changes only the named destination; other thresholds are unchanged.
defaultLogger.setLevel({ transport: "console", level: "debug" })
defaultLogger.setLevel({ transport: "console", level: "info" })

const current = defaultLogger.getConfig()
// { transports: [{ name: "console", level: "info" }, ...] }

// A separate logger is useful for isolated tests or independent applications.
const isolatedLogger = new Logger({ transports: [] })

// Remove application-owned destinations during shutdown.
await defaultLogger.removeTransport("development-file")
await defaultLogger.removeTransport("diagnostics")
```

A transport is an object with a unique non-empty `name`, a `level` from the standard severity list, and a `write(entry)` function. It may also provide `shouldWrite(entry)` for an additional transport-specific filter and `close()` for resource cleanup. Each write receives the same frozen entry shape:

```js
{
  timestamp: "2026-11-05T12:00:00.000Z",
  level: "info",       // normalized severity
  method: "success",   // called method, including semantic methods
  data: { message: "Completed" }, // detached, frozen, JSON-safe, redacted data
  context: { application: "harvester" } // optional, detached, frozen, redacted context
}
```

The entry's `data` retains structured fields and normalized Error diagnostics (including stack, cause, and AggregateError members); common sensitive field names are redacted before any transport receives the entry. Free-form strings and stack/message text remain caller-owned and must not contain secrets.

Public configuration methods:

- `addTransport(transport)` validates and adds a transport; duplicate names are rejected.
- `setLevel({ transport, level })` changes one known transport's threshold and returns the current configuration snapshot. Invalid levels and unknown transport names throw `TypeError`.
- `setContext(context)` replaces the optional context attached to subsequent entries and returns the Logger instance. Pass `{}` to clear context; invalid non-object values throw `TypeError`.
- `getConfig()` returns a detached snapshot of transport names and thresholds.
- `removeTransport(name)` removes a transport and awaits its optional `close()` hook. Unknown names return `false`.
- `close()` removes all transports and awaits their optional cleanup hooks.

Transport `write` and `close` may return promises. Logging methods remain synchronous; synchronous and asynchronous transport failures are caught and reported through the optional `onTransportError({ transport, error })` constructor callback. A failed transport does not prevent other eligible transports from receiving the entry. When no callback is provided, the emergency fallback reports only the transport name and safe error type; it does not print the raw Error message or stack. The custom callback receives the original error and must redact it before reporting. If the callback itself fails, the emergency fallback remains bounded and does not print that reporter error's message or stack. Cleanup failures are reported without preventing other transports from closing. Applications that own file handles or other resources should implement `close()` and call logger cleanup during their own shutdown lifecycle.

`Logger` accepts `new Logger({ transports, onTransportError })`. Omitting `transports` creates the built-in console destination. Supplying an array (including an empty array) explicitly controls the destinations. Configuration belongs to each Logger instance; tests that change the shared `defaultLogger` should restore its thresholds or use a separate `Logger` instance.

### Structured error diagnostics

Pass native `Error` and `AggregateError` instances as structured values; do not reduce them to `String(error)` or `error.message` at call sites. The shared formatter normalizes errors to JSON-compatible objects containing `name`, `message`, and `stack` when available, recursively includes `cause`, and includes `AggregateError.errors` as an array. This works for direct errors and errors nested in objects or arrays.

Circular references on the active traversal path are represented as `[Circular]`; repeated non-circular references are serialized normally. The Logger therefore emits readable JSON containing the `[Circular]` marker for circular structured values, while unsupported JSON primitives such as BigInt still use the safe string fallback. Properties whose getters throw are represented as `[Unreadable property]`; hostile proxy enumeration is contained. Common sensitive field names continue to be redacted recursively, including inside normalized error causes. The formatter does not inspect secrets embedded in free-form messages or stack text, so callers must not place credentials or signed request data in those strings. If JSON serialization still fails (for example, because a structured value contains a BigInt), the existing safe string fallback is used.

The normalized diagnostic shape intentionally allowlists standard Error diagnostics rather than copying arbitrary custom Error properties; it is intended for logs, not for reconstructing executable Error instances.

Use `SystemCustomError` as the shared base for package-owned subclasses, not as a replacement for domain-specific error types:

```js
import { SystemCustomError, defaultLogger } from "@coinzilla/utils"

class MarketDataReadError extends SystemCustomError {}

const cause = new Error("connection closed")
const error = new MarketDataReadError("Unable to read market data", {
  code: "MARKET_DATA_READ_FAILED",
  cause,
  context: {
    component: "market-data",
    operation: "read",
    symbol: "BTCUSDT",
  },
  retryable: true,
})

defaultLogger.error({
  message: error.message,
  error,
  code: error.code,
  context: error.context,
  retryable: error.retryable,
})
```

The base preserves native `cause` identity and freezes a detached context record. Context must be a plain object whose values are strings, finite numbers, booleans, or `null`; do not attach secrets, nested payloads, request/response objects, or mutable domain state. The base does not decide whether a failure is retryable; the owning component supplies that classification only when it is meaningful.

The Logger continues to serialize only standard Error diagnostics. Pass custom `code`, `context`, and `retryable` as explicit structured fields when they are needed in logs.

## Validation

Prefer `ensure` for generic input validation. It replaces repeated `typeof`, array-shape, range and uniqueness checks with small reusable assertions. All methods accept one options object (required by the repository's `max-params: 1` rule); `name` is optional and defaults to `value`. Values are validated without coercion, and successful direct assertions return the original value. `errMsg` is an optional non-empty string that replaces a validation-failure diagnostic while retaining the original error class. Invalid assertion configuration (such as malformed range bounds or allowed-values arrays) keeps its configuration-specific error.

### Custom diagnostics

Use `errMsg` when a generic assertion must preserve a domain-specific failure message:

```js
const accounting = { verified: true }

ensure.object({
  value: accounting,
  name: "accounting",
  errMsg: "Recovery Seller STOP reset requires accounting must be verified",
})
```

The assertion still rejects arrays, null, and primitives. It throws the same error class as the underlying assertion (`TypeError` for an invalid object shape, `RangeError` for an out-of-range number); only the diagnostic message is replaced. Successful assertions return the original validated value. Omit `errMsg` to retain the default field-specific diagnostics. Empty or non-string messages are rejected with `TypeError`.

### Direct assertions

```js
import { ensure } from "@coinzilla/utils"

const intervalMs = ensure.integerInRange({
  value: pollingInterval,
  min: 250,
  max: 60000,
  name: "intervalMs",
})

const symbols = ensure.nonEmptyStrings({
  value: configuredSymbols,
  name: "symbols",
})
```

| Method | Contract |
| --- | --- |
| `string`, `nonEmptyString` | Require a string; non-empty checks trimmed content but returns the original text. |
| `boolean` | Require a boolean. |
| `number` | Require a finite JavaScript number. |
| `integer`, `safeInteger` | Require an integer; the latter also requires safe precision. |
| `integerInRange` | Require a safe integer within inclusive `min`/`max` bounds. |
| `numberInRange` | Require a finite number within inclusive bounds. |
| `positiveInteger`, `nonNegativeInteger` | Require safe integers greater than zero or at least zero. |
| `array`, `nonEmptyArray` | Require an array, optionally with at least one element. |
| `strings`, `nonEmptyStrings` | Require an array of strings; the latter also requires a non-empty array and rejects whitespace-only elements. |
| `unique` | Require an array with no duplicate values using `Map` SameValueZero equality (including `NaN` and signed zero; objects compare by identity). |
| `function` | Require a callable value. |
| `object`, `plainObject` | Require a non-null non-array object; the latter accepts only `Object.prototype` or null prototypes. |
| `defined`, `notNull` | Reject `undefined`, or both `null` and `undefined`, respectively. |
| `oneOf` | Require membership in a non-empty allowed-values array. |

Type/shape failures throw `TypeError`. Validly typed values outside numeric bounds throw `RangeError`. Error messages include the supplied field name and a safe description of the received value; arbitrary objects are never stringified. For example:

```text
intervalMs must be an integer between 250 and 60000 (received 100)
symbols[2] must be a non-empty string (received " ")
symbols must contain unique values (duplicate at index 2; first seen at index 0)
```

### Fluent pipelines

Use `ensure.chain({ value, name, errMsg })` when a value needs several checks or transformations. A chain-level `errMsg` is propagated to validation steps; errors thrown by user-supplied transformation or predicate callbacks are not rewritten. Each operation returns a new chain. Validation methods preserve the current value; `map` and `filter` return new arrays and do not mutate the source. Filtering is an explicit transformation, not a way to silently validate or discard malformed inputs.

```js
const normalizedSymbols = ensure
  .chain({
    value: configuredSymbols,
    name: "symbols",
  })
  .array()
  .nonEmpty()
  .nonEmptyStrings()
  .map({
    transform: (symbol) => symbol.trim().toUpperCase(),
  })
  .unique()
  .value
```

Available chain methods: `.array()`, `.string()`, `.integer()`, `.nonEmpty()`, `.strings()`, `.nonEmptyStrings()`, `.integers()`, `.map({ transform })`, `.filter({ predicate })`, `.unique()`, `.between({ min, max })`, `.trim()`, `.uppercase()`, `.lowercase()`, and the final `.value` getter.

## Development

```sh
pnpm --filter @coinzilla/utils test
pnpm --filter @coinzilla/utils test:coverage
```

The coverage command enforces at least 90% line coverage and 85% branch coverage for production source files.

## Exact decimal arithmetic

> **Financial safety:** the existing `NH` and `number-precision-operations` helpers use JavaScript `Number`. They are suitable only where floating-point behavior is acceptable. Do not use them for balances, quantities, prices, fees, or other exact financial values; use the decimal-string API below.

The decimal API performs arithmetic with `BigInt` coefficients and explicit decimal scales. It never converts operands through JavaScript `Number`, so it is suitable for exact financial quantities when callers provide decimal strings.

### Public functions

| Function | Input | Output | Notes |
| --- | --- | --- | --- |
| `parseDecimal({ value, field? })` | Decimal string or bigint | `{ coefficient: bigint, scale: number }` | Supports bounded scientific notation; rejects JavaScript numbers. |
| `formatDecimalString({ coefficient, scale })` | BigInt coefficient and scale | Canonical decimal string | Removes trailing fractional zeros and negative zero. |
| `addDecimal({ left, right })` | Decimal strings | Decimal string | Signed operands supported. |
| `subtractDecimal({ left, right })` | Decimal strings | Decimal string | Negative results supported. |
| `multiplyDecimal({ left, right })` | Decimal strings | Decimal string | Rejects results whose combined scale exceeds 100. |
| `divideDecimal({ left, right, scale, rounding })` | Decimal strings, output scale, rounding mode | Decimal string | Rounding is mandatory: `toward-zero`, `away-from-zero`, or `half-up`. Half-up ties round away from zero. |
| `compareDecimal({ left, right })` | Decimal strings | `-1`, `0`, or `1` | Exact comparison. |
| `absoluteDecimal({ value })`, `negateDecimal({ value })` | Decimal string | Decimal string | Exact sign operations. |
| `minDecimal({ left, right })`, `maxDecimal({ left, right })` | Decimal strings | Decimal string | Return canonical decimal text. |
| `rescaleDecimal({ value, scale, rounding? })` | Decimal string and scale | Decimal string | Rounding is required only when reducing scale. |
| `roundDecimalToIncrement({ value, increment, direction })` | Non-negative decimal strings | Decimal string | Direction: `down`, `up`, or `nearest`; zero increment disables rounding. |
| `normalizeDecimalString({ value, allowNegative?, field? })` | Plain decimal string | Canonical decimal string | Trims whitespace; does not accept exponent notation. |
| `assertDecimalString({ value, field? })` | Decimal string | Original string | Validates type, syntax, and supported precision. |

The parser limits input to 256 digits, exponent magnitude to 100, and fractional scale to 100. These limits bound BigInt work and prevent accidental unbounded inputs. They are part of the public contract.

### Example

```js
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  roundDecimalToIncrement,
} from "@coinzilla/utils"

const totalCost = addDecimal({
  left: "12.345",
  right: "0.005",
})
// "12.35"

const sellPrice = divideDecimal({
  left: totalCost,
  right: "99",
  scale: 8,
  rounding: "away-from-zero",
})
// "0.12474748"

const exchangePrice = roundDecimalToIncrement({
  value: sellPrice,
  increment: "0.0001",
  direction: "up",
})
// "0.1248"

const isProfitable = compareDecimal({
  left: totalCost,
  right: "12.34",
}) > 0
// true
```

### Safety rules

- Pass decimal strings from exchange payloads/configuration. Do not convert exchange decimal strings to `Number` before calling these functions.
- JavaScript numbers are intentionally rejected: precision may already have been lost before a utility receives the value.
- Choose the division/rescaling rounding mode explicitly according to the owning domain's policy. The utility provides arithmetic; it does not decide trading, accounting, or exchange policy.
- These helpers are pure and deterministic. They do not read clocks, environment variables, global state, or perform I/O.
- Use the public `@coinzilla/utils` entry point. Do not import internal source files from consumers.

## Exact percentage calculations

The percentage helpers build on the exact decimal API and never convert operands through `Number`.

| Function | Input | Output |
| --- | --- | --- |
| `percentageToRate({ percent })` | Percentage points as a decimal string | Decimal rate string |
| `calculatePercentageOf({ value, percent })` | Value and percentage strings | Exact percentage amount string |
| `applyPercentageChange({ value, percent })` | Value and signed percentage strings | Exact adjusted value string |
| `calculatePercentageChange({ from, to, scale, rounding })` | Starting/ending values, output scale, explicit rounding | Percentage-change string |

```js
import {
  applyPercentageChange,
  calculatePercentageChange,
} from "@coinzilla/utils"

const afterFee = applyPercentageChange({
  value: "100",
  percent: "-0.075",
})
// "99.925"

const change = calculatePercentageChange({
  from: "100",
  to: "99.925",
  scale: 4,
  rounding: "half-up",
})
// "-0.075"
```

For `calculatePercentageChange`, `scale` must be from 0 through 98 because the internal ratio calculation reserves two decimal places for percentage conversion. Division by a zero starting value is rejected.

## Keyed asynchronous task queue

`createKeyedQueue({ onError? })` serializes asynchronous tasks independently by key. Tasks sharing a key run in enqueue order; tasks with different keys may run concurrently. `enqueue({ key, task })` returns the task promise. A task failure is reported to the optional `onError({ key, error })` callback; later tasks for that key still run. If the error callback itself fails, that enqueue promise rejects but the queue remains usable. `drain()` waits for tasks currently pending across all keys.

```js
import { createKeyedQueue, defaultLogger } from "@coinzilla/utils"

const queue = createKeyedQueue({
  onError: ({ key, error }) => {
    defaultLogger.error({ message: "Queued task failed", key, error })
  },
})

await Promise.all([
  queue.enqueue({ key: "BTCUSDT", task: () => updateBtc() }),
  queue.enqueue({ key: "BTCUSDT", task: () => reconcileBtc() }),
  queue.enqueue({ key: "ETHUSDT", task: () => updateEth() }),
])

await queue.drain()
```

## Generic object-input assertion

`assertObjectInput({ input, operation? })` throws a `TypeError` unless `input` is a non-null, non-array object. The optional operation label is included in the error message. The helper intentionally does not read input properties; callers can perform property access inside their own error boundary.

```js
import { assertObjectInput } from "@coinzilla/utils"

export function publishEvent(input = {}) {
  assertObjectInput({ input, operation: "Event publish" })
  const { name, data } = input
  // Continue with event-specific validation.
}
```
