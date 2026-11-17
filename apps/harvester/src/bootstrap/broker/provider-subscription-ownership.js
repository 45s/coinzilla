/**
 * Associate an owned subscription with the provider instance that created it.
 * Copy property descriptors so adapter cleanup/recovery methods retain their
 * original behavior without mutating provider-owned subscription objects.
 */
export function associateProviderInstance({ subscription, providerInstanceId } = {}) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    throw new TypeError("Provider-owned subscription must be an object")
  }
  if (typeof providerInstanceId !== "string" || !providerInstanceId.trim()) {
    throw new TypeError("Provider-owned subscription requires a stable provider instance ID")
  }
  const ownedSubscription = Object.create(Object.getPrototypeOf(subscription))
  Object.defineProperties(ownedSubscription, Object.getOwnPropertyDescriptors(subscription))
  Object.defineProperty(ownedSubscription, "providerInstanceId", {
    configurable: false,
    enumerable: true,
    value: providerInstanceId,
    writable: false,
  })
  return Object.freeze(ownedSubscription)
}

export function associateProviderInstances({ subscriptions, providerInstanceId } = {}) {
  if (!Array.isArray(subscriptions)) {
    throw new TypeError("Provider-owned subscriptions must be an array")
  }
  return Object.freeze(subscriptions.map((subscription) =>
    associateProviderInstance({
      subscription,
      providerInstanceId,
    })))
}
