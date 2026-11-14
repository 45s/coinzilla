import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { auditRecoveredTradeHistory } from "./audit-recovered-trade-history.js"
import { readMarketHistoryCoverage } from "./read-market-history-coverage.js"
import { recordMarketHistoryCoverage } from "./record-market-history-coverage.js"

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

const marketHistoryEvidence = Object.freeze({
  historyPagesComplete: true,
  marketHistoryPagesComplete: true,
  historyScope: "MARKET",
  marketsQueried: Object.freeze(["BTCUSDT"]),
  historyStartTime: 50,
})

const auditMarketHistory = (input = {}) => auditRecoveredTradeHistory({
  complete: false,
  marketUniverseComplete: false,
  scope: "MARKET",
  market,
  historyEvidence: marketHistoryEvidence,
  historyRetentionEvidence: {
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    baselineFactId: "history-baseline-btc-1",
    symbol: "BTCUSDT",
    coveredFromTime: 50,
    verifiedAt: 60,
    evidenceDigest: "a".repeat(64),
    verifiedBy: "operator:trader",
  },
  ...input,
})

test("rejects a caller-supplied market-universe boolean as account-wide completeness evidence", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    complete: true,
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Caller-supplied marketUniverseComplete is not authoritative evidence/)
})

test("rejects incomplete account-wide trade history even when every returned fill matches", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    complete: false,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /history pages are incomplete/)
})

test("rejects an exchange execution absent from the Harvester Journal", () => {
  const ownedFill = makeFill()
  const externalFill = makeFill({
    tradeId: "trade-2",
    brokerOrderId: "9002",
    clientOrderId: "manual-order",
  })
  const result = auditMarketHistory({
    journalFills: [journalFill(ownedFill)],
    exchangeFills: [ownedFill, externalFill],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /absent from the Harvester Journal/)
})

test("rejects a Journal execution missing from complete exchange trade history", () => {
  const fill = makeFill()
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [],
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
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [contradictory],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /conflicts with durable Journal price/)
})

test("rejects duplicate exchange execution and trade identities", () => {
  const fill = makeFill()
  const duplicate = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill, fill],
  })

  assert.equal(duplicate.ok, false)
  assert.match(duplicate.errors[0].message, /duplicate execution identity/)
})

test("rejects non-canonical exchange fill records", () => {
  const fill = makeFill()
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [{ ...fill }],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be a canonical Fill/)
})


test("accepts canonical account trade fills that omit clientOrderId when broker and trade identities match", () => {
  const journalExecution = makeFill()
  const exchangeFill = makeFill({ clientOrderId: undefined })
  const result = auditMarketHistory({
    journalFills: [journalFill(journalExecution)],
    exchangeFills: [exchangeFill],
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
    originalQuantity: new Quantity({ amount: "0.4", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0.4", asset: baseAsset }),
    status: "FILLED",
  })
  const result = auditMarketHistory({
    journalFills: [],
    exchangeFills: [fill],
    ownedOrders: [ownedOrder],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reconciledOwnedOrderFills, 1)
})

test("rejects an unjournaled account execution whose broker order identity is not owned", () => {
  const fill = makeFill({ brokerOrderId: "external-order-77" })
  const result = auditMarketHistory({
    journalFills: [],
    exchangeFills: [fill],
    ownedOrders: [],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /absent from the Harvester Journal and recovered order registry/)
})


test("audits complete execution history for one market without claiming account-wide universe completeness", () => {
  const fill = makeFill()
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.scope, "MARKET")
  assert.equal(result.data.marketSymbol, "BTCUSDT")
  assert.equal(result.data.marketUniverseComplete, false)
  assert.equal(result.data.fillsChecked, 1)
  assert.equal(result.data.journalFillsChecked, 1)
})


test("rejects market-scoped history when structured pagination evidence is absent", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    scope: "MARKET",
    market,
    complete: true,
    marketUniverseComplete: false,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /pagination evidence is missing/)
})

test("rejects cross-market executions in a single-market history response", () => {
  const fill = makeFill()
  const ethAsset = new Asset({ id: "binance:ETH", code: "ETH" })
  const ethMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset,
  })
  const otherMarketFill = new Fill({
    tradeId: "eth-trade-1",
    brokerOrderId: "eth-order-1",
    clientOrderId: "manual-eth",
    market: ethMarket,
    side: "BUY",
    price: new Money({ amount: "10", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: ethAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill, otherMarketFill],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /contains a fill for another market/)
})


test("rejects market pagination without durable retention coverage", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    scope: "MARKET",
    market,
    historyEvidence: marketHistoryEvidence,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Durable market-history retention evidence is missing/)
})

test("rejects a durable market-history baseline that starts after the queried history", () => {
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    scope: "MARKET",
    market,
    historyEvidence: marketHistoryEvidence,
    historyRetentionEvidence: {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: "history-baseline-btc-late",
      symbol: "BTCUSDT",
      coveredFromTime: 51,
      verifiedAt: 60,
      evidenceDigest: "a".repeat(64),
      verifiedBy: "operator:trader",
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /does not cover BTCUSDT/)
})


test("rejects a history-coverage fact verified before the requested history start", () => {
  const fill = makeFill()
  const result = auditMarketHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    historyRetentionEvidence: {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: "history-baseline-btc-stale",
      symbol: "BTCUSDT",
      coveredFromTime: 40,
      verifiedAt: 49,
      evidenceDigest: "c".repeat(64),
      verifiedBy: "operator:trader",
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /does not cover BTCUSDT/)
})


test("feeds integrity-verified durable coverage projection into the market history audit", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-market-history-audit-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "market-history-audit-test",
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  })
  const initialized = await operationalStateStore.initialize()
  assert.equal(initialized.ok, true, initialized.errors?.map(({ message }) => message).join("; "))
  const recorded = await recordMarketHistoryCoverage({
    operationalStateStore,
    factId: "coverage:BTCUSDT:audit",
    symbol: "BTCUSDT",
    coveredFromTime: 40,
    verifiedAt: 60,
    evidenceDigest: "d".repeat(64),
    verifiedBy: "operator:trader",
  })
  assert.equal(recorded.ok, true, recorded.errors?.map(({ message }) => message).join("; "))
  const projected = await readMarketHistoryCoverage({ operationalStateStore, symbol: "BTCUSDT" })
  assert.equal(projected.ok, true, projected.errors?.map(({ message }) => message).join("; "))
  const fill = makeFill()
  const result = auditRecoveredTradeHistory({
    journalFills: [journalFill(fill)],
    exchangeFills: [fill],
    scope: "MARKET",
    market,
    historyEvidence: marketHistoryEvidence,
    historyRetentionEvidence: projected.data,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.historyRetentionBaselineFactId, "coverage:BTCUSDT:audit")
  assert.equal(result.data.historyRetentionEvidenceDigest, "d".repeat(64))
})
