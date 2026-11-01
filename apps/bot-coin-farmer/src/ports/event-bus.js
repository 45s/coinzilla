const REQUIRED_METHODS = ["publish", "subscribeAll", "flush", "close"]

export function assertEventBusPort(eventBus) {
  if (eventBus === null || typeof eventBus !== "object") {
    throw new TypeError("eventBus port must be an object")
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof eventBus[method] !== "function") {
      throw new TypeError(`eventBus port must implement ${method}()`)
    }
  }

  return eventBus
}
