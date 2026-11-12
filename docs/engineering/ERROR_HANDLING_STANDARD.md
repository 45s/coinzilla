# Structured error handling standard

This document defines the repository-wide contract for application and package errors. It applies to all applications, packages, scripts, tests, and shared infrastructure.

## Goals

Every actionable failure should identify **which component failed, which operation failed, and why**, while preserving the original failure for diagnosis. Error types and codes are part of the internal diagnostic contract; they must not become vague labels that hide the actual cause.

The standard is adopted incrementally. New functionality MUST follow it from its first implementation. When a bug fix or maintenance change touches legacy error handling, improve the touched path where doing so is relevant and safe. Do not launch broad mechanical rewrites solely to rename existing errors.

## 1. Shared base error

The common base class is named `SystemCustomError`. There must be one shared implementation; packages and applications must not create competing copies of the base class.

The owning shared module/package for this base is selected during the initial implementation stage after checking dependency direction, package ownership, and the [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md). The base must not introduce dependency cycles or make domain packages depend on application code.

The base should extend the native `Error`, set `name` to the concrete subclass name, and support the standard native `cause` option. It may expose the following structured fields where applicable:

- `code`: a stable, machine-readable, domain-scoped identifier.
- `cause`: the original error or lower-level error, preserved without replacing its identity.
- `context`: a small, safe object containing relevant diagnostic facts.
- `retryable`: an explicit boolean only when the operation can meaningfully be classified as retryable or permanent.

Do not add speculative fields or a complex error framework. Keep the base small and independent of logging, transport, persistence, application services, and domain policy.

## 2. Package- and feature-owned subclasses

The component that owns the failed operation owns its specific error classes and codes. Examples include:

- Journal: `JournalReadError`, `JournalWriteError`, `JournalValidationError`.
- Notifications: `NotificationMessageError`, `NotificationDeliveryError`.
- Command Center: `CommandCenterOperationError`, `CommandValidationError`.
- Authentication: `LoginError`, `AuthenticationError`.
- Trading: `TradingEngineError`, `TradingExecutionError`, `AccountAuditError`.
- Configuration: `ConfigLoadingError`, `ConfigValidationError`.
- Brokers: `BrokerConnectionError`, `OrderSubmissionError`, `MarketDataError`.

These are examples, not a mandatory class catalogue. Choose names that identify the owning component and failed operation. Do not create a new class for every function or every expected outcome.

Error codes MUST be stable, unique within the repository, descriptive, and suitable for log filtering and tests (for example, `JOURNAL_EVENT_VALIDATION_FAILED`). Do not derive codes dynamically from messages, stack traces, or class names. Do not reuse one generic code for unrelated failures.

Keep subclasses close to the implementation they describe, normally in a cohesive `errors/` module within the owning package or feature. Export only types that are part of that component's intended public diagnostic contract.

## 3. Wrapping and propagation

- Preserve the lower-level error with native `cause` whenever adding component or operation context.
- Wrap an error when crossing a meaningful architectural boundary or when the current layer can add useful context. Do not wrap at every function call.
- Do not replace a specific lower-level error with a generic error that discards its type, code, or cause.
- Do not repeatedly wrap an error with identical context or log the same failure at every layer.
- If an error is intentionally handled, recovered, retried, or suppressed, make that decision explicit and test it.
- Do not use exceptions for ordinary control flow when a result value or explicit state is clearer.
- Normalize non-`Error` thrown values at an appropriate external boundary; do not assume every caught value has `message`, `stack`, or `cause`.

A higher-level error should answer what the owning operation failed to do. Its `cause` should answer what lower-level failure made that operation fail.

## 4. Diagnostic context and security

Include only context that materially helps identify the failure, such as:

- component and operation;
- lifecycle stage or state transition;
- safe entity identifiers (for example, event type, market symbol, order/client identifier, or configuration key);
- stable error code and retry classification;
- the original cause.

Context must be bounded, intentional, and safe to log. Never attach credentials, API secrets, access tokens, private keys, authentication material, or unrestricted account/payload snapshots. Redact or summarize external data. Avoid storing mutable internal objects or entire request/response graphs in error instances.

Error messages should be concise and actionable. Put machine-readable detail in fields, not in a message that callers must parse. Do not expose internal stack traces or sensitive context to end users or notification recipients.

## 5. Logging and reporting

Log at the boundary that owns the operational decision or at the actionable failure point. Use structured fields including the error name, stable code, operation/component, safe context, and original cause when available.

- Preserve the original error object for logger/telemetry integrations where supported.
- Avoid duplicate logs when an error is rethrown unchanged.
- Do not log and then silently continue unless that is an explicitly tested recovery policy.
- A logging or notification failure must not mask the original operational failure.
- User-facing messages should be safe and understandable; detailed diagnostics belong in protected logs.

The standard complements the repository-wide reliability and security principles in [Engineering Standards](../../ENGINEERING_STANDARDS.md).

## 6. Incremental adoption rules

1. **New functionality:** introduce or reuse the owning component's specific error types and stable codes as part of the feature, with tests.
2. **Bug fixes:** when changing a path that throws, catches, wraps, or reports errors, improve that path to the standard where relevant. Add regression coverage for the failure and preserved cause/context.
3. **Refactoring:** migrate legacy errors when the code is already being materially changed or when a concrete diagnostic defect warrants a focused task.
4. **Untouched legacy code:** do not require unrelated files to be rewritten. Do not add a mass migration solely to make naming uniform.
5. **Shared error infrastructure:** change the base contract only through a focused cross-domain task with consumer review and compatibility tests.

Every pull request that adds or materially changes error handling must state the affected error types/codes and demonstrate that the original cause and safe context remain available. Update the owning package's documentation when its public error contract changes.

## 7. Required tests

Tests for new or materially changed error behavior should verify, as applicable:

- the concrete subclass and its `name`;
- the stable error `code`;
- original `cause` identity and useful cause chain;
- safe, relevant `context` and absence of secrets;
- retryable/permanent classification when defined;
- propagation and wrapping at the intended architectural boundary;
- behavior when logging, reporting, or recovery itself fails;
- compatibility of public exports and any serialized diagnostic representation.

Use deterministic tests and meaningful assertion messages. Follow the mandatory RED → GREEN → REFACTOR process in [Engineering Standards](../../ENGINEERING_STANDARDS.md).

## 8. Adoption roadmap

The root [engineering roadmap](../../ROADMAP.md) tracks the staged introduction and gradual migration. Do not interpret this standard as authorization for a one-shot repository-wide rewrite.
