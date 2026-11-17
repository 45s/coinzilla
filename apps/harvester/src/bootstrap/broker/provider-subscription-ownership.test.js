import test from "node:test"
import assert from "node:assert/strict"
import {
  associateProviderInstance,
  associateProviderInstances,
} from "./provider-subscription-ownership.js"

test("associates a subscription with its owner without mutating the original", () => {
  const disconnect = async () => "disconnected"
  const subscription = Object.freeze({ disconnect })
  const owned = associateProviderInstance({
    subscription,
    providerInstanceId: "binancePrimary",
  })
  assert.equal(owned.providerInstanceId, "binancePrimary")
  assert.equal(owned.disconnect, disconnect)
  assert.equal(subscription.providerInstanceId, undefined)
})

test("associates every market and book subscription with the same explicit owner", () => {
  const subscriptions = [
    {
      symbol: "BTCUSDT",
      unsubscribe: async () => {},
    },
    {
      symbol: "DOGEUSDT",
      unsubscribe: async () => {},
    },
  ]
  const owned = associateProviderInstances({
    subscriptions,
    providerInstanceId: "binancePrimary",
  })
  assert.deepEqual(
    owned.map((subscription) => subscription.providerInstanceId),
    ["binancePrimary", "binancePrimary"],
  )
  assert.notEqual(owned, subscriptions, "Provider ownership association must create a runtime-owned array.")
})
