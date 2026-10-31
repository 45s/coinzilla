import { Balance, CanonicalOrder, Fill } from "@coinzilla/entities"
import { addDecimal, compareDecimal, subtractDecimal } from "./helpers/decimal.js"
import { getOrderId, unwrapResult } from "./helpers/exchange.js"
import { validateRecoveryBalances } from "./recovery.js"

const DEFAULT_PAGE_LIMIT = 1000
const DEFAULT_MAX_PAGES = 100

function failure(reason, error) {
  return { ok: false, reason, ...(error ? { error } : {}) }
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function assertActive({ isActive }) {
  if (!isActive()) {
    throw new Error("Bot stopped during reconciliation snapshot collection")
  }
}

function readServerTime({ broker, operation }) {
  return broker.getServerTime().then((result) => {
    const data = unwrapResult(result, operation)
    if (!isTimestamp(data?.serverTime)) {
      throw new TypeError(`${operation} returned an invalid server timestamp`)
    }
    return data.serverTime
  })
}

function normalizeOpenOrder({ order, symbol }) {
  const id = getOrderId(order)
  const orderSymbol = order?.symbol ?? symbol
  const side = order?.side
  const originalQuantity = order?.originalQuantity
  const executedQuantity = order?.executedQuantity
  const status = typeof order?.status === "string" ? order.status.toUpperCase() : ""

  if (
    !id ||
    !/^\d+$/.test(id) ||
    !Number.isSafeInteger(Number(id)) ||
    orderSymbol !== symbol ||
    (side !== "BUY" && side !== "SELL") ||
    typeof originalQuantity !== "string" ||
    typeof executedQuantity !== "string" ||
    !["NEW", "PARTIALLY_FILLED"].includes(status)
  ) {
    throw new TypeError(`Open order snapshot contains an invalid order for ${symbol}`)
  }

  let remainingQuantity
  try {
    remainingQuantity = subtractDecimal({
      left: originalQuantity,
      right: executedQuantity,
    })
    if (compareDecimal({ left: remainingQuantity, right: "0" }) < 0) {
      throw new Error("executed quantity exceeds original quantity")
    }
  } catch (error) {
    throw new TypeError(`Open order ${id} contains invalid quantities: ${error.message}`)
  }

  return Object.freeze({
    id,
    symbol,
    side,
    originalQuantity,
    executedQuantity,
    remainingQuantity,
    status,
  })
}

function normalizeTrackedOrderIds({ orders }) {
  const ids = []
  const seen = new Set()

  for (const order of orders) {
    const id = getOrderId(order)
    if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || seen.has(id)) {
      throw new TypeError("Tracked orders contain a missing or duplicate broker order ID")
    }
    seen.add(id)
    ids.push(id)
  }

  return ids.sort((left, right) => Number(left) - Number(right))
}

async function collectOrderHistory({ broker, symbol, orderId, isActive }) {
  assertActive({ isActive })
  const orders = unwrapResult(
    await broker.getCanonicalOrderHistory({ symbol, orderId, limit: 1 }),
    `getCanonicalOrderHistory(${symbol}, ${orderId})`,
  )
  assertActive({ isActive })

  if (!Array.isArray(orders) || orders.length !== 1) {
    throw new Error(`Order history for tracked order ${orderId} is missing or ambiguous`)
  }

  const [order] = orders
  if (
    !(order instanceof CanonicalOrder) ||
    order.brokerOrderId !== orderId ||
    order.market.symbol !== symbol
  ) {
    throw new Error(`Order history returned an invalid record for tracked order ${orderId}`)
  }

  return order
}

