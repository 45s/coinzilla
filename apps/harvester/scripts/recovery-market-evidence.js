import {
  Asset,
  Balance,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { AccountSnapshot } from "../src/domain/account/account-snapshot.js"
import { projectHarvesterJournalRecovery } from "../src/infrastructure/journal/project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "../src/use-cases/restore-harvester-journal-state.js"

function requireObject({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(field + " must be an object")
  }
  return value
}

function requireArray({ value, field }) {
  if (!Array.isArray(value)) throw new TypeError(field + " must be an array")
  return value
}

function requireString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value
}

function requireDecimal({ value, field }) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError(field + " must be a non-negative exact decimal string")
  }
  return value
}

function createCanonicalEvidence({ context }) {
  requireObject({ value: context, field: "context" })
  const records = requireArray({ value: context.journalRecords, field: "context.journalRecords" })
  const marketInputs = requireArray({ value: context.markets, field: "context.markets" })
  const assetsById = new Map()
  const assetsByCode = new Map()

  const registerAsset = (input, field) => {
    requireObject({ value: input, field })
    const id = requireString({ value: input.id, field: field + ".id" })
    const code = requireString({ value: input.code, field: field + ".code" })
    const existingById = assetsById.get(id)
    const existingByCode = assetsByCode.get(code)
    if ((existingById && existingById.code !== code) ||
        (existingByCode && existingByCode.id !== id)) {
      throw new Error("Offline evidence contains contradictory canonical asset identity for " + code)
    }
    const asset = existingById ?? existingByCode ?? new Asset({ id, code })
    assetsById.set(id, asset)
    assetsByCode.set(code, asset)
    return asset
  }

  for (const [index, input] of requireArray({
    value: context.assets ?? [],
    field: "context.assets",
  }).entries()) {
    registerAsset(input, "context.assets[" + index + "]")
  }

  const markets = marketInputs.map((input, index) => {
    requireObject({ value: input, field: "context.markets[" + index + "]" })
    const venue = requireString({ value: input.venue, field: "markets[" + index + "].venue" })
    const symbol = requireString({ value: input.symbol, field: "markets[" + index + "].symbol" })
    const market = new Market({
      venue,
      symbol,
      baseAsset: registerAsset(input.baseAsset, "markets[" + index + "].baseAsset"),
      quoteAsset: registerAsset(input.quoteAsset, "markets[" + index + "].quoteAsset"),
    })
    if (input.id !== undefined && input.id !== market.id) {
      throw new Error("Offline market ID does not match canonical venue/symbol identity for " + symbol)
    }
    return market
  })
  if (markets.length === 0 || new Set(markets.map((market) => market.symbol)).size !== markets.length) {
    throw new Error("Offline market metadata must contain unique canonical markets")
  }
  const marketsBySymbol = new Map(markets.map((market) => [market.symbol, market]))
  const assetsByLookup = {
    byId: assetsById,
    byCode: assetsByCode,
    require({ id, code, field }) {
      const asset = assetsById.get(id)
      if (!asset || asset.code !== code) {
        throw new Error(field + " has no matching canonical asset ID/code in context.assets or context.markets")
      }
      return asset
    },
  }

  const projection = projectHarvesterJournalRecovery({ records })
  if (projection?.ok !== true) {
    return toResult({ errors: projection?.errors ?? [new Error("Journal recovery projection failed")] })
  }
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: markets,
  })
  if (restored?.ok !== true) {
    return toResult({ errors: restored?.errors ?? [new Error("Journal recovery state restoration failed")] })
  }

  return toResult({
    data: {
      projection,
      recoveredState: restored.data,
      markets,
      marketsBySymbol,
      assetsByLookup,
    },
  })
}

function createAccountSnapshot({ input, assetsByLookup }) {
  requireObject({ value: input, field: "exchange.currentAccountSnapshot" })
  const balances = requireArray({
    value: input.balances,
    field: "exchange.currentAccountSnapshot.balances",
  }).map((balance, index) => {
    requireObject({ value: balance, field: "currentAccountSnapshot.balances[" + index + "]" })
    const asset = assetsByLookup.require({
      id: balance.assetId,
      code: balance.asset,
      field: "currentAccountSnapshot.balances[" + index + "]",
    })
    return new Balance({
      free: new Quantity({
        amount: requireDecimal({ value: balance.free, field: "balance.free" }),
        asset,
      }),
      locked: new Quantity({
        amount: requireDecimal({ value: balance.locked, field: "balance.locked" }),
        asset,
      }),
    })
  })
  return new AccountSnapshot({ balances, sourceTime: input.sourceTime })
}

