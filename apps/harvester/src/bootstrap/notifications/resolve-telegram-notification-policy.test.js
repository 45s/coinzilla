import test from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_TELEGRAM_NOTIFICATION_EVENTS } from "./format-telegram-notification.js"
import { resolveTelegramNotificationPolicy } from "./resolve-telegram-notification-policy.js"

test("resolves the minimal, trader, verbose, and custom profile defaults", () => {
  const minimal = resolveTelegramNotificationPolicy({ telegramConfig: { profile: "minimal" } })
  assert.equal(minimal.shouldNotify({ name: "bot.started" }), false, "Minimal must suppress routine successful startup messages.")
  assert.equal(minimal.shouldNotify({ name: "account.safety_alert" }), true, "Minimal must always retain account safety alerts.")

  const trader = resolveTelegramNotificationPolicy({ telegramConfig: { profile: "trader" } })
  assert.equal(trader.shouldNotify({ name: "fill.received", data: { symbol: "LINKUSDT" } }), true, "Trader must include canonical applied fills.")
  assert.equal(trader.shouldNotify({ name: "order.submitted", data: { symbol: "LINKUSDT" } }), true, "Trader must include acknowledged order submissions.")
  assert.equal(trader.shouldNotify({ name: "broker.connected" }), false, "Trader must suppress routine broker connection success messages.")

  const verbose = resolveTelegramNotificationPolicy({ telegramConfig: { profile: "verbose" } })
  assert.deepEqual(verbose.eventNames, HARVESTER_TELEGRAM_NOTIFICATION_EVENTS, "Verbose must subscribe to every supported notifier event.")
  assert.equal(verbose.shouldNotify({ name: "broker.connected" }), true, "Verbose must include routine broker lifecycle events.")

  const custom = resolveTelegramNotificationPolicy({
    telegramConfig: { profile: "custom", events: { fillReceived: true } },
  })
  assert.equal(custom.shouldNotify({ name: "fill.received", data: { symbol: "LINKUSDT" } }), true, "Custom must enable only explicitly selected ordinary events.")
  assert.equal(custom.shouldNotify({ name: "bot.started" }), false, "Custom must not inherit the trader profile.")
})

test("applies market filters to ordinary messages but never suppresses safety alerts", () => {
  const policy = resolveTelegramNotificationPolicy({
    telegramConfig: {
      profile: "custom",
      markets: ["LINKUSDT"],
      events: { fillReceived: true, pairPaused: false, accountSafetyAlert: false },
    },
  })
  assert.equal(policy.shouldNotify({ name: "fill.received", data: { symbol: "LINKUSDT" } }), true, "An enabled ordinary event for an allowed market must be delivered.")
  assert.equal(policy.shouldNotify({ name: "fill.received", data: { symbol: "ETHUSDT" } }), false, "An ordinary event for a market outside the filter must be suppressed.")
  assert.equal(policy.shouldNotify({ name: "bot.pair_paused", data: { symbol: "ETHUSDT" } }), true, "A critical pair pause must bypass both an explicit false override and the market filter.")
  assert.equal(policy.shouldNotify({ name: "account.safety_alert", data: { symbol: "ETHUSDT" } }), true, "Account safety alerts must bypass custom exclusions and market filters.")
  assert.equal(policy.shouldNotify({ name: "bot.stopped", data: { outcome: "failed" } }), true, "A failed shutdown must remain visible even when custom disables successful stop messages.")
})

test("preserves the config-level Telegram enabled switch", () => {
  const policy = resolveTelegramNotificationPolicy({ telegramConfig: { enabled: false, profile: "trader" } })
  assert.equal(policy.enabled, false, "The resolved notification policy must preserve enabled=false for composition to honor.")
})