async function collectOrderFills({
  broker,
  symbol,
  orderId,
  pageLimit,
  maxPages,
  isActive,
}) {
  const fills = []
  const seenTradeIds = new Set()
  let fromId
  let pagesFetched = 0

  while (true) {
    assertActive({ isActive })
    const result = unwrapResult(
      await broker.getFills({
        symbol,
        orderId,
        ...(fromId === undefined ? {} : { fromId }),
        limit: pageLimit,
      }),
      `getFills(${symbol}, ${orderId})`,
    )
    assertActive({ isActive })

    if (!Array.isArray(result) || result.length > pageLimit) {
      throw new TypeError(`Fill history for order ${orderId} returned an invalid page`)
    }

    pagesFetched += 1
    let previousTradeId = fromId === undefined ? -1 : fromId - 1

    for (const fill of result) {
      if (
        !(fill instanceof Fill) ||
        fill.market.symbol !== symbol ||
        fill.brokerOrderId !== orderId ||
        typeof fill.tradeId !== "string" ||
        !/^\d+$/.test(fill.tradeId)
      ) {
        throw new TypeError(`Fill history for order ${orderId} contains an invalid fill`)
      }

      const tradeId = Number(fill.tradeId)
      if (!Number.isSafeInteger(tradeId) || tradeId < 0 || tradeId <= previousTradeId) {
        throw new Error(`Fill history for order ${orderId} contains an unsafe or unordered trade ID`)
      }
      if (seenTradeIds.has(fill.tradeId)) {
        throw new Error(`Fill history for order ${orderId} contains duplicate trade ID ${fill.tradeId}`)
      }

      seenTradeIds.add(fill.tradeId)
      previousTradeId = tradeId
      fills.push(fill)
    }

    if (result.length < pageLimit) break
    if (pagesFetched >= maxPages) {
      throw new Error(`Fill history for order ${orderId} exceeded the ${maxPages}-page safety limit`)
    }

    const lastTradeId = Number(result.at(-1)?.tradeId)
    const nextTradeId = lastTradeId + 1
    if (!Number.isSafeInteger(nextTradeId) || nextTradeId <= lastTradeId) {
      throw new Error(`Fill history cursor cannot advance safely for order ${orderId}`)
    }
    fromId = nextTradeId
  }

  return { fills, pagesFetched }
}

function isObservedWithinWindow({ value, window }) {
  return isTimestamp(value) &&
    value >= window.startedAtServerTime &&
    value <= window.completedAtServerTime
}

function validateOpenOrders({ items, symbol, window }) {
  if (!Array.isArray(items)) return failure(`Open orders for ${symbol} must be an array`)
  const ids = new Set()

  for (const order of items) {
    if (
      !order ||
      typeof order.id !== "string" ||
      !/^\d+$/.test(order.id) ||
      !Number.isSafeInteger(Number(order.id)) ||
      order.symbol !== symbol ||
      (order.side !== "BUY" && order.side !== "SELL") ||
      typeof order.originalQuantity !== "string" ||
      typeof order.executedQuantity !== "string" ||
      typeof order.remainingQuantity !== "string" ||
      !["NEW", "PARTIALLY_FILLED"].includes(order.status) ||
      ids.has(order.id)
    ) {
      return failure(`Open orders for ${symbol} contain an invalid or duplicate order`)
    }
    try {
      if (
        compareDecimal({ left: order.originalQuantity, right: "0" }) <= 0 ||
        compareDecimal({ left: order.executedQuantity, right: "0" }) < 0 ||
        compareDecimal({ left: order.executedQuantity, right: order.originalQuantity }) > 0 ||
        compareDecimal({
          left: order.remainingQuantity,
          right: subtractDecimal({ left: order.originalQuantity, right: order.executedQuantity }),
        }) !== 0
      ) {
        return failure(`Open order ${order.id} contains inconsistent quantities`)
      }
    } catch (error) {
      return failure(`Open order ${order.id} contains invalid quantities: ${error.message}`)
    }
    ids.add(order.id)
  }

  return { ok: true }
}

