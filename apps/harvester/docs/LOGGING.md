# Harvester logging

Harvester uses the shared `Logger` and `defaultLogger` from `@coinzilla/utils`.
Do not add an application-local logger or write application diagnostics directly
to the terminal.

## Destinations and thresholds

Harvester groups process-specific files under one directory and keeps
append-only cumulative histories separately:

```text
logs/
├── cumulative/
│   ├── harvester.log
│   ├── trace.log
│   └── terminal.log
└── sessions/
    └── <UTC timestamp>-<runtime session ID>/
        ├── harvester.log
        ├── trace.log
        ├── terminal.log       # development runner only
        ├── process-identity.json
        ├── log-streams-completed.json  # written after DEBUG/TRACE transport close
        ├── process-completed.json     # written after process completion
        └── <UTC timestamp>-<runtime session ID>.jsonl
        └── <UTC timestamp>-<runtime session ID>.jsonl
```

The DEBUG, TRACE and terminal files use short, stable names inside the same
process directory. The Journal JSONL file is created by the Journal package
using the same UTC timestamp and runtime session ID in its filename. Its
records are application events, not copies of diagnostic log lines. The
directory name, structured log files, terminal capture and
`harvester.process_started` event all share one immutable process identity.
Session files are created exclusively and are never overwritten. `configureHarvesterLogging()` persists `process-identity.json` for direct starts; when the DEV runner has already created that file, the logger verifies the runtime ID and start time rather than replacing it. After both DEBUG and TRACE transports close successfully, the logger writes `log-streams-completed.json` with the same runtime-session ID and an explicit per-stream flush result. A direct start also writes `process-completed.json` from the logger close handler. The DEV runner writes `process-completed.json` only after the child exits and only marks `logStreamsComplete=true` when the logger flush marker and terminal capture both succeeded. If the process crashes or any stream fails to close, one or both completion records are missing/incomplete and the archive collector rejects the evidence. While a process is active, the collector can instead create a separate immutable `active-process-snapshot.json` in the archive after verifying and rechecking the owning process lock; it does not write that marker into the running session directory.

When the Operational State Store is enabled, its durable `PROCESS_STARTED` fact also records the allowlisted process identity (PID, runtime-session ID, original start time, package version, source revision, and worktree state). Existing facts without this optional provenance field remain readable; new production starts include it when the entrypoint process identity is available. Debug archive tooling matches the archived committed recovery checkpoint only to a TESTNET session with the exact same runtime-session ID and process identity. A stopped session must have matching process-completion and logger-flush records. A running session may be captured without stopping Harvester when a live same-host process lock matches the session PID and start time; the collector reads but never changes or removes either process lock. Active sessions are labelled `active`, and the archive records an `active-process-snapshot.json` marker bound to the process identity and recovery checkpoint rather than inventing completion records. Append-only files are copied only through the byte length observed at the snapshot boundary, and the copied recovery-facts checkpoint is validated from the archive itself. If ownership is ambiguous, a stream is missing/empty, a file is replaced/truncated, or the lock changes during collection, publication is rejected. Rotated and already-compressed DEBUG/TRACE files are preserved with per-file source/archive provenance and checksums; unrelated sessions remain separate evidence, and the newest session is never substituted.

The cumulative DEBUG, TRACE and terminal files append across process runs.
The console is not a file: it displays a compact INFO-and-higher summary and
remains independently configurable.

Complete console lines (timestamp, level, message, and displayed details) are
colored when stdout is an interactive terminal and `NO_COLOR` is not set.
INFO is blue and its label is omitted—the color already communicates the
level. SYSTEM is cyan and its label is also omitted for the same reason.
DEBUG remains magenta, TRACE bright magenta, SUCCESS green, WARN yellow, and
ERROR red. `SUCCESS` and `SYSTEM` retain their semantic methods in structured
log entries even though both use INFO severity for transport filtering.
Non-interactive output remains plain text. The terminal is intentionally a
summary, not a second diagnostic dump: it prints the event message plus a
small allowlist of actionable fields (including the stable `diagnosticId`
for catalogued startup failures), omits stacks/fingerprints/audit internals,
and caps ordinary lines at 200 characters. Catalogued failures use a dedicated
operator format: stable `diagnosticId`, exact failure `stage`, the concrete
`cause`, and a short `action` are prioritized in that order. If the cause does not fit, continuation lines preserve it in bounded chunks while
the first line retains the stable identity, stage and action. The complete
original error and nested cause/stack remain in the DEBUG/TRACE session files.
The catalog source is
[`harvester-error-catalog.js`](../src/infrastructure/logging/harvester-error-catalog.js);
its tests enforce unique codes, complete operator guidance, one-look output for
every registered entry, bounded continuations, and synchronization with the
[operator error vocabulary](./error-vocabulary.md). Relational
history preparation reports a stable Harvester error code separately from
the native SQLite `errorCode`, and identifies connection, migration, and
backup stages. A persistence-projection failure does not authorize database
deletion, reset, or repair.

