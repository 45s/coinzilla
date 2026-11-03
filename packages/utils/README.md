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

Circular references are represented as `[Circular]`. Properties whose getters throw are represented as `[Unreadable property]`; hostile proxy enumeration is contained. Common sensitive field names continue to be redacted recursively, including inside normalized error causes. The formatter does not inspect secrets embedded in free-form messages or stack text, so callers must not place credentials or signed request data in those strings. If JSON serialization still fails (for example, because a structured value contains a BigInt), the existing safe string fallback is used.

The normalized diagnostic shape is intended for logs, not for reconstructing executable Error instances.

## Validation and compatibility

Malformed validator tuples are rejected with a descriptive `TypeError`. Existing `Validator`, `VR`, and `NH` APIs remain available through the public entry point. `wait()` rejects invalid timer durations instead of allowing Node.js to silently clamp or reinterpret them.

Filesystem and console effects remain at their respective boundaries. Pure numeric, validation, log-formatting, and wait-duration logic lives in independently testable internal modules.

## Development

```sh
pnpm --filter @coinzilla/utils test
pnpm --filter @coinzilla/utils test:coverage
```

The coverage command enforces at least 90% line coverage and 85% branch coverage for production source files.

