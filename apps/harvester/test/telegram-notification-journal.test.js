import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"
import { subscribeHarvesterTelegramNotifications } from "../src/bootstrap/notifications/subscribe-harvester-telegram-notifications.js"

test("durably journals a blocked multi-symbol open-orders Telegram safety alert", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "harvester-telegram-journal-"))
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory })
  const notificationsSent = []
  const safetyAlerts = []
  let notifications
  let journalStarted = false
  let safetyAlertSubscription

  try {
    const started = await journal.start()
    assert.equal(started.ok, true, "The real Journal must start before the notification bridge is exercised.")
    journalStarted = true

    safetyAlertSubscription = eventBus.subscribe({
      name: "account.safety_alert",
      handler: (event) => safetyAlerts.push(event),
    })
    assert.equal(safetyAlertSubscription.ok, true, "The test must observe the derived account safety alert.")

    notifications = await subscribeHarvesterTelegramNotifications({
      eventBus,
      notifier: {
        async sendMessage(message) {
          notificationsSent.push(message)
        },
      },
      telegramConfig: { enabled: true, profile: "trader" },
      logger: { error() {} },
    })

    const published = eventBus.publish({
      name: "account.open_orders_captured",
      source: "harvester",
      data: {
        phase: "PREFLIGHT",
        observedAt: 1_000,
        readiness: "BLOCKED",
        orderCount: 2,
        orders: [{ symbol: "LINKFDUSD" }, { symbol: "ZROFDUSD" }],
        blockReasons: ["UNOWNED_OPEN_ORDERS:2"],
      },
    })
    assert.equal(published.ok, true, "The account-wide open-orders audit event must be accepted by EventBus.")

    const drained = await eventBus.flush()
    assert.equal(drained.ok, true, "The original audit and its derived Telegram safety alert must finish delivery.")

    const flushed = await journal.flush()
    assert.equal(
      flushed.ok,
      true,
      "The Journal must accept and durably flush the multi-symbol safety alert instead of rejecting an undefined symbol: " +
        (flushed.errors?.[0]?.message ?? "unknown Journal failure"),
    )
    assert.equal(flushed.durable, true, "A successful startup audit flush must confirm durable Journal persistence.")

    assert.equal(safetyAlerts.length, 1, "A blocked open-orders audit must still publish exactly one account safety alert.")
    assert.equal(
      Object.hasOwn(safetyAlerts[0].data, "symbol"),
      false,
      "A multi-symbol safety alert must omit the optional symbol field rather than publish undefined.",
    )
    assert.equal(
      notificationsSent.length,
      1,
      "The blocked open-orders audit must still produce its Telegram safety notification.",
    )

    await notifications.close()
    notifications = null
    safetyAlertSubscription.subscription.unsubscribe()
    safetyAlertSubscription = null
    const closed = await journal.close()
    journalStarted = false
    assert.equal(closed.ok, true, "The Journal must close cleanly after the durable safety alert is recorded.")
    const busClosed = await eventBus.close()
    assert.equal(busClosed.ok, true, "The EventBus must close after the Journal has unsubscribed.")
  } finally {
    if (notifications) {
      await notifications.close()
    }
    safetyAlertSubscription?.subscription?.unsubscribe()
    if (journalStarted) {
      await journal.close()
    }
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})
