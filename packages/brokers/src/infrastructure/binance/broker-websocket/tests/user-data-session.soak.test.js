import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createBroker } from "../test-helpers/user-data-session-fixtures.js"

const RECOVERY_CYCLE_COUNT = 100

describe("Binance user-data recovery soak", () => {
  it("survives repeated disconnects without stale events, unsafe orders, or leaked listeners and timers", async () => {
    const { broker, scheduler, clients } = createBroker()
    const receivedEvents = []

    await broker.connect()
    const subscription = await broker.subscribeForUserData({
      onEvent: (message) => receivedEvents.push(message),
    })

    for (let cycle = 0; cycle < RECOVERY_CYCLE_COUNT; cycle += 1) {
      const previousClient = clients[cycle]
      const previousSubscriptionId = subscription.data.subscriptionId
      const previousDeliveredEventCount = receivedEvents.length

      previousClient.state = "closed"
      previousClient.emitClose({
        code: 1006,
        reason: `simulated outage ${cycle + 1}`,
        wasClean: false,
      })

      assert.equal(
        scheduler.pendingCount,
        1,
        `outage ${cycle + 1} must schedule exactly one recovery attempt`,
      )

      await scheduler.runNext()

      assert.equal(
        clients.length,
        cycle + 2,
        `recovery cycle ${cycle + 1} must create exactly one replacement API client`,
      )

      const replacementClient = clients[cycle + 1]
      const currentSubscriptionId = subscription.data.subscriptionId
      const expectedSubscriptionId = (cycle + 1) * 100 + 10

      assert.equal(
        replacementClient.state,
        "open",
        `replacement API client for recovery cycle ${cycle + 1} must be connected`,
      )
      assert.equal(
        currentSubscriptionId,
        expectedSubscriptionId,
        `recovery cycle ${cycle + 1} must expose the replacement remote subscription ID`,
      )
      assert.equal(
        replacementClient.calls.filter((call) => call.method === "userDataStream.subscribe.signature").length,
        1,
        `recovery cycle ${cycle + 1} must establish one remote user-data subscription, not duplicates`,
      )
      assert.equal(
        broker.userDataUnavailable,
        true,
        `recovery cycle ${cycle + 1} must keep order mutations gated until reconciliation acknowledgement`,
      )

      const blockedOrder = await broker.createOrder({
        symbol: "BTCUSDT",
        quantity: "0.01",
        price: "50000",
      })
      assert.equal(
        blockedOrder.ok,
        false,
        `recovery cycle ${cycle + 1} must reject order placement before reconciliation is acknowledged`,
      )
      assert.equal(
        replacementClient.calls.some((call) => call.method === "order.place"),
        false,
        `recovery cycle ${cycle + 1} must not send an order.place RPC while reconciliation is pending`,
      )

      previousClient.emitEvent({
        subscriptionId: previousSubscriptionId,
        event: {
          e: "balanceUpdate",
          a: "USDT",
          d: "stale-old-client",
          T: cycle * 4 + 1,
          E: cycle * 4 + 2,
        },
      })
      assert.equal(
        receivedEvents.length,
        previousDeliveredEventCount,
        `recovery cycle ${cycle + 1} must detach the previous client's event listener`,
      )

      replacementClient.emitEvent({
        subscriptionId: previousSubscriptionId,
        event: {
          e: "balanceUpdate",
          a: "USDT",
          d: "stale-subscription",
          T: cycle * 4 + 2,
          E: cycle * 4 + 3,
        },
      })
      assert.equal(
        receivedEvents.length,
        previousDeliveredEventCount,
        `recovery cycle ${cycle + 1} must ignore events addressed to the previous subscription ID`,
      )

      const expectedBalanceDelta = String(cycle + 1)
      replacementClient.emitEvent({
        subscriptionId: currentSubscriptionId,
        event: {
          e: "balanceUpdate",
          a: "USDT",
          d: expectedBalanceDelta,
          T: cycle * 4 + 3,
          E: cycle * 4 + 4,
        },
      })
      assert.equal(
        receivedEvents.length,
        previousDeliveredEventCount + 1,
        `recovery cycle ${cycle + 1} must deliver an event from the current subscription exactly once`,
      )
      assert.equal(
        receivedEvents[receivedEvents.length - 1].event.balanceDelta,
        expectedBalanceDelta,
        `recovery cycle ${cycle + 1} must preserve the current event's exact balance delta`,
      )

      assert.equal(
        subscription.data.acknowledgeRecovery(),
        true,
        `recovery cycle ${cycle + 1} must accept the active subscriber's reconciliation acknowledgement`,
      )
      assert.equal(
        broker.userDataUnavailable,
        false,
        `recovery cycle ${cycle + 1} must reopen the broker safety gate after acknowledgement`,
      )
      assert.equal(
        scheduler.pendingCount,
        0,
        `recovery cycle ${cycle + 1} must leave no retry or acknowledgement timer after reconciliation`,
      )
      assert.equal(
        previousClient.listenerCount + previousClient.errorListenerCount + previousClient.closeListenerCount,
        0,
        `recovery cycle ${cycle + 1} must release every listener attached to the superseded client`,
      )
    }

    await subscription.data.disconnect()
    await broker.disconnect()

    assert.equal(
      scheduler.pendingCount,
      0,
      "stopping after the soak must leave no scheduled reconnect or acknowledgement timers",
    )
    for (const [clientIndex, client] of clients.entries()) {
      assert.equal(
        client.listenerCount + client.errorListenerCount + client.closeListenerCount,
        0,
        `shutdown after the soak must release every listener from API client ${clientIndex}`,
      )
    }
  })
})
