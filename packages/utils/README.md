# @coinzilla/utils

Domain-neutral helpers shared across the Coinzilla workspace. The package uses native Node.js APIs and has no runtime dependencies.

## Public API

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

## Validation and compatibility

Malformed validator tuples are rejected with a descriptive `TypeError`. Existing `Validator`, `VR`, and `NH` APIs remain available through the public entry point. `wait()` rejects invalid timer durations instead of allowing Node.js to silently clamp or reinterpret them.

Filesystem and console effects remain at their respective boundaries. Pure numeric, validation, log-formatting, and wait-duration logic lives in independently testable internal modules.

## Development

```sh
pnpm --filter @coinzilla/utils test
pnpm --filter @coinzilla/utils test:coverage
```

The coverage command enforces at least 90% line coverage and 85% branch coverage for production source files.