Order-history projection failures additionally show the safe validation `field`,
market `symbol`, affected `clientOrderId`, and stable `errorCode`. Those fields
participate in the console duplicate fingerprint, so different validation
fields or affected orders are not collapsed into one repeated-entry summary;
exact repeats for the same field/order remain compacted with their repeat count.
The recovery SELL cancellation summary is rendered as `04:30:15 🟡 CG recovery SELL cancellation requested:
DOGEUSDT, reason BUY_FILLED_RECALCULATE_RECOVERY_SELL`, with the redundant
`Harvester` prefix omitted and symbol/reason shown inline. Full structured
entries—including stack traces and all other normalized fields—remain in the
DEBUG/TRACE JSONL files. Each entry retains its timestamp, normalized
severity, logging method, and redacted, JSON-safe structured data. A console
threshold change does not change either file threshold.

The log directory is relative to the Harvester working directory. Run
`pnpm --filter @coinzilla/harvester dev` from the repository root, or run
the package command from `apps/harvester`. The development runner resolves
the package directory from its own script location and starts the child with
that working directory, so its terminal files always live in the canonical
`apps/harvester/logs/` directory.

The development runner appends raw child stdout and stderr to
`apps/harvester/logs/cumulative/terminal.log` and the `terminal.log` inside the current process session directory.
Both files receive identical raw output. The runner opens both destinations
before starting the child; a session-name collision or stream-open failure
stops startup without overwriting an existing session. Durable file capture
applies backpressure so output is not intentionally discarded during normal
disk operation. The VS Code/console display is best-effort and bounded: if the
terminal stops consuming output, display chunks are skipped until it catches
up, while file capture continues. At shutdown, the runner reports the number
of skipped display chunks when stderr is writable. A terminal-log write
failure is reported and stops the child process; no software can guarantee
capture through a storage failure.

The standalone `pnpm --filter @coinzilla/harvester start` command creates
structured DEBUG and TRACE session files using its own process identity. It
does not run the development terminal-capture runner and therefore does not
create terminal log files.

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
| `Harvester connected and subscribed to 2 enabled markets` | `Binance market-data stream connected; subscriptions: 2.` |
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

### Portfolio Stats

Portfolio Stats remains a structured event in DEBUG/TRACE. The operator
console renders one compact line:

`🪙 CG PORTFOLIO DOGEUSDT: amount: 3.4 | earned: 3.4 | spent: 0 | net: 0.020`

- `amount` — total base quantity: active trading inventory plus retained coins.
- `earned` — retained/free base quantity accumulated from completed recovery cycles.
- `spent` — BUY cost for the current recovery cycle. It resets to zero when that
  cycle completes; it is not lifetime spend.
- `net` — cumulative quote net cash flow from confirmed BUY/SELL fills, including
  applicable commissions, rounded to three decimal places.

The base-coin unit is implied by the market symbol. The line must not print nested
inventory/accounting JSON and must remain within the ordinary 200-character
console budget.

### Startup connection summary

Name the connected resource explicitly and keep the terminal summary compact:
`Binance market-data stream connected; subscriptions: 4.` The count is the
number of enabled market subscriptions. This summary identifies the
market-data stream only; it does not imply that user-data readiness or trading
readiness has been established. The trading-mode connection message remains
`Binance market-data stream connected; Binance trading mode is TESTNET.`

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
SYSTEM entries remain cyan, but infrastructure/application records have no decorative ownership marker. Strategy markers are reserved for records with a canonical strategy owner.

## Shutdown phase terminal records

Shutdown work phases use one compact, 24-hour local-time terminal line:

```text
21:25:57 shutdown phase MARKET_INTAKE_STOP STARTED
21:25:57 shutdown phase MARKET_INTAKE_STOP COMPLETED
21:25:57 shutdown phase BROKER_DISCONNECT FAILED
```