function createCanonicalOrder({ input, marketsBySymbol }) {
  requireObject({ value: input, field: "ownedOrderHistory entry" })
  const symbol = requireString({ value: input.symbol, field: "ownedOrderHistory.symbol" })
  const market = marketsBySymbol.get(symbol)
  if (!market) throw new Error("Canonical Market metadata is missing for owned order " + symbol)
  const type = requireString({ value: input.type, field: "ownedOrderHistory.type" })
  const limitPrice = type === "MARKET"
    ? undefined
    : new Money({
        amount: requireDecimal({ value: input.price, field: "ownedOrderHistory.price" }),
        asset: market.quoteAsset,
      })
  const brokerOrderId = input.brokerOrderId == null
    ? undefined
    : requireString({ value: input.brokerOrderId, field: "ownedOrderHistory.brokerOrderId" })
  return new CanonicalOrder({
    clientOrderId: requireString({ value: input.clientOrderId, field: "ownedOrderHistory.clientOrderId" }),
    brokerOrderId,
    market,
    side: input.side,
    type,
    limitPrice,
    originalQuantity: new Quantity({
      amount: requireDecimal({ value: input.originalQuantity, field: "ownedOrderHistory.originalQuantity" }),
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: requireDecimal({ value: input.executedQuantity, field: "ownedOrderHistory.executedQuantity" }),
      asset: market.baseAsset,
    }),
    status: input.status === "NEW" ? "OPEN" : input.status,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.acknowledgedAt === undefined ? {} : { acknowledgedAt: input.acknowledgedAt }),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
  })
}

function createCanonicalFill({ input, marketsBySymbol, assetsByLookup }) {
  requireObject({ value: input, field: "tradeHistory fill" })
  const symbol = requireString({ value: input.symbol, field: "tradeHistory.fill.symbol" })
  const market = marketsBySymbol.get(symbol)
  if (!market) throw new Error("Canonical Market metadata is missing for trade-history fill " + symbol)
  const commissions = requireArray({
    value: input.commissions ?? [],
    field: "tradeHistory.fill.commissions",
  }).map((commission, index) => {
    const asset = assetsByLookup.require({
      id: commission.assetId,
      code: commission.asset,
      field: "tradeHistory.fill.commissions[" + index + "]",
    })
    const quoteValue = commission.quoteValue === undefined
      ? undefined
      : new Money({
          amount: requireDecimal({
            value: commission.quoteValue.amount,
            field: "commission.quoteValue.amount",
          }),
          asset: assetsByLookup.require({
            id: commission.quoteValue.assetId,
            code: commission.quoteValue.asset,
            field: "commission.quoteValue",
          }),
        })
    return new Commission({
      amount: new Money({
        amount: requireDecimal({ value: commission.amount, field: "commission.amount" }),
        asset,
      }),
      ...(quoteValue === undefined ? {} : { quoteValue }),
    })
  })
  return new Fill({
    tradeId: requireString({ value: input.tradeId, field: "tradeHistory.fill.tradeId" }),
    brokerOrderId: requireString({ value: input.brokerOrderId, field: "tradeHistory.fill.brokerOrderId" }),
    ...(input.clientOrderId === undefined ? {} : {
      clientOrderId: requireString({ value: input.clientOrderId, field: "tradeHistory.fill.clientOrderId" }),
    }),
    market,
    side: input.side,
    price: new Money({
      amount: requireDecimal({ value: input.price, field: "tradeHistory.fill.price" }),
      asset: market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: requireDecimal({ value: input.quantity, field: "tradeHistory.fill.quantity" }),
      asset: market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: requireDecimal({ value: input.quoteQuantity, field: "tradeHistory.fill.quoteQuantity" }),
      asset: market.quoteAsset,
    }),
    liquidityRole: input.liquidityRole,
    ...(input.executedAt === undefined ? {} : { executedAt: input.executedAt }),
    commissions,
    commissionStatus: input.commissionStatus,
  })
}

function reconcileOfflineOwnedOrders({ recoveredState, orderHistory, marketsBySymbol }) {
  const evidence = requireArray({ value: orderHistory, field: "exchange.ownedOrderHistory" })
  const evidenceByClientId = new Map()
  for (const item of evidence) {
    const clientOrderId = requireString({
      value: item?.clientOrderId,
      field: "ownedOrderHistory.clientOrderId",
    })
    if (evidenceByClientId.has(clientOrderId)) {
      throw new Error("Offline owned-order evidence contains duplicate clientOrderId " + clientOrderId)
    }
    evidenceByClientId.set(clientOrderId, item)
  }

  let orderRegistry = recoveredState.orderRegistry
  let reconciledOrders = 0
  for (const current of orderRegistry.orders) {
    const item = evidenceByClientId.get(current.clientOrderId)
    if (!item) {
      throw new Error("Offline exchange order history is missing recovered owned order " + current.clientOrderId)
    }
    const update = createCanonicalOrder({ input: item, marketsBySymbol })
    const applied = orderRegistry.applyUpdate({ order: update })
    if (applied.unknown || applied.stale) {
      throw new Error("Offline exchange order evidence did not reconcile owned order " + current.clientOrderId)
    }
    orderRegistry = applied.registry
    reconciledOrders += 1
    evidenceByClientId.delete(current.clientOrderId)
  }
  if (evidenceByClientId.size > 0) {
    throw new Error("Offline owned-order evidence contains an order not owned by the recovered Journal projection")
  }
  if (orderRegistry.orders.some((order) => ["PENDING", "UNKNOWN"].includes(order.status))) {
    throw new Error("Offline exchange order evidence leaves an owned order unresolved")
  }
  return Object.freeze({ ...recoveredState, orderRegistry, reconciledOrders })
}

export {
  createCanonicalEvidence,
  createAccountSnapshot,
  createCanonicalFill,
  createCanonicalOrder,
  reconcileOfflineOwnedOrders,
}
