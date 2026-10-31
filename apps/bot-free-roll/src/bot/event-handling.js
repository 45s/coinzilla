import { getOrderId } from "./helpers/index.js"

// Broker adapters own exchange-specific payload interpretation. This boundary
// only unwraps the broker's event envelope and identifies the event destination.
export function normalizeUserDataEvent({ payload } = {}) {
  const event = payload?.event ?? payload

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, reason: "User-data event must be an object" }
  }

  if (event.eventType === "outboundAccountPosition") {
    return { ok: true, type: "balance", event }
  }

  const order = event.executedOrder
  const symbol = order?.symbol ?? event.symbol

  return {
    ok: true,
    type: "order",
    event,
    order,
    symbol,
  }
}

// Exchange event intake and routing. Strategy decisions remain in FreeRollBot.
export function createEventHandling({
  isRunning,
  hasPair,
  enqueue,
  onBalanceUpdate,
  onOrderEvent,
  onPrice,
  debug,
}) {
  function onUserDataEvent({ payload }) {
    if (!isRunning()) return

    const normalized = normalizeUserDataEvent({ payload })
    if (!normalized.ok) {
      debug("Ignoring invalid user-data event", {
        reason: normalized.reason,
      })
      return
    }

    const { event, type, order, symbol } = normalized

    if (type === "balance") {
      onBalanceUpdate({ event })
      return
    }

    debug("User-data event received", {
      eventType: event.eventType,
      executionType: event.executionType,
      symbol,
      orderId: getOrderId(order),
      status: order?.status,
    })

    if (!symbol || !hasPair({ symbol })) return

    void enqueue({
      symbol,
      task: () => onOrderEvent({ symbol, event }),
    })
  }

  function onPriceEvent({ symbol, tick }) {
    if (!isRunning()) return

    void enqueue({
      symbol,
      task: () => onPrice({ symbol, tick }),
    })
  }

  return {
    onPriceEvent,
    onUserDataEvent,
  }
}