`STARTED` means the phase operation began, `COMPLETED` means it returned under
its existing success criteria, and `FAILED` means its existing failure
criteria were met. These labels describe the current lifecycle outcome; they
do not change shutdown ordering or failure semantics.

The shared console transport owns terminal rendering and deduplication; lifecycle owners continue emitting structured phase records rather than formatting terminal text themselves.

The phase formatter normalizes and validates the phase/status tokens and timestamp
before producing a line. Malformed records fall back to the ordinary compact-
summary path. Formatting does not mutate the structured input.

The instantaneous `SHUTDOWN_REQUESTED` and `STOP_STATE_ESTABLISHED` milestones
are printed as `shutdown requested` and `shutdown state established`, not as
work phases. All other valid phase transitions retain their actual phase
identifier and status. The terminal phase line contains no JSON details,
correlation IDs, duration, or failure prose.

Consecutive duplicate suppression remains enabled. Its fingerprint includes
the normalized phase/status pair alongside the existing log level and method,
so different phases or statuses are always visible. A bootstrap composition regression creates the startup context with an explicit RS route, invokes its default market-price reporter, and verifies the emitted RS strategy ID and unchanged error payload without starting a broker or trading engine.

Strategy identity is part of the console duplicate-suppression fingerprint.
Identical messages from different strategies therefore remain separate
records. Structured DEBUG/TRACE files retain the strategy ID as a field.

## Order lifecycle terminal records

Order lifecycle events use a compact terminal formatter with consistent
columns across Coin Grabber and Recovery Seller. Keep the strategy marker and
label separated by one space; avoid oversized column gaps and explanatory
client-ID labels:

\`\`\`text
TIME STRATEGY STATUS ORDER SYMBOL SIDE QUANTITY @ PRICE CLIENT ID
19:14:52 🪙 CG SUBMITTED #pending ADAUSDT BUY 50.00 @ 0.15260 h-325e71ba16494aeb875e6e-3
19:14:52 🪙 CG ACCEPTED #1341114 ADAUSDT BUY 50.00 @ 0.15260
19:14:53 🔴 RS PARTIAL FILL #1341115 ADAUSDT SELL 49.90 @ 0.15410 | Executed: 20 | Remaining: 29.90
\`\`\`

Order events are reconciled against the registered broker order ID when available, with client order ID as the fallback. Strategy identity is derived only from immutable OrderRegistry ownership:
🪙 CG for CG_coinGrabber and 🔴 RS for RS_recoverySeller. It never changes with
order status. Unowned diagnostics have no strategy marker. Supporting the RS
label does not enable RS runtime execution.

Lifecycle status is plain text and never replaces the strategy identity.
Only strategy-owned records carry 🪙 CG or 🔴 RS; unowned system/application
records have no icon. Keep the field order compact and separate every field
with a single space: time, strategy, status, broker order ID (or `#pending`),
symbol, side, quantity, price, and pending client ID when needed. Do not pad
columns with large fixed-width gaps. Keep quantities/prices exact and do not
truncate order or client IDs.

SUBMITTED is emitted after the durable submission-intent barrier and immediately
before broker I/O; because the exchange order ID does not exist yet, the order
column shows `#pending` and the detail line preserves the client order ID.
ACCEPTED follows the canonical broker acknowledgement and registry update, and
carries the exchange-assigned broker order ID.
PARTIAL FILL and terminal states are logged only after canonical fill
reconciliation. CANCEL REQUESTED is logged after the durable cancellation
intent barrier and before the broker RPC. CANCELLED is logged only when the
canonical cancellation transition has been applied. Keep cancellation outcome
quantities (for example, `Executed: 0 | Cancelled: 400`) on the same terminal
line as the cancellation event. A fill that wins a cancellation race remains
FILLED; a later stale cancellation report is shown as an unowned informational
`STALE CANCEL IGNORED` record, never as a cancellation.
Stale and duplicate order reports are discarded before terminal fill-history
reconciliation; a duplicate FILLED report is still allowed to complete any
previously unprocessed canonical fill transition.

The engine owns successful order lifecycle logging after canonical reconciliation. The user-data boundary does not emit a second raw receipt or generic processed-event line.

No-op duplicate reports do not create repeated lifecycle records. Partial
fills and partially filled cancellations append exact-decimal executed and
remaining/cancelled quantities to the same line, separated by ` | `. Full
structured exchange evidence and diagnostic context remain in the DEBUG/TRACE
files; the terminal is the compact operator view.

