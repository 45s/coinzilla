# @coinzilla/utils

Domain-neutral helpers shared across the Coinzilla workspace. The package uses native Node.js APIs and has no runtime dependencies.

## Public API

**Search here before writing a generic helper.** The repository-wide rules and current duplication audit are documented in [../../docs/engineering/SHARED_UTILITIES_POLICY.md](../../docs/engineering/SHARED_UTILITIES_POLICY.md). Consumers should import supported APIs from this package entry point, not private source paths.


Import the supported API from the package entry point:

- `Logger`, `defaultLogger`: console logger with `debug`, `info`, `warn`, `error`, `success`, and `system` methods. Structured payloads redact common credential field names; free-form strings must not contain secrets.
- `EM`: shared error-message factories.
- `Validator`, `VR`: declarative value validation. `Validator.validate({ items, isSoft })` accepts `[value, rules, fieldName?]` tuples; soft mode returns structured errors and hard mode throws them.
- `NH`: numeric helpers (`round`, `fix`, `precise`).
- `calculateTimeDiff`: date difference in seconds, minutes, or hours; omitted `end` defaults to the current time.
- `formatTimeRelatively`: localized relative-time formatting.
- `wait`: promise-based delay; accepts a finite duration from 0 through 2,147,483,647 milliseconds.
- `generateUUID`: UUID v4 generation.
- `capitalize`: trims and uppercases a string.
- `toResult`: normalizes success and error result objects.
- `checkIfFeatureEnable`: enables a feature only when its environment variable is exactly `1`; warning diagnostics never include the variable's value.
- `addTextToFile`: append text to a UTF-8 file.
- `handleErr`: report structured error context.
- `EVENTS`, `eventEmitter`: shared event names and emitter.
- `isDevMode`, `isProdMode`, `isTestingMode`: environment-mode constants evaluated when the module is loaded.

## Shared logging

Use the existing logger rather than calling `console` from application or domain code. Prefer structured fields and never pass credentials, tokens, or private keys.

```js
import { defaultLogger } from "@coinzilla/utils"

defaultLogger.info({
  message: "Market data subscription started",
  symbol: "BTCUSDT",
})
// Emits one structured log entry through the shared logger.
```

Inject a logger into workflows/adapters when the dependency should be explicit or replaced in tests. Do not create an app-local logger just to wrap the shared implementation.

### Structured error diagnostics

Pass native `Error` and `AggregateError` instances as structured values; do not reduce them to `String(error)` or `error.message` at call sites. The shared formatter normalizes errors to JSON-compatible objects containing `name`, `message`, and `stack` when available, recursively includes `cause`, and includes `AggregateError.errors` as an array. This works for direct errors and errors nested in objects or arrays.

Circular references on the active traversal path are represented as `[Circular]`; repeated non-circular references are serialized normally. Properties whose getters throw are represented as `[Unreadable property]`; hostile proxy enumeration is contained. Common sensitive field names continue to be redacted recursively, including inside normalized error causes. The formatter does not inspect secrets embedded in free-form messages or stack text, so callers must not place credentials or signed request data in those strings. If JSON serialization still fails (for example, because a structured value contains a BigInt), the existing safe string fallback is used.

The normalized diagnostic shape intentionally allowlists standard Error diagnostics rather than copying arbitrary custom Error properties; it is intended for logs, not for reconstructing executable Error instances.


## Validation and compatibility

Malformed validator tuples are rejected with a descriptive `TypeError`. Existing `Validator`, `VR`, and `NH` APIs remain available through the public entry point. `wait()` rejects invalid timer durations instead of allowing Node.js to silently clamp or reinterpret them.

Filesystem and console effects remain at their respective boundaries. Pure numeric, validation, log-formatting, and wait-duration logic lives in independently testable internal modules.

## Development

```sh
pnpm --filter @coinzilla/utils test
pnpm --filter @coinzilla/utils test:coverage
```

The coverage command enforces at least 90% line coverage and 85% branch coverage for production source files.

## Exact decimal arithmetic

> **Financial safety:** the existing `NH` and `number-operations` helpers use JavaScript `Number`. They are suitable only where floating-point behavior is acceptable. Do not use them for balances, quantities, prices, fees, or other exact financial values; use the decimal-string API below.

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
