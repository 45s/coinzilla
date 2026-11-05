# Harvester logging

Harvester uses the shared `Logger` and `defaultLogger` from `@coinzilla/utils`.
Do not add an application-local logger or write application diagnostics directly
to the terminal.

## Destinations and thresholds

When the CLI starts, it configures three independent destinations:

| Destination | File | Minimum severity |
| --- | --- | --- |
| Console | terminal | INFO |
| Development diagnostics | `logs/harvester.log` | DEBUG |
| Detailed trace | `logs/harvester-trace.log` | TRACE |

Complete console lines (timestamp, level, message, and displayed details) are colored when stdout is an interactive terminal and `NO_COLOR` is not set. INFO is blue and its label is omitted—the color already communicates the level. DEBUG remains magenta, TRACE bright magenta, SUCCESS green, SYSTEM cyan, WARN yellow, and ERROR red. `SUCCESS` and `SYSTEM` retain their semantic method labels even though both use INFO severity for transport filtering. Non-interactive output remains plain text. The terminal is intentionally a summary, not a second diagnostic dump: it prints the event message plus a small allowlist of actionable fields, omits stacks/fingerprints/audit internals, and caps each line at 200 characters. Consecutive identical summaries are suppressed and reported as a repeat count. Full structured entries—including stack traces and all other normalized fields—remain in the DEBUG/TRACE JSONL files. Each entry
retains its timestamp, normalized severity, logging method, and redacted,
JSON-safe structured data. A console threshold change does not change either
file threshold.

The log directory is relative to the Harvester working directory. Run
`pnpm --filter @coinzilla/harvester dev` from the repository root, or run
the package command from `apps/harvester`.


## Message design

Log messages describe the event or state transition—not the application that
emitted it. The application identity is already known from the process and log
destination. Do not prefix messages with `Harvester`, `App`, or a subsystem
name unless that distinction is genuinely needed to disambiguate the event.

Prefer short, specific, past-tense descriptions:

| Avoid | Prefer |
| --- | --- |
| `Harvester order event processed` | `Order update processed` |
| `Harvester subscribed to market prices` | `Market data subscribed` |
| `Harvester connected and subscribed to 2 enabled markets` | `Connected; subscribed to 2 markets` |
| `Harvester market price error handler failed` | `Market price error handler failed` |

Keep variable context in structured fields rather than embedding it in the
message. Include only fields that help identify or diagnose the event, such as
`symbol`, `side`, `price`, `quantity`, `action`, `status`, or a concise
`reason`. Use stable field names and machine-readable values.

### INFO versus DEBUG

INFO is the operator-facing event stream. Use it for:
- Startup readiness, connection/subscription completion, and shutdown outcomes.
- Order submissions, acknowledgements, fills, cancellations, and rejects.
- Trading decisions that produce an action, a pause, or another meaningful
  state transition.
- Errors that require attention, with a concise actionable reason.

Do not emit an INFO record for every routine market tick or every
`NO_ACTION` evaluation. Those high-frequency diagnostic details belong at
DEBUG (or TRACE when they include detailed internal state). A quiet market
should not flood the operator-facing console.

### Avoid duplicate and low-value messages

- Emit one record for one meaningful event. Do not log the same event once as
  "received" and again as "processed" unless the two records describe distinct,
  actionable stages and the distinction is useful.
- Do not restate information already obvious from the message or process
  context. For example, do not include `application: "harvester"` or repeat
  the symbol in both the message and structured fields.
- Prefer a completed outcome over vague activity wording: say what connected,
  what was subscribed, what order was accepted, or what failed.
- Keep messages stable and concise; put changing values in structured fields.
  Do not include full payloads, stack traces, internal snapshots, or
  serialization details in INFO output.

### Examples

A concise operator-facing record:

```js
logger.info({
  message: "Order filled",
  symbol: "DOGEUSDT",
  side: "BUY",
  price: "0.0722",
  quantity: "400",
})
```

A routine evaluation belongs in DEBUG rather than INFO:

```js
logger.debug({
  message: "Market evaluated",
  symbol: "DOGEUSDT",
  action: "NO_ACTION",
  price: "0.07223000",
})
```

These are message-design examples, not a claim that every current call site
already follows this policy. When changing a log call, update its tests and
keep the console allowlist in sync with any new fields intended for INFO.


### SYSTEM lifecycle events

Use `logger.system()` for meaningful infrastructure and process lifecycle
transitions. These are operator-visible state changes, not routine diagnostics.
Examples include:

- Journal started and closed successfully.
- Broker/WebSocket API connected and disconnected.
- User-data stream established or lost, and recovery completed.
- Market/book-ticker subscriptions established and all enabled markets ready.
- Trading engine activated after startup checks pass.
- Process startup readiness and shutdown completion.

Do not use SYSTEM for every incoming event, market tick, strategy evaluation,
or repeated connection-status heartbeat. Those belong at DEBUG or INFO
according to whether they represent an operator-relevant trading event.
SYSTEM entries are cyan and retain the visible `SYSTEM` label, making lifecycle events easy to distinguish from blue INFO output.

## Runtime commands

In an interactive development terminal:

- `/log info` — concise INFO-and-higher console output (default); INFO messages are blue and do not print an `INFO` prefix.
- `/log debug` — include DEBUG on the console.
- `/log trace` — include TRACE on the console.
- `/log status` — print the current transport configuration.

These commands only change the console transport. DEBUG and TRACE files keep
recording independently. Commands are disabled when stdin is redirected or
non-interactive; the process continues to use stdin normally in that case.

## Lifecycle

The file transports are attached to the shared logger once during CLI startup.
They are removed and their streams are closed after runtime, Journal, and
EventBus shutdown. They are also closed after a startup failure. Transport
write failures are surfaced by the shared logger's transport error handling;
they do not change trading decisions or Journal events.

Logging is diagnostic only. It does not alter trading state, order execution,
accounting, event publication, or Journal persistence semantics.
