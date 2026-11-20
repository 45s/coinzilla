---
title: Logging and observability standard
status: active
type: engineering-standard
owner: repository engineering
created: 2026-11-20
---

# Logging and observability standard

This is the canonical repository-wide policy for diagnostic logging and operational observability. It applies to applications, packages, adapters, scripts, and shared infrastructure.

The public logger implementation and API are owned by [`@coinzilla/utils`](../../packages/utils/README.md). This standard defines how consumers use it. Domain-owned documents may define their event vocabulary, operator-facing summaries, retention and operational procedures, but must link here for shared rules.

Use the [Structured Error Handling Standard](structured-error-handling.md) for error ownership, classification, causes, retry decisions, and unknown outcomes. A log record does not replace an error contract, durable audit record, Journal event, or domain database fact.

## 1. Core principles

- Use the public `Logger` or `defaultLogger` export from `@coinzilla/utils` for application and package diagnostics.
- Emit structured records with stable field names and machine-readable values. Keep messages concise and put changing values in fields.
- Log meaningful events at the boundary that owns the operation or state transition. Do not emit the same failure at every layer.
- Separate operator-relevant operational events from high-volume diagnostic detail.
- Keep credentials, tokens, private keys, signed requests, and sensitive payloads out of messages, fields, Error messages, and stacks.
- Logging is diagnostic. It must not become trading, accounting, authorization, readiness, reconciliation, or persistence authority.
- A logging or transport failure must not silently change the result of the business operation. If a fact must be durable or auditable, persist it through the owning domain contract.

## 2. Structured record contract

The shared Logger sends each eligible transport a frozen record with this shape:

```js
{
  timestamp: "2026-11-20T12:30:00.000Z",
  level: "info",
  method: "info",
  data: {
    message: "Market-data subscription completed",
    operation: "subscribe-market-data",
    symbol: "BTCUSDT",
    status: "COMPLETED",
    correlationId: "subscription-42"
  },
  context: {
    application: "example-app",
    runtimeSessionId: "runtime-session-7"
  }
}
```

- `timestamp` is created once per logger call.
- `level` is the normalized severity used for transport filtering.
- `method` preserves the method called, including semantic methods such as `success` and `system`.
- `data` contains the event or diagnostic fields supplied by the caller. The shared formatter detaches, normalizes and freezes the record.
- `context` is optional process-level context configured on the Logger instance. It is separate from caller data and is detached, normalized, redacted and frozen.

When designing a record:

- Prefer one stable field name for one concept across a domain. Use domain terms for identifiers; do not introduce a generic `id` when the entity type matters.
- Include only fields that help identify the event, affected operation/entity, resulting state, or relevant failure.
- Use exact strings for financial quantities and prices; do not log rounded display values as if they were authoritative values.
- Keep messages stable and concise. Do not interpolate changing values that should be structured fields.
- Do not repeat information already present in process context or in another field without a diagnostic reason.
- Avoid logging full request/response payloads, internal object snapshots, or every field merely because it is available.

## 3. Severity and semantic methods

Use the following severity meanings consistently. Severity indicates the diagnostic importance of a record; it does not define business state or imply process termination.

| Method / level | Intended use |
|---|---|
| `trace` | Very detailed internal steps or state needed for focused diagnosis. Assume high volume; never use it as a reason to include secrets or unbounded payloads. |
| `debug` | Routine evaluations, intermediate decisions, and technical details useful when investigating behavior but not normally requiring operator action. |
| `info` | A meaningful completed operation, state transition, readiness change, or operator-relevant event. Keep this stream low-volume and actionable. |
| `warn` | An unexpected but handled or recoverable condition, discarded invalid external input, or explicitly degraded/fallback path that may need attention. State what was safely done. |
| `error` | An operation failed and needs diagnosis or action. Report it once at the owning boundary with its stable error identity and useful context. An ERROR record does not by itself mean the process is fatal. |
| `success()` | Semantic positive-outcome method mapped to INFO severity. Use only when the positive outcome is meaningful; it is not a separate severity. |
| `system()` | Semantic infrastructure/process-lifecycle method mapped to INFO severity. Use for meaningful lifecycle transitions, not every low-level event or heartbeat. |

