import { CanonicalOrder, Fill, Order } from "@coinzilla/entities"
import { addDecimal, compareDecimal } from "@coinzilla/utils"
import { recoveryFailureError } from "./recovery-failure.js"

function assertJournalFillParity({ fill, ownedOrder, journalFill }) {
  const mismatch = (field) => {
    throw new Error("Canonical REST fill conflicts with durable Journal " + field + " for execution " + fill.id)
  }
  const expectedClientOrderId = journalFill.clientOrderId ?? ownedOrder.clientOrderId
  const actualClientOrderId = fill.clientOrderId ?? ownedOrder.clientOrderId
  if (
    fill.id !== journalFill.fillId ||
    String(fill.tradeId) !== journalFill.tradeId ||
    fill.brokerOrderId !== journalFill.brokerOrderId ||
    actualClientOrderId !== expectedClientOrderId ||
    expectedClientOrderId !== ownedOrder.clientOrderId ||
    fill.market.symbol !== journalFill.symbol ||
    fill.side !== journalFill.side ||
    fill.liquidityRole !== journalFill.liquidityRole ||
    fill.commissionStatus !== journalFill.commissionStatus
  ) {mismatch("identity or execution metadata")}

  for (const [field, actual, expected] of [
    ["price", fill.price.amount, journalFill.price],
    ["quantity", fill.quantity.amount, journalFill.quantity],
    ["quoteQuantity", fill.quoteQuantity.amount, journalFill.quoteQuantity],
  ]) {
    if (compareDecimal({ left: actual, right: expected }) !== 0) {mismatch(field)}
  }
  if (journalFill.executedAt !== undefined && fill.executedAt !== journalFill.executedAt) {
    mismatch("transaction timestamp")
  }

  const actualCommissions = fill.commissions.map((commission) => ({
    amount: commission.amount.amount,
    assetId: commission.amount.asset.id,
    asset: commission.amount.asset.code,
  })).sort((left, right) =>
    (left.assetId + ":" + left.asset + ":" + left.amount)
      .localeCompare(right.assetId + ":" + right.asset + ":" + right.amount)
  )
  const expectedCommissions = [...journalFill.commissions].sort((left, right) =>
    (left.assetId + ":" + left.asset + ":" + left.amount)
      .localeCompare(right.assetId + ":" + right.asset + ":" + right.amount)
  )
  if (actualCommissions.length !== expectedCommissions.length) {mismatch("commission count")}
  for (let index = 0; index < actualCommissions.length; index += 1) {
    const actual = actualCommissions[index]
    const expected = expectedCommissions[index]
    if (
      actual.assetId !== expected.assetId ||
      actual.asset !== expected.asset ||
      compareDecimal({ left: actual.amount, right: expected.amount }) !== 0
    ) {mismatch("commission facts")}
  }
}

/**
 * Collect and validate authoritative REST evidence for already-owned orders.
 * This workflow does not mutate the order registry or apply execution fills.
 */
