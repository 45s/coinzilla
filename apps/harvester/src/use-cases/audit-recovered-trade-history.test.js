import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { auditRecoveredTradeHistory } from "./audit-recovered-trade-history.js"

const baseAsset = new Asset({ id: "binance:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

const makeFill = (overrides = {}) => new Fill({
  tradeId: "trade-1",
  brokerOrderId: "9001",
  clientOrderId: "h-BTCUSDT-1",
  market,
  side: "BUY",
  price: new Money({ amount: "100", asset: quoteAsset }),
  quantity: new Quantity({ amount: "0.4", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "40", asset: quoteAsset }),
  liquidityRole: "MAKER",
  commissions: [],
  commissionStatus: "COMPLETE",
  ...overrides,
})

const journalFill = (fill = makeFill()) => ({
  fillId: fill.id,
  tradeId: String(fill.tradeId),
  brokerOrderId: fill.brokerOrderId,
  clientOrderId: fill.clientOrderId,
  symbol: fill.market.symbol,
  side: fill.side,
  price: fill.price.amount,
  quantity: fill.quantity.amount,
  quoteQuantity: fill.quoteQuantity.amount,
  liquidityRole: fill.liquidityRole,
  commissions: fill.commissions.map(({ amount }) => ({
    amount: amount.amount,
    assetId: amount.asset.id,
    asset: amount.asset.code,
  })),
  commissionStatus: fill.commissionStatus,
  ...(fill.executedAt === undefined ? {} : { executedAt: fill.executedAt }),
})

test("accepts exact complete account trade history matching every durable Journal fill", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    complete: true,
    marketUniverseComplete: true,
    fillsChecked: 1,
    journalFillsChecked: 1,
  })
})

test("rejects incomplete account-wide trade history even when every returned fill matches", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    complete: false,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /history is incomplete/)
})

test("rejects an exchange execution absent from the Harvester Journal", () => {
  const ownedFill = makeFill()
  const externalFill = makeFill({
    tradeId: "trade-2",
    brokerOrderId: "9002",
    clientOrderId: "manual-order",
  })
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(ownedFill)],
    exchangeFills: [ownedFill, externalFill],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /absent from the Harvester Journal/)
})

test("rejects a Journal execution missing from complete exchange trade history", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /missing from complete exchange account trade history/)
})

test("rejects contradictory exact execution facts and commission data", () => {
  const fill = makeFill()
  const contradictory = makeFill({
    price: new Money({ amount: "101", asset: quoteAsset }),
    quoteQuantity: new Money({ amount: "40.4", asset: quoteAsset }),
  })
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [contradictory],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /conflicts with durable Journal price/)
})

test("rejects duplicate exchange execution and trade identities", () => {
  const fill = makeFill()
  const duplicate = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill, fill],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(duplicate.ok, false)
  assert.match(duplicate.errors[0].message, /duplicate execution identity/)
})

test("rejects non-canonical exchange fill records", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [{ ...fill }],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be a canonical Fill/)
})


test("accepts canonical account trade fills that omit clientOrderId when broker and trade identities match", () => {
  const journalExecution = makeFill()
  const exchangeFill = makeFill({ clientOrderId: undefined })
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(journalExecution)],
    exchangeFills: [exchangeFill],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.fillsChecked, 1)
})


test("rejects complete symbol pages when the exchange market universe is not proven complete", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    complete: true,
    marketUniverseComplete: false,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /market universe is incomplete/)
})


test("accepts exchange fills missing from the prior Journal only when their broker order was reconciled as Harvester-owned", () => {
  const fill = makeFill()
  const ownedOrder = new CanonicalOrder({
    clientOrderId: "h-BTCUSDT-1",
    brokerOrderId: "9001",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "100", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0.4", asset: baseAsset }),
    status: "FILLED",
  })
  const result = auditRecoveredTradeHistory({
    journalFills: [],
    exchangeFills: [fill],
    ownedOrders: [ownedOrder],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reconciledOwnedOrderFills, 1)
})

test("rejects an unjournaled account execution whose broker order identity is not owned", () => {
  const fill = makeFill({ brokerOrderId: "external-order-77" })
  const result = auditRecoveredTradeHistory({
    journalFills: [],
    exchangeFills: [fill],
    ownedOrders: [],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /absent from the Harvester Journal and recovered order registry/)
})