A transport's minimum severity is independent of every other transport. The default console threshold is environment-dependent; do not infer that a record was absent from all destinations merely because it was filtered from the console. See the [Utils Logger API documentation](../../packages/utils/README.md#severity-levels-and-transports) for exact runtime defaults and configuration behavior.

Do not use INFO for every market tick, polling iteration, no-op evaluation, or repeated health heartbeat. Put routine detail at DEBUG/TRACE according to its diagnostic value. Do not downgrade a failure to WARN merely to keep the console quiet.

## 4. Operational events versus diagnostic detail

An operational event describes a meaningful fact visible to an operator, such as a connection becoming ready, an order being acknowledged, a fill being reconciled, or a lifecycle phase completing. A diagnostic record explains how an operation reached a decision or why an internal step behaved as it did.

- Emit one record for one meaningful event. A raw adapter receipt and a second generic “processed” message are duplicates unless they represent distinct stages that have separate operational value.
- Record a completed outcome where possible rather than vague activity wording.
- Use DEBUG/TRACE for repeated evaluations and high-volume internals; reserve INFO for meaningful transitions.
- Include the failure or fallback decision when it changes the operational interpretation of the result.
- Do not use logs as an audit ledger, event store, accounting source, or restart-recovery input. Persist authoritative facts through the owning domain's Journal/database contract.
- Do not make a strategy, broker, or application decision by parsing a log message or checking whether a log write succeeded.

The owning domain defines which business events are operationally meaningful and when the state transition is authoritative. This repository-wide standard does not prescribe a universal event catalogue.

## 5. Context and correlation

Distinguish stable process identity from per-operation correlation.

### Process context

Use `Logger.setContext(context)` for stable process-level identity such as application name, version, runtime-session ID, process ID, start time, and allowlisted build provenance.

The Logger context is a replaceable snapshot shared by every subsequent record written through that Logger instance. It is not scoped to an asynchronous request or task. Do not change the process-wide context for each request, order, market, or concurrent operation: concurrent work can overwrite another operation's context.

### Per-event correlation

Put operation-specific identifiers in the record's `data`, for example `correlationId`, `requestId`, `operationId`, `clientOrderId`, or a domain-owned entity identifier when applicable.

- Reuse the same correlation identifier across the stages of one logical operation and the boundaries it crosses.
- Preserve it when handing work to another use case, adapter, callback, or asynchronous continuation.
- Do not generate a new correlation identifier for every log line in the same operation.
- Do not invent a universal identifier or add a field to every record when the operation has no meaningful correlation requirement.
- Keep correlation creation, propagation and lifecycle ownership in the application/domain that owns the operation. The shared Logger does not provide implicit async-context propagation; do not add a generic propagation framework without a demonstrated cross-domain requirement.

## 6. Redaction and sensitive information

The shared formatter redacts common credential-bearing **field names** (including password, passphrase, secret, token, authorization, cookie, credential, API-key and private-key variants) recursively in structured objects before transport delivery. This is defense in depth, not a guarantee that arbitrary content is safe.

Important limitations:

- Redaction does not scan free-form strings, message text, stack text, URLs, or secrets embedded in arbitrary values.
- Native Error normalization includes its name, message, stack, cause, and `AggregateError.errors`. Sensitive fields inside structured causes are subject to field-name redaction, but the Error message and stack are not content-scrubbed.
- A provider error may contain a signed URL, credential, request header, account detail, or raw payload in its message or stack. Sanitize it at the owning adapter/boundary before logging if it may contain sensitive content.
- Never rely on a redaction pattern to make it acceptable to pass a credential or full external payload to the Logger.

Prefer allowlisted diagnostic fields and safe identifiers. Never log API keys, bot tokens, passwords, private keys, authorization headers, cookies, signed request URLs, or full credential-bearing configuration. Avoid unnecessary personal, account, order, or balance payloads; include only the minimum domain identifiers and facts needed for diagnosis.

The Logger's last-resort transport-failure fallback must remain a bounded safe summary. A custom `onTransportError({ transport, error })` callback receives the original error object; its owner is responsible for safe reporting. Do not re-emit the raw error if the custom reporter itself fails.

## 7. Error reporting and transport lifecycle

