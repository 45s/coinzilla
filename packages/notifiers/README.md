# @coinzilla/notifiers

Dependency-free notification delivery for Coinzilla. The first adapter targets Telegram using Node.js built-in `fetch()`; no Telegram SDK, queue, Redis, or runtime package is required.

## Scope and design

- **Transport:** `TelegramNotifier` sends plain-text messages through Telegram's Bot API.
- **Event integration:** `subscribeTelegramNotifications()` subscribes to an explicit allowlist of important event-bus events.
- **Formatting:** `formatNotification()` maps known event envelopes to concise, safe messages. Raw exchange payloads, stack traces, API keys, and arbitrary fields are never forwarded.
- **Isolation:** this package does not import trading code or control order execution. Notification delivery is a separate event-bus subscriber.
- **Ordering:** notifications are serialized in the order event handlers are invoked. A slow Telegram request delays later notifications but does not block the event publisher synchronously.
- **Failure:** Telegram request errors reject the subscriber handler and are reported through the optional logger. The event bus isolates subscriber failures from other subscribers. There is no implicit retry or durable delivery guarantee in this first version.

## Telegram setup

1. Create a bot with Telegram's [@BotFather](https://t.me/BotFather).
2. Send the bot a message (or add it to the target group and grant it permission to post).
3. Obtain the destination chat ID using Telegram's supported bot update flow.
4. Store the bot token and chat ID in the consuming application's environment or secret manager. Never commit credentials.

Recommended environment variables:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

The package does not read process environment variables itself. The application owns configuration loading and decides whether notifications are enabled.

## Usage

```js
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
})

// Publish domain events as usual. Telegram is an independent subscriber.
eventBus.publish({
  name: "order.filled",
  source: "trading-bot",
  data: { orderId: "123", symbol: "BTCUSDT", side: "BUY", price: "65000", quantity: "0.01" },
})

// Stop publishers first, then drain accepted event-bus deliveries and notification sends.
await eventBus.flush()
await notifications.close()
await eventBus.close()
```

If credentials are absent, the application should skip constructing the notifier and skip subscribing. Do not create a partially configured notifier.

## Supported events

| Event | Default behavior |
| --- | --- |
| `order.filled` | Completed order alert |
| `fill.received` | Individual execution/fill alert |
| `bot.pair_paused` | Critical pair pause alert |
| `bot.recovery_failed` | Critical recovery failure alert |
| `bot.recovery_completed` | Recovery completion alert |
| `bot.started` | Bot started alert |
| `bot.stopped` | Bot stopped alert |

High-volume events such as `order.execution_report` are intentionally excluded. The allowlist is explicit to prevent accidental leakage and noisy messages.

## Operational contract

- Uses global Node.js `fetch` by default; tests and specialized consumers may inject `fetchImpl`.
- Request timeout defaults to 10 seconds and is configurable with a bounded positive integer.
- Telegram message length is validated against the Bot API's 4,096-character text limit.
- API and HTTP failures reject with actionable errors. The bot token is not included in error messages.
- Delivery is best-effort: process termination can lose accepted but unfinished messages. The event bus itself is in-memory and non-durable.
- No retries are performed automatically. Retrying a timed-out send can duplicate a message if Telegram accepted it but the response was lost. Add a durable outbox/idempotency contract before promising stronger delivery.
- Event notification formatting is plain text; no HTML/Markdown parse mode is enabled, avoiding formatting injection and escaping ambiguity.
- During shutdown, stop publishing, call `eventBus.flush()` to wait for every accepted handler, then call `notifications.close()` to unsubscribe and drain the serialized send queue before closing the bus.

## Development

```sh
pnpm --filter @coinzilla/notifiers test
pnpm --filter @coinzilla/notifiers test:coverage
```

The coverage command enforces at least 90% line and 85% branch coverage over package source files. Tests use Node's built-in test runner and injected transport boundaries; they require no credentials or network access.