export function validateReconciliationSnapshot({ snapshot, symbols } = {}) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== 1) {
    return failure("Reconciliation snapshot has an unsupported or missing schema version")
  }
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return failure("Reconciliation snapshot validation requires enabled symbols")
  }

  const window = snapshot.window
  if (
    !window ||
    !isTimestamp(window.startedAtServerTime) ||
    !isTimestamp(window.completedAtServerTime) ||
    window.completedAtServerTime < window.startedAtServerTime
  ) {
    return failure("Reconciliation snapshot has an invalid server-time window")
  }

  const account = snapshot.account
  if (
    !account ||
    account.completeness !== "COMPLETE" ||
    !isTimestamp(account.sourceTime) ||
    !isObservedWithinWindow({ value: account.observedAtServerTime, window }) ||
    account.sourceTime > account.observedAtServerTime
  ) {
    return failure("Reconciliation snapshot account section is incomplete or has invalid timestamps")
  }
  if (!Array.isArray(account.balances) || account.balances.some((balance) => !(balance instanceof Balance))) {
    return failure("Reconciliation snapshot account balances must be canonical Balance values")
  }
  const balanceValidation = validateRecoveryBalances({ balances: account.balances })
  if (!balanceValidation.ok) return failure(balanceValidation.reason)

  const symbolKeys = Object.keys(snapshot.symbols ?? {}).sort()
  const expectedSymbols = [...symbols].sort()
  if (
    symbolKeys.length !== expectedSymbols.length ||
    symbolKeys.some((symbol, index) => symbol !== expectedSymbols[index])
  ) {
    return failure("Reconciliation snapshot does not contain exactly the enabled symbols")
  }

  for (const symbol of expectedSymbols) {
    const section = snapshot.symbols[symbol]
    if (!section) return failure(`Reconciliation snapshot is missing ${symbol}`)

    for (const [name, value] of [
      ["openOrders", section.openOrders],
      ["orderHistory", section.orderHistory],
      ["fills", section.fills],
    ]) {
      if (
        !value ||
        value.completeness !== "COMPLETE" ||
        !isObservedWithinWindow({ value: value.observedAtServerTime, window })
      ) {
        return failure(`Reconciliation snapshot ${name} section is incomplete for ${symbol}`)
      }
    }

    const openOrderValidation = validateOpenOrders({
      items: section.openOrders.items,
      symbol,
      window,
    })
    if (!openOrderValidation.ok) return openOrderValidation

    const trackedOrderIds = section.orderHistory.trackedOrderIds
    if (
      !Array.isArray(trackedOrderIds) ||
      new Set(trackedOrderIds).size !== trackedOrderIds.length ||
      trackedOrderIds.some((id) => typeof id !== "string" || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) ||
      !Array.isArray(section.orderHistory.items) ||
      section.orderHistory.items.length !== trackedOrderIds.length ||
      !Number.isSafeInteger(section.orderHistory.pagesFetched) ||
      section.orderHistory.pagesFetched !== trackedOrderIds.length
    ) {
      return failure(`Reconciliation snapshot order history is invalid for ${symbol}`)
    }

    const orderIds = new Set()
    for (const order of section.orderHistory.items) {
      if (
        !(order instanceof CanonicalOrder) ||
        order.market.symbol !== symbol ||
        order.status === "UNKNOWN" ||
        !trackedOrderIds.includes(order.brokerOrderId) ||
        orderIds.has(order.brokerOrderId)
      ) {
        return failure(`Reconciliation snapshot contains invalid tracked order history for ${symbol}`)
      }
      orderIds.add(order.brokerOrderId)
    }

    if (
      !Array.isArray(section.fills.trackedOrderIds) ||
      section.fills.trackedOrderIds.length !== trackedOrderIds.length ||
      new Set(section.fills.trackedOrderIds).size !== section.fills.trackedOrderIds.length ||
      section.fills.trackedOrderIds.some((id, index) => id !== trackedOrderIds[index]) ||
      !Array.isArray(section.fills.items) ||
      !Number.isSafeInteger(section.fills.pagesFetched) ||
      section.fills.pagesFetched < trackedOrderIds.length ||
      section.fills.nextTradeId !== null
    ) {
      return failure(`Reconciliation snapshot fill history is invalid for ${symbol}`)
    }

    const tradeIds = new Set()
    for (const fill of section.fills.items) {
      if (
        !(fill instanceof Fill) ||
        fill.market.symbol !== symbol ||
        fill.commissionStatus !== "COMPLETE" ||
        fill.liquidityRole === "UNKNOWN" ||
        !trackedOrderIds.includes(fill.brokerOrderId) ||
        !/^\d+$/.test(fill.tradeId) ||
        !Number.isSafeInteger(Number(fill.tradeId)) ||
        tradeIds.has(fill.tradeId)
      ) {
        return failure(`Reconciliation snapshot contains invalid tracked fills for ${symbol}`)
      }
      tradeIds.add(fill.tradeId)
    }

    for (const order of section.orderHistory.items) {
      const orderFills = section.fills.items.filter(
        (fill) => fill.brokerOrderId === order.brokerOrderId,
      )
      const filledQuantity = orderFills.reduce(
        (total, fill) => addDecimal({
          left: total,
          right: fill.quantity.amount,
        }),
        "0",
      )
      if (compareDecimal({
        left: filledQuantity,
        right: order.executedQuantity.amount,
      }) !== 0) {
        return failure(`Reconciliation snapshot fill quantity does not match tracked order ${order.brokerOrderId}`)
      }
    }

    const firstTradeId = section.fills.items.length
      ? section.fills.items.reduce((first, fill) =>
        Number(fill.tradeId) < Number(first) ? fill.tradeId : first,
      section.fills.items[0].tradeId)
      : null
    if (section.fills.firstTradeId !== firstTradeId) {
      return failure(`Reconciliation snapshot has an invalid first trade cursor for ${symbol}`)
    }
  }

  return { ok: true }
}

