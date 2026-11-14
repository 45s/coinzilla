# @coinzilla/notifiers

Dependency-free notification adapters for Coinzilla. Telegram is the first supported transport and uses Node.js built-in fetch(). No Telegram SDK, queue package, Redis, or other runtime dependency is required.

## Package structure

Transport-specific implementation belongs under src/<transport>/. Keep the root entry point thin and expose only intentional public APIs.

    notifiers/
      src/
        index.js
        telegram/
          index.js
          telegram-notifier.js
          telegram-validation.js
          safe-error-message.js
          telegram-event-subscriber.js
          *.test.js
        email/    (future; create when implemented)
        discord/  (future; create when implemented)

Email and Discord are roadmap candidates, not implemented transports. Do not create empty placeholder folders or speculative shared abstractions. If another transport is added, keep its transport API, validation, tests, and provider-specific behavior inside its own folder; application message templates remain with consuming applications. Extract shared functionality only when multiple real transports need the same stable contract.

## Domain-driven boundaries

The package uses lightweight DDD boundaries organized around real responsibilities, not a mandatory folder template:

| Responsibility | Owner | Boundary |
| --- | --- | --- |
| Message presentation | Consuming application | Maps application events to bounded, sanitized plain-text messages; owns domain-specific wording and formatting |
| Delivery coordination | Telegram event subscriber | Coordinates injected EventBus and notifier ports; owns subscription lifecycle, serialized delivery, admission limits, diagnostics, and failure reporting; receives a formatter function from the application |
| Infrastructure | TelegramNotifier | Owns Telegram HTTP requests, credentials, timeouts, and provider response validation; uses injected fetch |
| Composition | Consuming application | Loads environment/configuration and constructs the EventBus, notifier, and subscriber |
| Public API | Package and provider index files | Re-exports supported contracts only; contains no implementation logic |

The dependency direction is inward: formatting policy does not depend on Telegram networking, and the subscriber depends on injected ports rather than concrete EventBus or trading implementations. The Telegram adapter is the only module that knows the Telegram HTTP protocol. The package never imports application, broker, entity, strategy, or concrete event-bus implementations.

This is deliberately not a generic notification framework. Keep Telegram-specific behavior in src/telegram/. Add another provider only when a real consumer requires it, and introduce shared abstractions only after multiple implemented providers demonstrate the same stable contract.

## Test-driven development

Use the repository's mandatory RED → GREEN → REFACTOR cycle for every behavior change:

1. Write a deterministic test for the observable contract before changing production code.
2. Run it and confirm it fails for the expected behavioral reason.
3. Make the smallest production change and rerun the focused test until it passes.
4. Refactor only while tests remain green.
5. Keep tests offline and credential-free; inject fetch, EventBus, notifier, and logger boundaries.
6. Give every assertion a detailed failure message that describes the invariant and scenario.

Architecture regression tests protect the dependency direction and keep composition, notification policy, and Telegram infrastructure separate. A passing test or coverage percentage alone is not proof of a meaningful contract; cover failure, boundary, concurrency, cleanup, and overload paths.

## Supported API

    import {
      TelegramNotifier,
      subscribeTelegramNotifications,
    } from "@coinzilla/notifiers"

- TelegramNotifier: validates options and sends plain-text messages through Telegram's sendMessage Bot API method.
- subscribeTelegramNotifications: subscribes to the application-provided `eventNames` list; it serializes delivery, limits pending work, and returns an explicit close() lifecycle handle plus an immutable getDiagnostics() snapshot.
- `subscribeTelegramNotifications` requires a `formatMessage(event)` function from the consuming application. It never formats domain events itself.

The package does not load environment variables. Applications own configuration and secret management.

## Telegram setup

1. Create a bot with Telegram's [@BotFather](https://t.me/BotFather).
2. Send the bot a message, or add it to the target group and grant it permission to post.
3. Obtain the destination chat ID using Telegram's supported bot update flow.
4. Store the token and chat ID in the consuming application's environment or secret manager. Never commit credentials.

Recommended environment variables:

    TELEGRAM_BOT_TOKEN=
    TELEGRAM_CHAT_ID=

Both values are required by the consuming application. Leave both unset to disable Telegram notifications.

## Usage

    import { EventBus } from "@coinzilla/event-bus"
    import {
      TelegramNotifier,
      subscribeTelegramNotifications,
    } from "@coinzilla/notifiers"

    const eventBus = new EventBus({ logger })
    const telegram = new TelegramNotifier({
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    })

    const notifications = subscribeTelegramNotifications({
      eventBus,
      notifier: telegram,
      logger,
      maxPending: 1000,
      eventNames: ["notification.created"],
      formatMessage: (event) => `${event.name}: ${event.data?.summary ?? ""}`,
    })

    eventBus.publish({
      name: "notification.created",
      source: "example-app",
      data: { summary: "A notification for the consuming application." },
    })

    // Stop publishers first, then drain accepted deliveries.
    await eventBus.flush()
    console.info(notifications.getDiagnostics())
    await notifications.close()
    await eventBus.close()

## Event and message ownership

The notifier package does not define application event names, trading semantics, or message templates. The consuming application selects event names, maps domain events, and supplies a formatter function. The notifier validates the event-name list shape and serializes delivery of the resulting plain-text messages.