When a broker order ID is not available yet (for example, a pending
submission), display `#pending` in the order-ID column and append the raw client
order ID at the end of that same line. Do not add `Client:`, `Client order ID:`,
or a separate indented line. The logger never derives strategy identity from a
client-order-ID prefix.

## Telegram Command Center interaction diagnostics

Inbound Telegram interactions use the existing Harvester logger through a structured diagnostic boundary. Every update is correlated by `telegram:<update_id>`; redelivered updates retain the same correlation ID. The interaction record identifies message versus callback, command/action, market symbol when relevant, application query/use-case, stage, and duration where applicable.

Telegram lifecycle records are emitted at INFO so they appear in the terminal as well as the structured DEBUG log; detailed exception stacks and nested causes remain available in the structured logs. The lifecycle includes `Telegram update RECEIVED`, `Telegram interaction AUTHORIZED` / `REJECTED`, `Telegram command STARTED`, `Telegram query STARTED` / `COMPLETED`, `Telegram market selection RECEIVED`, `Telegram confirmation REQUESTED` / `RECEIVED` / `CANCELLED`, `Telegram callback ACKNOWLEDGED`, `Telegram application operation STARTED` / `COMPLETED`, `Telegram response SENT`, and `Telegram interaction FAILED` / `HANDLED`. There are no per-poll success logs. Authorization rejections use WARN; failed queries, application operations, callback acknowledgements and response delivery use ERROR.

For state-changing actions, preserve the distinction between `applicationOperationInvoked`, `applicationOperationCompleted`, and `stateChanged`. A selection or confirmation page is not a successful pause/resume. A response-delivery failure after a completed application operation must not be reported as an application-operation failure.

Thrown errors are logged once at the appropriate interaction boundary with their original name, code, message, stack, and nested cause details. Non-exception failures use a stable `failureClassification` and safe `errorMessage`; do not manufacture an exception merely to label a failed result. Read-only query failures are distinct from application-operation failures.

Never log full Telegram updates, callback payloads, bot tokens, allowlist IDs, API credentials, or full account/order payloads. Redact the configured bot token from messages and stacks. Do not log the same exception at every layer; preserve it while adding context at the boundary that owns the interaction. See the [Telegram Command Center runbook](operations/telegram-command-center.md) for stage interpretation and operator response.

## Relational runtime-error diagnostics

Harvester captures shared-Logger ERROR records from process logging setup onward. A bounded process-start buffer bridges the period before the environment-specific relational database is ready; after migration v4, a bounded asynchronous observer writes safe summaries to `runtime_errors`, correlated by the existing `runtime_session_id`.

The relational projection is intentionally non-authoritative. It does not control readiness, order ownership, trading decisions, or recovery. Explicit strategy/order facts are stored only when present in the logger entry; unknown or external events remain unattributed. The table has no foreign keys to orders or fills because a useful diagnostic can exist without either row.

The existing per-session DEBUG/TRACE JSONL files remain the complete diagnostic record, including stack and cause details. The relational mapper stores allowlisted fields and selected history-page diagnostics, redacts credential assignments from searchable messages, and excludes raw payloads and stack traces. The pre-database buffer and database writer are bounded; their dropped/failed counters expose when the relational projection is incomplete. Such failures are reported to the session logs and never block trading or broker-event handling.

At shutdown, the error observer stops accepting new relational records and drains its queue before the relational SQLite connection closes. If the database is unavailable or a write fails, inspect the session DEBUG/TRACE logs; absence of a relational row is not proof that no runtime error occurred.

Rejected order lifecycle summaries omit the broker order ID to prioritize the
market, side, quantity, price, and concise rejection reason. Example:

```text
21:45:17 🟡 CG REJECTED LINKUSDT BUY 2 @ 9.244 | Insufficient quote balance
```

Startup's market-data connected summary reports only the subscription count
(`Binance market-data stream connected; subscriptions: 5.`). Operator-facing
console summaries abbreviate Operational State Store as `OSS`; full structured
records and diagnostic files retain their diagnostic detail.

Startup failure descriptions preserve the concrete error name, stable/native
code, message, stack and nested cause chain. Credential-bearing fragments in
those message/stack strings are redacted (bot tokens, labelled API keys,
secrets, authorization values, passwords and URL userinfo); structured context
continues through the shared logger's sensitive-field redaction. The original
in-memory Error objects are not mutated.