- Follow the [Structured Error Handling Standard](structured-error-handling.md) for error types, stable codes, causes, retryability and unknown outcomes.
- Log at the boundary that owns the failed operation or recovery decision. Lower layers should propagate the original error or return their declared failure result without producing duplicate ERROR records.
- Preserve useful error identity and causes in structured data, but first ensure the message and stack contain no secrets.
- The shared Logger isolates synchronous and asynchronous transport write/filter/cleanup failures and reports them through the configured transport-error callback. The default emergency fallback reports only safe transport/type metadata.
- A custom transport-error callback may receive the original error; it must not leak raw sensitive messages or stacks. Failure of the callback must not create an unhandled rejection or mask the original application failure.
- Applications that attach file or other resource-owning transports must close/remove them during their own shutdown lifecycle. Cleanup is owned by the component that registered the transport.
- Log rotation, file-size limits, retention, compression, archival, access control and disk monitoring are application/operations responsibilities. They are not generic Logger guarantees; document them in the owning application's runbook.

If logging itself is unavailable, use a direct `process.stderr.write` fallback only for a fatal startup/shutdown diagnostic when the shared logger is unavailable or has failed, as permitted by the [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md). This is not a routine second logging channel.

## 8. Side-effect and ownership boundaries

- Do not log from pure helpers, deterministic calculations, domain policies, or value objects. Return a decision/result and let the owning application or infrastructure boundary report the meaningful event.
- Inject a logger when making the side effect explicit or replacing it in a test materially improves the boundary. Otherwise use the public shared logger.
- Do not create an application-local wrapper logger merely to rename or forward shared methods. Domain-owned adapters are acceptable only when they add real domain context/formatting without changing the shared Logger contract.
- Keep broker protocol diagnostics with the broker adapter; keep strategy/order/accounting event meaning with the owning application/domain.
- Direct `console.log/info/warn/error` is prohibited in application and package business logic. The only exceptions are the shared logger implementation and deliberate CLI output where stdout/stderr is the product interface. The exact source-guard allowlist is maintained in the [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md); do not broaden it casually.

## 9. Verification expectations

Tests and reviews should prove the logging contract that the change affects:

- Correct severity/method mapping and per-transport threshold behavior.
- Stable structured fields, process context separation, and per-operation correlation propagation where applicable.
- No mutation of caller data; detached/frozen records where promised.
- Redaction of sensitive field names in nested structured data and Error causes, plus explicit tests that sensitive free-form messages/stacks are sanitized before they reach the Logger.
- No raw secret exposure through transport-error or emergency fallback reporting.
- Isolation of synchronous/asynchronous transport failures and cleanup failures; a broken transport must not prevent healthy transports from receiving entries.
- One meaningful event per state transition, no duplicate error reports, and no high-volume INFO spam for repeated no-op activity.
- Application-owned transport cleanup, retention and failure behavior where those contracts are changed.

Default tests must remain deterministic, offline and credential-free. Use synthetic secrets in redaction tests; never use real credentials or production payloads.

## 10. Observability scope

This standard governs structured diagnostic logs and the existing Logger API. It does not introduce or imply a workspace-wide metrics, distributed tracing, alerting, dashboard, or telemetry backend. Add such capabilities only for a demonstrated use case with a named owner, explicit data/security contract, tests, and operational maintenance plan.

Where a domain already has an event, Journal, metric or tracing contract, use that contract rather than duplicating it as a second source of truth.

## 11. Review checklist

- [ ] Is the record emitted at the boundary that owns the meaningful event or failure?
- [ ] Is its severity appropriate to operator impact and expected volume?
- [ ] Are the message and fields stable, structured, minimal and machine-readable?
- [ ] Are process context and per-operation correlation kept separate and correctly propagated?
- [ ] Are secrets and sensitive payloads excluded from fields, free-form strings, Error messages and stacks?
- [ ] Does logging remain diagnostic rather than authoritative for business state or recovery?
- [ ] Are duplicate, repeated, high-volume and lower-layer error records avoided?
- [ ] Are transport failures, cleanup, fallback, retention and stderr exceptions handled by their actual owners?
- [ ] Are the relevant behavior and security cases covered by deterministic tests?