export async function collectReconciliationSnapshot({
  broker,
  trackedOrdersBySymbol,
  isActive = () => true,
  pageLimit = DEFAULT_PAGE_LIMIT,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  if (!broker || typeof broker !== "object") {
    return failure("Reconciliation snapshot requires a broker")
  }
  if (
    !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > DEFAULT_PAGE_LIMIT ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1
  ) {
    return failure("Reconciliation snapshot pagination settings are invalid")
  }
  if (
    typeof broker.getServerTime !== "function" ||
    typeof broker.getAccountSnapshot !== "function" ||
    typeof broker.getOpenOrders !== "function" ||
    typeof broker.getCanonicalOrderHistory !== "function" ||
    typeof broker.getFills !== "function"
  ) {
    return failure("Broker does not support the required reconciliation snapshot ports")
  }
  if (!trackedOrdersBySymbol || typeof trackedOrdersBySymbol !== "object") {
    return failure("Reconciliation snapshot requires tracked orders by symbol")
  }

  const symbols = Object.keys(trackedOrdersBySymbol).sort()
  if (symbols.length === 0) return failure("Reconciliation snapshot requires enabled symbols")

  try {
    const startedAtServerTime = await readServerTime({
      broker,
      operation: "getServerTime before reconciliation",
    })
    assertActive({ isActive })

    const accountData = unwrapResult(
      await broker.getAccountSnapshot(),
      "getAccountSnapshot",
    )
    assertActive({ isActive })
    const accountObservedAtServerTime = await readServerTime({
      broker,
      operation: "getServerTime after account snapshot",
    })
    const account = Object.freeze({
      balances: Object.freeze([...accountData.balances]),
      sourceTime: accountData.sourceTime,
      observedAtServerTime: accountObservedAtServerTime,
      completeness: "COMPLETE",
    })

    const symbolSections = {}
    for (const symbol of symbols) {
      assertActive({ isActive })
      const openOrderData = unwrapResult(
        await broker.getOpenOrders({ symbol }),
        `getOpenOrders(${symbol})`,
      )
      if (!Array.isArray(openOrderData)) {
        throw new TypeError(`getOpenOrders(${symbol}) must return an array`)
      }
      const openOrders = Object.freeze(openOrderData.map((order) =>
        normalizeOpenOrder({ order, symbol }),
      ))

      const trackedOrders = trackedOrdersBySymbol[symbol]
      if (!Array.isArray(trackedOrders)) {
        throw new TypeError(`Tracked orders for ${symbol} must be an array`)
      }
      const trackedOrderIds = normalizeTrackedOrderIds({ orders: trackedOrders })
      const orderHistoryItems = []
      const fillItems = []
      let fillPagesFetched = 0

      for (const orderId of trackedOrderIds) {
        const orderHistory = await collectOrderHistory({
          broker,
          symbol,
          orderId,
          isActive,
        })
        orderHistoryItems.push(orderHistory)

        const fillHistory = await collectOrderFills({
          broker,
          symbol,
          orderId,
          pageLimit,
          maxPages,
          isActive,
        })
        fillItems.push(...fillHistory.fills)
        fillPagesFetched += fillHistory.pagesFetched
      }

      const observedAtServerTime = await readServerTime({
        broker,
        operation: `getServerTime after ${symbol} snapshot`,
      })
      symbolSections[symbol] = Object.freeze({
        openOrders: Object.freeze({
          items: openOrders,
          observedAtServerTime,
          completeness: "COMPLETE",
        }),
        orderHistory: Object.freeze({
          items: Object.freeze(orderHistoryItems),
          trackedOrderIds: Object.freeze(trackedOrderIds),
          pagesFetched: orderHistoryItems.length,
          observedAtServerTime,
          completeness: "COMPLETE",
        }),
        fills: Object.freeze({
          items: Object.freeze(fillItems),
          trackedOrderIds: Object.freeze(trackedOrderIds),
          firstTradeId: fillItems.length
            ? fillItems.reduce((first, fill) =>
              Number(fill.tradeId) < Number(first) ? fill.tradeId : first,
            fillItems[0].tradeId)
            : null,
          nextTradeId: null,
          pagesFetched: fillPagesFetched,
          observedAtServerTime,
          completeness: "COMPLETE",
        }),
      })
    }

    const completedAtServerTime = await readServerTime({
      broker,
      operation: "getServerTime after reconciliation",
    })
    const snapshot = Object.freeze({
      schemaVersion: 1,
      window: Object.freeze({
        startedAtServerTime,
        completedAtServerTime,
      }),
      account,
      symbols: Object.freeze(symbolSections),
    })

    const validation = validateReconciliationSnapshot({ snapshot, symbols })
    if (!validation.ok) return failure(validation.reason)

    return { ok: true, snapshot }
  } catch (error) {
    return failure(`Could not collect a complete reconciliation snapshot: ${error.message}`, error)
  }
}
