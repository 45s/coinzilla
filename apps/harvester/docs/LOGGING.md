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

Terminal severity labels are colored when stdout is an interactive terminal and `NO_COLOR` is not set: INFO blue, DEBUG magenta, TRACE bright magenta, SUCCESS green, SYSTEM cyan, WARN yellow, and ERROR red. Non-interactive output remains plain text. The terminal is intentionally a summary, not a second diagnostic dump: it prints the event message plus a small allowlist of actionable fields, omits stacks/fingerprints/audit internals, and caps each line at 200 characters. Consecutive identical summaries are suppressed and reported as a repeat count. Full structured entries—including stack traces and all other normalized fields—remain in the DEBUG/TRACE JSONL files. Each entry
retains its timestamp, normalized severity, logging method, and redacted,
JSON-safe structured data. A console threshold change does not change either
file threshold.

The log directory is relative to the Harvester working directory. Run
`pnpm --filter @coinzilla/harvester dev` from the repository root, or run
the package command from `apps/harvester`.

## Runtime commands

In an interactive development terminal:

- `/log info` — concise INFO-and-higher console output (default).
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