## Reliability and security contract

- **Transport isolation:** Telegram is an event-bus side effect. It must never control trading state, order placement, reconciliation, or strategy decisions.
- **No secret leakage:** the Telegram bot token is redacted from thrown transport error messages and sanitized causes. The consuming application formatter must include only explicitly selected fields and sanitize/bound free-form text before sending. Never forward raw errors, stack traces, credentials, API keys, raw exchange payloads, or arbitrary event fields.
- **Bounded input:** the consuming application is responsible for normalizing fields, removing control characters, and length-limiting dynamic content before calling the notifier.
- **Response validation:** HTTP response shape, Telegram's `ok` flag, and the returned `message_id` are validated. Non-2xx responses include Telegram's bounded, token-redacted `description` when available; malformed error bodies retain the HTTP status. Array-shaped or otherwise malformed success responses are failures, not false positives.
- **Validation isolation:** configuration validation, message validation, and bounded credential-redacting error sanitization are pure functions in focused modules, independently testable without network access.
- **Timeout:** requests use AbortSignal.timeout(); the default is 10 seconds. The timeout is configurable and validated.
- **Serialized sends:** at most one Telegram HTTP request is in flight per subscriber. maxPending defaults to 1,000 and limits queued plus active deliveries. Overflow is reported and rejected/dropped according to the configured logger/event-bus error path; it does not create an unbounded local queue.
- **Failure handling:** with a functioning logger, delivery failures are reported once through it. If no logger is supplied or `logger.error` throws, the handler rejection is left for the EventBus error reporter. A logging failure does not poison the internal delivery queue.
- **Diagnostics:** getDiagnostics() returns a frozen point-in-time snapshot with acceptedCount, deliveredCount, failedCount, overflowCount, pendingCount, and closed. Counters are process-local and cumulative for the subscriber lifetime. acceptedCount means admitted by this subscriber; deliveredCount means sendMessage() resolved successfully (Telegram API acceptance), not that a human read the message. Overflow is counted separately and is not included in acceptedCount.
- **Cleanup:** partial subscription setup attempts to unsubscribe every successfully registered handler. close() is idempotent, attempts every unsubscribe, and drains already accepted sends. Callers should stop publishing and await `eventBus.flush()`, then await `notifications.close()`. Callbacks that begin after close are ignored.
- **No automatic retry:** a timed-out request may have been accepted by Telegram even when its response was lost. Retrying can duplicate a message. Retry/backoff should be added only with explicit duplicate and idempotency semantics.
- **Best-effort delivery:** no durable outbox exists. A process crash can lose pending notifications. The event bus and this subscriber are in-memory.
- **No formatting mode:** messages are plain text; HTML/Markdown parse modes are not enabled.

The subscriber's maxPending is an additional local admission limit. Consumers should also configure the event bus's own maxPending limit to protect the full event-delivery fan-out.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| No notifications appear | Both Telegram variables are unset, or the bot cannot post to the chat | Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; confirm the bot has been started or added to the group with posting permission |
| Setup fails immediately | Only one credential is configured, or a value is invalid | Configure both values together; keep credentials in the deployment secret manager |
| Delivery failures are logged | Telegram rejected the request, the network failed, or the request timed out | Inspect the error's HTTP status and Telegram description (for example, `Forbidden: bot was blocked by the user` or `chat not found`); verify the specific credential or chat permission named by Telegram. Descriptions are bounded and bot-token-redacted; never paste the token into an issue or log |
| Queue overflow is reported | Telegram is slower than the incoming event rate, or the process is under load | Inspect `getDiagnostics()`; tune `maxPending` only after measuring event rate and memory pressure |
| Shutdown takes time | Accepted sends are being drained | Stop event publishers, await eventBus.flush(), then await notifications.close() |

Rotate a potentially exposed bot token with BotFather and update the deployment secret. Do not print the token in shell history, CI output, diagnostics, or support logs. A successful `sendMessage` response confirms Telegram accepted the API request; it does not confirm that a user read the message.

## Development and verification

    pnpm --filter @coinzilla/notifiers test
    pnpm --filter @coinzilla/notifiers test:coverage

The package unit suite also runs ESLint against every JavaScript source file, test, and script under packages/notifiers, using the repository's root ESLint configuration. The coverage command enforces at least 90% line and 85% branch coverage across the package's production source files. Behavioral tests use Node's built-in test runner and injected transport boundaries; the ESLint regression test uses the repository's installed ESLint development dependency. Tests require no credentials or live network access.


## Manual live Telegram smoke test

The default unit and coverage suites never contact Telegram. For an operator-controlled check of real credentials and chat permissions, run the explicit smoke-test command from a trusted environment where `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` have been injected by your approved secret manager:

    pnpm --filter @coinzilla/notifiers test:telegram-smoke

This command sends exactly one clearly labeled test message and prints a confirmation containing only the returned message ID; it never prints the token or message payload. It does not retry. A successful result means Telegram accepted the API request; it does not mean the message was read. Do not run this command in ordinary pull-request CI, against a production alert channel without approval, or with credentials copied into shell history. The smoke test is intentionally excluded from the default test suite.