export function makeCollectOwnedOrderSnapshots({ broker, journalFillsById } = {}) {
  if (!broker || typeof broker.getOpenOrders !== "function" ||
      typeof broker.getCanonicalOrderHistory !== "function" ||
      typeof broker.getFills !== "function") {
    throw new TypeError("makeCollectOwnedOrderSnapshots requires open-order, canonical-history, and fill-history broker reads")
  }
  if (!(journalFillsById instanceof Map)) {
    throw new TypeError("makeCollectOwnedOrderSnapshots requires journalFillsById to be a Map")
  }

  return async function collectOwnedOrderSnapshots({ ownedOrders } = {}) {
    const symbols = [...new Set(ownedOrders.map((order) => order.market.symbol))]
    let affectedSymbol = symbols[0]
    try {
      const openOrdersBySymbol = new Map()
      for (const symbol of symbols) {
        affectedSymbol = symbol
        let result
        try { result = await broker.getOpenOrders({ symbol }) } catch (error) {
          throw recoveryFailureError(error, "ACCOUNTING_INTEGRITY", "OWNED_OPEN_ORDERS_READ_EXCEPTION", false)
        }
        if (result?.ok !== false && result?.ok !== true) {
          throw recoveryFailureError(new Error("Open-order response is missing an explicit success flag for " + symbol), "ACCOUNTING_INTEGRITY", "OWNED_OPEN_ORDERS_RESPONSE", false)
        }
        if (result.ok === false) {
          const cause = result?.errors?.find?.((error) => error instanceof Error)
          throw recoveryFailureError(
            new Error("Open-order snapshot is incomplete or contains invalid Order records for " + symbol, { cause }),
            "REST_RECONCILIATION", "OWNED_OPEN_ORDERS_READ", true,
          )
        }
        if (!Array.isArray(result.data) || result.data.some((order) => !(order instanceof Order) ||
            typeof order.id !== "string" || typeof order.symbol !== "string" ||
            typeof order.originalQuantity !== "string" || typeof order.executedQuantity !== "string" ||
            !["NEW", "PARTIALLY_FILLED"].includes(order.status))) {
          throw recoveryFailureError(
            new Error("Open-order snapshot is incomplete or contains invalid Order records for " + symbol),
            "ACCOUNTING_INTEGRITY", "OWNED_OPEN_ORDER_SNAPSHOT", false,
          )
        }
        openOrdersBySymbol.set(symbol, result.data)
      }

      const snapshots = []
      for (const ownedOrder of ownedOrders) {
        const symbol = ownedOrder.market.symbol
        affectedSymbol = symbol
        let historyResult
        try { historyResult = await broker.getCanonicalOrderHistory({ symbol, orderId: ownedOrder.brokerOrderId }) }
        catch (error) { throw recoveryFailureError(error, "ACCOUNTING_INTEGRITY", "OWNED_ORDER_HISTORY_READ_EXCEPTION", false) }
        if (historyResult?.ok !== false && historyResult?.ok !== true) {
          throw recoveryFailureError(
            new Error("Canonical order history response is missing an explicit success flag for " + ownedOrder.brokerOrderId),
            "ACCOUNTING_INTEGRITY", "OWNED_ORDER_HISTORY_RESPONSE", false,
          )
        }
        if (historyResult.ok === false) {
          const cause = historyResult?.errors?.find?.((error) => error instanceof Error)
          throw recoveryFailureError(
            new Error("Canonical order history is incomplete for owned order " + ownedOrder.brokerOrderId, { cause }),
            "REST_RECONCILIATION", "OWNED_ORDER_HISTORY_READ", true,
          )
        }
        if (!Array.isArray(historyResult.data) || historyResult.data.length === 0) {
          throw recoveryFailureError(
            new Error("Canonical order history is incomplete for owned order " + ownedOrder.brokerOrderId),
            "REST_RECONCILIATION", "OWNED_ORDER_HISTORY_READ", true,
          )
        }
        if (historyResult.data.length !== 1 || !(historyResult.data[0] instanceof CanonicalOrder)) {
          throw recoveryFailureError(
            new Error("Canonical order history is incomplete or malformed for owned order " + ownedOrder.brokerOrderId),
            "ACCOUNTING_INTEGRITY", "OWNED_ORDER_HISTORY_SHAPE", false,
          )
        }
        const historyOrder = historyResult.data[0]
        const limitPriceMatches = historyOrder.limitPrice === undefined
          ? ownedOrder.limitPrice === undefined
          : ownedOrder.limitPrice !== undefined &&
            compareDecimal({
              left: historyOrder.limitPrice.amount,
              right: ownedOrder.limitPrice.amount,
            }) === 0
        if (
          historyOrder.brokerOrderId !== ownedOrder.brokerOrderId ||
          historyOrder.clientOrderId !== ownedOrder.clientOrderId ||
          historyOrder.market.id !== ownedOrder.market.id ||
          historyOrder.side !== ownedOrder.side ||
          historyOrder.type !== ownedOrder.type ||
          compareDecimal({
            left: historyOrder.originalQuantity.amount,
            right: ownedOrder.originalQuantity.amount,
          }) !== 0 ||
          !limitPriceMatches
        ) {
          throw recoveryFailureError(new Error("REST order history conflicts with the registered Harvester order " + ownedOrder.brokerOrderId), "OWNERSHIP_INTEGRITY", "OWNED_ORDER_HISTORY_IDENTITY", false)
        }
        if (historyOrder.status === "PENDING" || historyOrder.status === "UNKNOWN") {
          throw recoveryFailureError(new Error("REST order history does not establish an authoritative state for " + ownedOrder.brokerOrderId), "ACCOUNTING_INTEGRITY", "OWNED_ORDER_HISTORY_STATUS", false)
        }

        const matchingOpenOrders = openOrdersBySymbol.get(symbol).filter(
          (order) => order.id === ownedOrder.brokerOrderId,
        )
        if (matchingOpenOrders.length > 1) {
          throw recoveryFailureError(new Error("Open-order snapshot contains duplicate owned order " + ownedOrder.brokerOrderId), "OWNERSHIP_INTEGRITY", "OWNED_OPEN_ORDER_DUPLICATE", false)
        }
        const openOrder = matchingOpenOrders[0]
        if (openOrder && (
          openOrder.symbol.toUpperCase() !== symbol.toUpperCase() ||
          openOrder.side !== ownedOrder.side ||
          openOrder.type !== ownedOrder.type
        )) {
          throw recoveryFailureError(
            new Error("Open-order identity conflicts with canonical history for " + ownedOrder.brokerOrderId),
            "OWNERSHIP_INTEGRITY", "OWNED_OPEN_ORDER_IDENTITY", false,
          )
        }
        if (openOrder && (
          !["NEW", "PARTIALLY_FILLED"].includes(openOrder.status) ||
          (openOrder.status === "NEW" && compareDecimal({ left: openOrder.executedQuantity, right: "0" }) !== 0) ||
          (openOrder.status === "PARTIALLY_FILLED" && compareDecimal({ left: openOrder.executedQuantity, right: "0" }) === 0) ||
          compareDecimal({ left: openOrder.originalQuantity, right: ownedOrder.originalQuantity.amount }) !== 0 ||
          compareDecimal({ left: openOrder.executedQuantity, right: historyOrder.executedQuantity.amount }) > 0
        )) {
          throw recoveryFailureError(
            new Error("Open-order snapshot conflicts with canonical history for " + ownedOrder.brokerOrderId),
            "ACCOUNTING_INTEGRITY", "OWNED_OPEN_ORDER_HISTORY_PARITY", false,
          )
        }
        if (["OPEN", "PARTIALLY_FILLED"].includes(historyOrder.status) && !openOrder) {
          throw recoveryFailureError(new Error("Owned order is active in history but missing from the open-order snapshot: " + ownedOrder.brokerOrderId), "REST_RECONCILIATION", "OWNED_OPEN_ORDER_SNAPSHOT_PARITY", true)
        }

        const fillsById = new Map()
        const fillPageLimit = 1000
        let fromId
        let lastTradeId
        let fillsComplete = false
        for (let page = 0; page < 10000; page += 1) {
          let fillsResult
          try { fillsResult = await broker.getFills({ symbol, orderId: ownedOrder.brokerOrderId, ...(fromId === undefined ? {} : { fromId }), limit: fillPageLimit }) }
          catch (error) { throw recoveryFailureError(error, "ACCOUNTING_INTEGRITY", "OWNED_ORDER_FILL_HISTORY_READ_EXCEPTION", false) }
          if (fillsResult?.ok !== false && fillsResult?.ok !== true) {
            throw recoveryFailureError(
              new Error("REST fill-history response is missing an explicit success flag for owned order " + ownedOrder.brokerOrderId),
              "ACCOUNTING_INTEGRITY", "OWNED_ORDER_FILL_HISTORY_RESPONSE", false,
            )
          }
          if (fillsResult.ok === false) {
            const cause = fillsResult?.errors?.find?.((error) => error instanceof Error)
            throw recoveryFailureError(new Error("REST fill history is incomplete or invalid for owned order " + ownedOrder.brokerOrderId, { cause }), "REST_RECONCILIATION", "OWNED_ORDER_FILL_HISTORY_READ", true)
          }
          if (!Array.isArray(fillsResult.data) || fillsResult.data.length > fillPageLimit || fillsResult.data.some((fill) => !(fill instanceof Fill))) {
            throw recoveryFailureError(new Error("REST fill history is incomplete or invalid for owned order " + ownedOrder.brokerOrderId), "ACCOUNTING_INTEGRITY", "OWNED_ORDER_FILL_HISTORY_SHAPE", false)
          }
          let pageLastTradeId
          for (const fill of fillsResult.data) {
            if (
              fill.market.id !== ownedOrder.market.id ||
              fill.brokerOrderId !== ownedOrder.brokerOrderId ||
              fill.side !== ownedOrder.side ||
              (fill.clientOrderId !== undefined && fill.clientOrderId !== ownedOrder.clientOrderId)
            ) {
              throw recoveryFailureError(new Error("REST fill identity conflicts with owned order " + ownedOrder.brokerOrderId), "OWNERSHIP_INTEGRITY", "OWNED_ORDER_FILL_IDENTITY", false)
            }
            const journalFill = journalFillsById.get(fill.id)
            if (journalFill) {
              assertJournalFillParity({ fill, ownedOrder, journalFill })
            }
            const previous = fillsById.get(fill.id)
            if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
              throw new Error("REST returned conflicting payloads for execution ID " + fill.id)
            }
            fillsById.set(fill.id, fill)
          }
          if (fillsResult.data.length < fillPageLimit) {
            fillsComplete = true
            break
          }
          for (const fill of fillsResult.data) {
            if (typeof fill.tradeId !== "string" || !/^\d+$/.test(fill.tradeId)) {
              throw new Error("REST fill history cannot be paginated safely because trade ID is non-numeric for owned order " + ownedOrder.brokerOrderId)
            }
            const tradeId = BigInt(fill.tradeId)
            if (lastTradeId !== undefined && tradeId <= lastTradeId) {
              throw new Error("REST fill pagination did not advance strictly by trade ID for owned order " + ownedOrder.brokerOrderId)
            }
            lastTradeId = tradeId
            pageLastTradeId = tradeId
          }
          if (pageLastTradeId === undefined) {
            throw new Error("REST fill pagination returned a full empty page for owned order " + ownedOrder.brokerOrderId)
          }
          const nextFromId = pageLastTradeId + 1n
          if (nextFromId > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("REST fill pagination trade ID exceeds the broker's safe cursor range for owned order " + ownedOrder.brokerOrderId)
          }
          fromId = nextFromId.toString()
          if (page === 9999) {
            throw new Error("REST fill history exceeded the maximum supported pagination depth for owned order " + ownedOrder.brokerOrderId)
          }
        }
        if (!fillsComplete) {
          throw new Error("REST fill history could not be proven complete for owned order " + ownedOrder.brokerOrderId)
        }
        const fills = [...fillsById.values()].sort((left, right) => {
          if (left.executedAt !== undefined && right.executedAt !== undefined &&
              left.executedAt !== right.executedAt) {
            return left.executedAt - right.executedAt
          }
          return left.tradeId.localeCompare(right.tradeId)
        })
        const expectedJournalFillIds = [...journalFillsById.values()]
          .filter((journalFill) => journalFill.brokerOrderId === ownedOrder.brokerOrderId)
          .map((journalFill) => journalFill.fillId)
        for (const expectedFillId of expectedJournalFillIds) {
          if (!fillsById.has(expectedFillId)) {
            throw new Error("REST fill history is missing durable Journal execution ID " + expectedFillId)
          }
        }
        const reconciledQuantity = fills.reduce(
          (total, fill) => addDecimal({ left: total, right: fill.quantity.amount }),
          "0",
        )
        if (compareDecimal({
          left: reconciledQuantity,
          right: historyOrder.executedQuantity.amount,
        }) !== 0) {
          throw new Error("REST fill quantity does not reconcile with cumulative executed quantity for " + ownedOrder.brokerOrderId)
        }
        snapshots.push({ ownedOrder, historyOrder, fills, fillIds: new Set(fillsById.keys()) })
      }
      return { snapshots, symbols }
    } catch (caught) {
      const recoveryError = caught instanceof Error ? caught : new Error(String(caught), { cause: caught })
      recoveryError.reconciliationSymbol = affectedSymbol
      recoveryError.recoveryFailure = recoveryError.recoveryFailure ?? {
        category: "ACCOUNTING_INTEGRITY", stage: "UNCLASSIFIED_OWNED_ORDER_SNAPSHOT", retryable: false,
      }
      throw recoveryError
    }
  }
}
