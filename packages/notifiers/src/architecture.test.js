import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8")

test("package entry point remains a thin facade over the provider API", async () => {
  const source = await readSource("./index.js")

  assert.match(
    source,
    /from "\.\/telegram\/index\.js"/,
    "The package entry point must expose the provider-local API rather than reaching into implementation modules.",
  )
  assert.doesNotMatch(
    source,
    /\b(?:class|function)\s+[A-Za-z_$][\w$]*|\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=/,
    "The public package entry point must contain exports only, not domain rules, state, or implementation logic.",
  )
})

test("Telegram adapter depends on injected ports instead of application infrastructure", async () => {
  const [subscriber, notifier, validation, safeErrors] = await Promise.all([
    readSource("./telegram/telegram-event-subscriber.js"),
    readSource("./telegram/telegram-notifier.js"),
    readSource("./telegram/telegram-validation.js"),
    readSource("./telegram/safe-error-message.js"),
  ])

  const providerSources = [subscriber, notifier, validation, safeErrors]
  for (const source of providerSources) {
    assert.doesNotMatch(
      source,
      /from\s+["'](?:@coinzilla\/(?:brokers|entities|event-bus)|(?:\.\.\/)+apps\/)/,
      "The notifier domain must not depend on trading, entity, event-bus implementation, or application packages.",
    )
  }

  assert.match(
    subscriber,
    /eventBus\.subscribe\(/,
    "The event subscriber must integrate through the injected EventBus port.",
  )
  assert.match(
    subscriber,
    /notifier\.sendMessage\(/,
    "The subscriber must deliver through the injected notification port instead of constructing a transport.",
  )
  assert.doesNotMatch(
    subscriber,
    /new\s+EventBus\s*\(/,
    "The notifier adapter must not instantiate or own the EventBus implementation.",
  )
  assert.match(
    notifier,
    /this\.#fetch\(/,
    "Telegram network I/O must use the injected fetch boundary so transport behavior remains deterministic in tests.",
  )
  assert.doesNotMatch(
    notifier,
    /process\.env|console\.(?:log|info|warn|error)/,
    "The Telegram transport must not read application configuration or write unstructured console output.",
  )
  assert.doesNotMatch(
    subscriber,
    /formatTelegramNotification/,
    "The notifier subscriber must not own application-specific message formatting.",
  )
})
