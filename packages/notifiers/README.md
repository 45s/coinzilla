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
          telegram-event-subscriber.js
          format-telegram-notification.js
          *.test.js
        email/    (future; create when implemented)
        discord/  (future; create when implemented)

Email and Discord are roadmap candidates, not implemented transports. Do not create empty placeholder folders or speculative shared abstractions. If another transport is added, keep its API, formatting, tests, and provider-specific behavior inside its own folder. Extract shared functionality only when multiple real transports need the same stable contract.

## Supported API

    import {
      TelegramNotifier,
      subscribeTelegramNotifications,
    } from "@coinzilla/notifiers"

- TelegramNotifier: validates options and sends plain-text messages through Telegram's sendMessage Bot API method.
- subscribeTelegramNotifications: subscribes to a curated event allowlist, serializes delivery, limits pending work, and returns an explicit close() lifecycle handle.
- TELEGRAM_NOTIFICATION_EVENTS: immutable list of subscribed event names.
- formatTelegramNotification: pure formatter for supported Telegram events.
- formatNotification: backwards-compatible alias for formatTelegramNotification.

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
    })

    eventBus.publish({
      name: "order.filled",
      source: "trading-bot",
      data: {
        orderId: "123",
        symbol: "BTCUSDT",
        side: "BUY",
        price: "65000",
        quantity: "0.01",
      },
    })

    // Stop publishers first, then drain accepted deliveries.
    await eventBus.flush()
    await notifications.close()
    await eventBus.close()

## Supported events

| Event | Default behavior |
| --- | --- |
| order.filled | Completed order alert |
| fill.received | Individual execution/fill alert |
| bot.pair_paused | Critical pair pause alert |
| bot.recovery_failed | Critical recovery failure alert |
| bot.recovery_completed | Recovery completion alert |
| bot.started | Bot started alert |
| bot.stopped | Bot stopped alert |

High-volume events such as order.execution_report are intentionally excluded. The allowlist prevents accidental message noise and limits outbound data to explicitly selected fields.

## Reliability and security contract

- **Transport isolation:** Telegram is an event-bus side effect. It must never control trading state, order placement, reconciliation, or strategy decisions.
- **No secret leakage:** tokens are not included in thrown transport errors. Raw exchange events, stack traces, API keys, and arbitrary event fields are not formatted into messages.
- **Bounded input:** event fields are normalized, control characters are removed, and each dynamic field is length-limited before formatting.
- **Response validation:** HTTP response shape, Telegram's ok flag, and the returned message_id are validated. Malformed success responses are failures, not false positives.
- **Timeout:** requests use AbortSignal.timeout(); the default is 10 seconds. The timeout is configurable and validated.
- **Serialized sends:** at most one Telegram HTTP request is in flight per subscriber. maxPending defaults to 1,000 and limits queued plus active deliveries. Overflow is reported and rejected/dropped according to the configured logger/event-bus error path; it does not create an unbounded local queue.
- **Failure handling:** when a logger is supplied, delivery failures are reported once through that logger. Without one, the rejected handler promise is left for the event bus's error reporter. A logging failure does not poison the delivery queue.
- **Cleanup:** partial subscription setup attempts to unsubscribe every successfully registered handler. close() is idempotent, attempts every unsubscribe, and drains already accepted sends. Callers should stop publishing and await eventBus.flush() before notifications.close(); callbacks that begin after close are ignored.
- **No automatic retry:** a timed-out request may have been accepted by Telegram even when its response was lost. Retrying can duplicate a message. Retry/backoff should be added only with explicit duplicate and idempotency semantics.
- **Best-effort delivery:** no durable outbox exists. A process crash can lose pending notifications. The event bus and this subscriber are in-memory.
- **No formatting mode:** messages are plain text; HTML/Markdown parse modes are not enabled.

The subscriber's maxPending is an additional local admission limit. Consumers should also configure the event bus's own maxPending limit to protect the full event-delivery fan-out.

## Development and verification

    pnpm --filter @coinzilla/notifiers test
    pnpm --filter @coinzilla/notifiers test:coverage

The coverage command enforces at least 90% line and 85% branch coverage across the package's production source files. Tests use Node's built-in test runner and injected transport boundaries; they require no credentials, external packages, or live network access.
