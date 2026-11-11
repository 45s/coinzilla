import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "../../use-cases/restore-harvester-journal-state.js"
import {
  mapExecutionAccountingFailedData,
  mapExecutionInvalidFillData,
  mapExecutionUnownedOrderData,
  mapFillAppliedData,
} from "../../application/events/lifecycle-event-dtos.js"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../domain/strategies/conservative/recovery-ledger.js"
import { updateTradingAccounting } from "../../use-cases/update-trading-accounting.js"

const record = (name, data, id = name) => ({
  id,
  payload: { id, name, data },
  position: { fileName: "session.jsonl", lineNumber: 1 },
})

const submissionRequested = (overrides = {}) => record("order.submission_requested", {
  clientOrderId: "h-BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "100",
  quantity: "1",
  status: "PENDING",
  ...overrides,
})

const submitted = (overrides = {}) => record("order.submitted", {
  clientOrderId: "h-BTCUSDT-1",
  brokerOrderId: "9001",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "100",
  quantity: "1",
  status: "NEW",
  ...overrides,
})

const fill = (overrides = {}) => record("execution.fill_applied", {
  fillId: "binance:BTCUSDT:trade-1",
  tradeId: "trade-1",
  brokerOrderId: "9001",
  clientOrderId: "h-BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "BUY",
  price: "100",
  quantity: "0.4",
  quoteQuantity: "40",
  liquidityRole: "MAKER",
  commissions: [{ amount: "0.0004", assetId: "binance:BTC", asset: "BTC" }],
  commissionStatus: "COMPLETE",
  ...overrides,
})

test("projects durable order identity and exact fill facts without claiming exchange state is restored", () => {
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), submitted(), fill()],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders.length, 1)
  assert.equal(result.data.orders[0].clientOrderId, "h-BTCUSDT-1")
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
  assert.deepEqual(result.data.orders[0].fillIds, ["binance:BTCUSDT:trade-1"])
  assert.equal(result.data.fills[0].commissions[0].amount, "0.0004")
  assert.equal(result.data.requiresExchangeReconciliation, true)
})

test("preserves a submission whose broker outcome was unknown", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("order.submission_failed", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "BUY",
        outcome: "REJECTED_OR_UNKNOWN",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].submissionOutcome, "REJECTED_OR_UNKNOWN")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].requiresExchangeReconciliation, true)
})

test("preserves a durable cancellation intent without assuming the exchange canceled the order", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].cancellationState, "REQUESTED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
})

test("requires a durable cancellation intent before accepting a confirmed cancellation", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /preceding durable cancellation intent/)
})

test("rejects fill facts that conflict with the owned order identity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({ brokerOrderId: "other-order" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /identity conflicts/)
})

test("rejects cumulative fill quantity beyond the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({ quantity: "1.01", quoteQuantity: "101" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceed original order quantity/)
})

test("accepts an explicitly marked exact duplicate fill without increasing cumulative execution", () => {
  const original = fill()
  const duplicate = fill({ duplicate: true })
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested(), submitted(), original, duplicate] })

  assert.equal(result.ok, true)
  assert.equal(result.data.fills.length, 1)
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
})

test("rejects a duplicate fill ID with changed execution facts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill(),
      fill({ duplicate: true, quantity: "0.5", quoteQuantity: "50" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /conflicting or unmarked replay facts/)
})

test("rejects an applied fill with no durable owned-order intent", () => {
  const result = projectHarvesterJournalRecovery({ records: [fill()] })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unknown clientOrderId/)
})

test("projects recovery-cycle completions and paused strategy state", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-sell-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "0.4",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-sell-1",
        brokerOrderId: "9002",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "0.4",
        status: "FILLED",
      }),
      record("execution.fill_applied", {
        fillId: "binance:BTCUSDT:trade-2",
        tradeId: "trade-2",
        brokerOrderId: "9002",
        clientOrderId: "h-BTCUSDT-sell-1",
        symbol: "BTCUSDT",
        side: "SELL",
        price: "100",
        quantity: "0.4",
        quoteQuantity: "40",
        liquidityRole: "MAKER",
        commissions: [],
        commissionStatus: "COMPLETE",
      }),
      record("recovery.cycle_completed", {
        symbol: "BTCUSDT",
        marketId: "binance:BTCUSDT",
        freeQuantity: "0.01",
        keepQuantity: "0.01",
        minProfit: "0.01",
        realizedNetProfit: "0.25",
      }),
      record("strategy.paused", {
        symbol: "BTCUSDT",
        reason: "UNKNOWN_ORDER_OUTCOME",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.recoveryCycles, [{
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.01",
    minProfit: "0.01",
    realizedNetProfit: "0.25",
    completedOrderClientId: "h-BTCUSDT-sell-1",
    completedOrderBrokerOrderId: "9002",
    sequence: 3,
  }])
  assert.deepEqual(result.data.pausedMarkets, [{
    symbol: "BTCUSDT",
    reason: "UNKNOWN_ORDER_OUTCOME",
  }])
})

test("fails closed on malformed recognized recovery records", () => {
  const result = projectHarvesterJournalRecovery({
    records: [record("order.submission_requested", { clientOrderId: "missing-other-fields" })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /symbol/)
})

test("requires records to be an array", () => {
  const result = projectHarvesterJournalRecovery({ records: null })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be an array/)
})


test("projects account audit snapshots and recognizes a complete prior trading shutdown", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 101,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.accountSnapshots.length, 2)
  assert.equal(result.data.openOrderSnapshots.length, 1)
  assert.equal(result.data.sessions[0].tradingEnabled, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, false)
  assert.equal(result.data.requiresExchangeReconciliation, true)
})

test("marks a trading session without a complete closing audit as unclean", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("rejects account snapshot totals that do not equal free plus locked", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances: [{ asset: "BTC", free: "0.5", locked: "0.1", total: "0.5" }],
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /free plus locked/)
})

test("rejects open orders in a READY account open-order snapshot", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 1,
        orders: [{
          brokerOrderId: "9001",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "100",
          quantity: "1",
          executedQuantity: "0",
          status: "NEW",
        }],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /READY open-order snapshot requires no orders/)
})


test("marks a trading session with order activity but no start event as unclean", () => {
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested()] })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].hasTradingActivity, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("flags cancellation snapshots whose cumulative execution is not fully represented by Journal fills", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].requiresFillHistoryReconciliation, true)
})

test("rejects cancellation execution quantities above the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "1.01",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceeds original order quantity/)
})


test("marks a trading session with order activity but no start event as unclean", () => {
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested()] })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].hasTradingActivity, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("flags cancellation snapshots whose cumulative execution is not fully represented by Journal fills", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].requiresFillHistoryReconciliation, true)
})

test("rejects cancellation execution quantities above the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "1.01",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceeds original order quantity/)
})


const canonicalMarket = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
})

test("projects exact third-asset commission amount and historical quote valuation", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
          quoteValue: {
            amount: "0.123456789012345678",
            assetId: "binance:USDT",
            asset: "USDT",
          },
        }],
      }),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.fills[0].commissions[0], {
    amount: "0.0001",
    assetId: "binance:BNB",
    asset: "BNB",
    quoteValue: {
      amount: "0.123456789012345678",
      assetId: "binance:USDT",
      asset: "USDT",
    },
  })
})

test("fails closed when a restored third-asset commission has no historical quote valuation", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /missing its historical quote valuation/)
})

test("restores a zero third-asset commission without inventing a quote valuation", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0",
          assetId: "binance:BNB",
          asset: "BNB",
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join("; "))
  const restoredFill = restored.data.journalFills[0]
  assert.equal(restoredFill.commissions[0].amount, "0")
  assert.equal(restoredFill.commissions[0].assetId, "binance:BNB")
  assert.equal(restoredFill.commissions[0].quoteValue, undefined)
})

test("rejects a commission whose asset code contradicts a known market asset ID", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BTC",
          asset: "BNB",
          quoteValue: {
            amount: "0.123",
            assetId: "binance:USDT",
            asset: "USDT",
          },
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /asset code contradicts the market base asset identity/)
})

test("fails closed when a positive third-asset commission has a zero historical quote valuation", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
          quoteValue: {
            amount: "0",
            assetId: "binance:USDT",
            asset: "USDT",
          },
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /must be greater than zero/)
})

test("rejects a third-asset commission valued in an asset other than the market quote asset", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
          quoteValue: {
            amount: "0.123",
            assetId: "binance:USDC",
            asset: "USDC",
          },
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /does not match the market quote asset/)
})

test("matches live BUY/SELL accounting through DTO, projection, and restore for base, quote, and third-asset fees", () => {
  const bnbAsset = new Asset({ id: "binance:BNB", code: "BNB" })
  const fills = [
    new Fill({
      tradeId: "parity-buy",
      brokerOrderId: "9101",
      clientOrderId: "h-BTCUSDT-parity-buy",
      market: canonicalMarket,
      side: "BUY",
      price: new Money({ amount: "0.1", asset: canonicalMarket.quoteAsset }),
      quantity: new Quantity({ amount: "100", asset: canonicalMarket.baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: canonicalMarket.quoteAsset }),
      liquidityRole: "MAKER",
      commissions: [
        new Commission({ amount: new Money({ amount: "1", asset: canonicalMarket.baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: canonicalMarket.quoteAsset }) }),
        new Commission({
          amount: new Money({ amount: "0.001", asset: bnbAsset }),
          quoteValue: new Money({ amount: "0.02", asset: canonicalMarket.quoteAsset }),
        }),
      ],
      commissionStatus: "COMPLETE",
    }),
    new Fill({
      tradeId: "parity-sell",
      brokerOrderId: "9102",
      clientOrderId: "h-BTCUSDT-parity-sell",
      market: canonicalMarket,
      side: "SELL",
      price: new Money({ amount: "0.12", asset: canonicalMarket.quoteAsset }),
      quantity: new Quantity({ amount: "50", asset: canonicalMarket.baseAsset }),
      quoteQuantity: new Money({ amount: "6", asset: canonicalMarket.quoteAsset }),
      liquidityRole: "MAKER",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.5", asset: canonicalMarket.baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.02", asset: canonicalMarket.quoteAsset }) }),
        new Commission({
          amount: new Money({ amount: "0.001", asset: bnbAsset }),
          quoteValue: new Money({ amount: "0.03", asset: canonicalMarket.quoteAsset }),
        }),
      ],
      commissionStatus: "COMPLETE",
    }),
  ]

  let livePortfolio = new Portfolio()
  let liveLedger = RecoveryLedger.empty({ market: canonicalMarket })
  const records = []
  for (const fillValue of fills) {
    const live = updateTradingAccounting({
      portfolio: livePortfolio,
      recoveryLedger: liveLedger,
      fill: fillValue,
    })
    assert.equal(live.ok, true, live.errors?.map(({ message }) => message).join("; "))
    livePortfolio = live.data.portfolio
    liveLedger = live.data.recoveryLedger

    const dto = mapFillAppliedData({ fill: fillValue })
    assert.equal(dto.ok, true, dto.errors?.map(({ message }) => message).join("; "))
    const clientOrderId = fillValue.clientOrderId
    const orderFacts = {
      clientOrderId,
      symbol: canonicalMarket.symbol,
      side: fillValue.side,
      type: "LIMIT",
      price: fillValue.price.amount,
      quantity: fillValue.quantity.amount,
    }
    records.push(record("order.submission_requested", {
      ...orderFacts,
      status: "PENDING",
    }, "requested-" + fillValue.tradeId))
    records.push(record("order.submitted", {
      ...orderFacts,
      brokerOrderId: fillValue.brokerOrderId,
      status: "NEW",
    }, "submitted-" + fillValue.tradeId))
    records.push(record("execution.fill_applied", dto.data, "fill-" + fillValue.tradeId))
  }

  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([[canonicalMarket.symbol, canonicalMarket]]),
  })
  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join("; "))

  const livePosition = livePortfolio.getPosition({ marketId: canonicalMarket.id })
  const restoredPosition = restored.data.portfolio.getPosition({ marketId: canonicalMarket.id })
  const restoredLedger = restored.data.recoveryLedgers.get(canonicalMarket.id)
  assert.deepEqual(restoredPosition.value, livePosition.value)
  assert.deepEqual(restoredLedger.value, liveLedger.value)
  assert.equal(livePosition.baseQuantity.amount, "48.5")
  assert.equal(livePosition.spent.amount, "10.03")
  assert.equal(livePosition.quoteNetCashFlow.amount, "-4.08")
  assert.equal(liveLedger.buyCost, "10.03")
  assert.equal(liveLedger.netSellProceeds, "5.95")
})

test("restores third-asset commission facts and historical quote valuation into both accounting projections", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({
        commissions: [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
          quoteValue: {
            amount: "0.123456789012345678",
            assetId: "binance:USDT",
            asset: "USDT",
          },
        }],
      }),
    ],
  })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join("; "))
  const position = restored.data.portfolio.getPosition({ symbol: "BTCUSDT" })
  const ledger = restored.data.recoveryLedgers.get(canonicalMarket.id)
  assert.equal(position.baseQuantity.amount, "0.4")
  assert.equal(position.spent.amount, "40.123456789012345678")
  assert.equal(position.quoteNetCashFlow.amount, "-40.123456789012345678")
  assert.equal(ledger.buyCost, "40.123456789012345678")
  assert.equal(ledger.netSellProceeds, "0")
})

const completedCycleRecords = () => [
  record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-buy-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "0.5",
    status: "PENDING",
  }),
  record("order.submitted", {
    clientOrderId: "h-BTCUSDT-buy-1",
    brokerOrderId: "9001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "0.5",
    status: "FILLED",
  }),
  record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-1",
    tradeId: "trade-1",
    brokerOrderId: "9001",
    clientOrderId: "h-BTCUSDT-buy-1",
    symbol: "BTCUSDT",
    side: "BUY",
    price: "100",
    quantity: "0.5",
    quoteQuantity: "50",
    liquidityRole: "MAKER",
    commissions: [{ amount: "0.0004", assetId: "binance:BTC", asset: "BTC" }],
    commissionStatus: "COMPLETE",
  }),
  record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-sell-1",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    price: "102.757352941176470588",
    quantity: "0.4896",
    status: "PENDING",
  }),
  record("order.submitted", {
    clientOrderId: "h-BTCUSDT-sell-1",
    brokerOrderId: "9002",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    price: "102.757352941176470588",
    quantity: "0.4896",
    status: "FILLED",
  }),
  record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-2",
    tradeId: "trade-2",
    brokerOrderId: "9002",
    clientOrderId: "h-BTCUSDT-sell-1",
    symbol: "BTCUSDT",
    side: "SELL",
    price: "102.757352941176470588",
    quantity: "0.4896",
    quoteQuantity: "50.25",
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  }),
  record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.01",
    minProfit: "0.01",
    realizedNetProfit: "0.25",
  }),
]

test("rejects a journal completion whose free quantity is not keepQuantity plus dust", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.02",
    minProfit: "0.01",
    realizedNetProfit: "0.25",
  })
  const result = projectHarvesterJournalRecovery({ records })
  assert.equal(result.ok, false)
  assert.match(result.errors?.[0]?.message ?? "", /freeQuantity must equal keepQuantity/)
})

test("rejects a journal completion whose realized profit misses its recorded configured threshold", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.01",
    minProfit: "0.3",
    realizedNetProfit: "0.25",
  })
  const result = projectHarvesterJournalRecovery({ records })
  assert.equal(result.ok, false)
  assert.match(result.errors?.[0]?.message ?? "", /does not meet minProfit/)
})

test("replays exchange-constrained dust as a bonus above keepQuantity", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.005",
    minProfit: "0.01",
    realizedNetProfit: "0.25",
    dust: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.005",
      reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.01",
      evaluatedQuantity: "0",
    },
  })
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))
  assert.equal(projection.data.recoveryCycles[0].dust.quantity, "0.005")

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })
  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join("; "))
  const position = restored.data.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0")
  assert.equal(position.freeBaseQuantity.amount, "0.01")
})

test("restores Portfolio, RecoveryLedger, free inventory, and order ownership from replayed fills", () => {
  const projection = projectHarvesterJournalRecovery({ records: completedCycleRecords() })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join('; '))

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join('; '))
  const position = restored.data.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0")
  assert.equal(position.freeBaseQuantity.amount, "0.01")
  assert.equal(position.totalBaseQuantity.amount, "0.01")
  const ledger = restored.data.recoveryLedgers.get(canonicalMarket.id)
  assert.equal(ledger.buyCost, "0")
  assert.equal(ledger.netSellProceeds, "0")
  assert.equal(ledger.appliedFillIds.length, 2)
  assert.equal(restored.data.orderRegistry.orders.length, 2)
  assert.ok(restored.data.orderRegistry.orders.every((order) => order.status === "UNKNOWN"))
  assert.deepEqual([...restored.data.completedOrderClientIds], ["h-BTCUSDT-sell-1"])
  assert.deepEqual([...restored.data.trailingBuySymbols], ["BTCUSDT"])
})

test("fails closed when a completed-cycle journal record leaves active sellable inventory", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.009",
    keepQuantity: "0.009",
    minProfit: "0.01",
    realizedNetProfit: "0.25",
  })
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors?.[0]?.message ?? "", /must allocate all replayed active inventory/)
})

test("fails closed when canonical market metadata is missing for a recovered fill", () => {
  const projection = projectHarvesterJournalRecovery({ records: completedCycleRecords() })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map(),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /Market metadata is unavailable/)
})

test("fails closed when recovery-cycle profit contradicts replayed fills", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    keepQuantity: "0.01",
    minProfit: "0.01",
    realizedNetProfit: "0.26",
  })
  const projection = projectHarvesterJournalRecovery({ records })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /profit conflicts/)
})


test("rejects a replacement submission while the previous cancellation remains unresolved", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "TRAILING_BUY_REPRICE",
      }),
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-2",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "99",
        quantity: "1",
        status: "PENDING",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /prior cancellation remains UNKNOWN/)
})

test("restores a replacement intent after confirmed cancellation but before the replacement submission", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.replacementIntents], ["BTCUSDT"])
})

test("does not restore a replacement intent after the replacement submission is journaled", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-2",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "101",
        quantity: "1",
        status: "PENDING",
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.replacementIntents], [])
})


test("recovers broker order identity from a durable fill when the acknowledgement event was lost", () => {
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), fill()],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
  assert.equal(result.data.requiresExchangeReconciliation, true)
})


test("recovers broker order identity from a durable cancellation intent when the acknowledgement event was lost", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "TRAILING_BUY_REPRICE",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].cancellationState, "REQUESTED")
})


test("accepts a RECONCILED account open-order snapshot with durable Harvester ownership", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-open-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-open-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("account.open_orders_captured", {
        phase: "OPENING",
        observedAt: 100,
        readiness: "RECONCILED",
        orderCount: 1,
        orders: [{
          clientOrderId: "h-BTCUSDT-open-1",
          brokerOrderId: "9001",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "100",
          quantity: "1",
          executedQuantity: "0",
          status: "NEW",
        }],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.openOrderSnapshots[0].readiness, "RECONCILED")
  assert.equal(result.data.openOrderSnapshots[0].orders.length, 1)
})


test("restores a partially filled canceled order as a paused strategy market", () => {
  const records = [
    submissionRequested(),
    submitted({ status: "PARTIALLY_FILLED" }),
    fill(),
    record("order.cancel_requested", {
      clientOrderId: "h-BTCUSDT-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "1",
      executedQuantity: "0.4",
      status: "PARTIALLY_FILLED",
      reason: "TRAILING_BUY_REPRICE",
    }),
    record("order.cancelled", {
      clientOrderId: "h-BTCUSDT-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "1",
      executedQuantity: "0.4",
      status: "CANCELED",
    }),
  ]
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true)

  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
    quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
  })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.pausedMarkets], ["BTCUSDT"])
  assert.deepEqual([...restored.data.durablePausedMarkets], ["BTCUSDT"])
  assert.deepEqual([...restored.data.recoveryManagedPausedMarkets], [])
  assert.deepEqual([...restored.data.trailingBuyRepriceIntents], [])
  assert.equal(restored.data.orderRegistry.orders[0].status, "CANCELED")
  assert.equal(restored.data.orderRegistry.orders[0].executedQuantity.amount, "0.4")
})


test("rejects a second cancellation intent while the first outcome is unresolved", () => {
  const cancellation = record("order.cancel_requested", {
    clientOrderId: "h-BTCUSDT-1",
    brokerOrderId: "9001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "1",
    executedQuantity: "0",
    status: "OPEN",
    reason: "TRAILING_BUY_REPRICE",
  })
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), submitted(), cancellation, {
      ...cancellation,
      id: "duplicate-cancel-request",
      payload: { ...cancellation.payload, id: "duplicate-cancel-request" },
    }],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /cannot be retried or duplicated/)
})

test("requires a durable cancellation intent before accepting a cancellation failure", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_failed", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        outcome: "NOT_CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /no preceding durable cancellation intent/)
})


test("rejects trading activity journaled after the closing account snapshot", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      submissionRequested(),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /after its closing account snapshot/)
})


test("rejects multiple fully filled SELL orders before one recovery-cycle completion", () => {
  const records = completedCycleRecords()
  records.splice(6, 0,
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-sell-2",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "125.625",
      quantity: "0.1",
      status: "PENDING",
    }),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-sell-2",
      brokerOrderId: "9003",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "125.625",
      quantity: "0.1",
      status: "FILLED",
    }),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-3",
      tradeId: "trade-3",
      brokerOrderId: "9003",
      clientOrderId: "h-BTCUSDT-sell-2",
      symbol: "BTCUSDT",
      side: "SELL",
      price: "125.625",
      quantity: "0.1",
      quoteQuantity: "12.5625",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
    }),
  )

  const result = projectHarvesterJournalRecovery({ records })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Multiple fully filled Harvester SELL orders/)
})


test("rejects account snapshots whose exchange source time moves backwards", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "OPENING",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /sourceTime moved backwards/)
})

test("rejects open-order audit timestamps that move backwards", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 200,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /observedAt moved backwards/)
})


test("rejects a PREFLIGHT balance baseline written after trading activity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances: [{ asset: "BTC", free: "1", locked: "0", total: "1" }],
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /PREFLIGHT account snapshot must precede trading activity/)
})

test("rejects a PREFLIGHT open-order baseline written after trading activity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /PREFLIGHT open-order snapshot must precede trading activity/)
})


const harvesterRecord = (name, data, id = name) => ({
  ...record(name, data, id),
  payload: { id, source: "harvester", name, data },
})

test("projects unowned-order evidence as a sticky safety blocker without a separate pause event", () => {
  const result = projectHarvesterJournalRecovery({
    records: [harvesterRecord("execution.unowned_order", {
      clientOrderId: "external-client",
      brokerOrderId: "external-broker",
      symbol: "BTCUSDT",
      side: "SELL",
      status: "FILLED",
      reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
    })],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.stickySafetyBlockers, [{
    eventName: "execution.unowned_order",
    symbol: "BTCUSDT",
    reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
    clientOrderId: "external-client",
    brokerOrderId: "external-broker",
    sequence: 0,
  }])
  assert.deepEqual(result.data.pausedMarkets, [])
})

test("projects invalid-fill and accounting-failure evidence as sticky blockers without pause events", () => {
  for (const [eventName, data] of [
    ["execution.invalid_fill", {
      clientOrderId: "h-BTCUSDT-1",
      symbol: "BTCUSDT",
      side: "BUY",
      status: "NEW",
      reason: "IDENTITY_MISMATCH",
    }],
    ["execution.accounting_failed", {
      clientOrderId: "h-BTCUSDT-1",
      symbol: "BTCUSDT",
      side: "BUY",
      status: "FILLED",
      fillId: "binance:BTCUSDT:trade-1",
      reason: "FILL_ACCOUNTING",
    }],
  ]) {
    const result = projectHarvesterJournalRecovery({
      records: [harvesterRecord(eventName, data)],
    })

    assert.equal(result.ok, true, eventName + " must be retained as safety evidence")
    assert.equal(result.data.stickySafetyBlockers.length, 1)
    assert.equal(result.data.stickySafetyBlockers[0].eventName, eventName)
    assert.equal(result.data.stickySafetyBlockers[0].symbol, "BTCUSDT")
    assert.equal(result.data.pausedMarkets.length, 0)
  }
})

test("rejects an unknown Harvester event instead of silently skipping potentially stateful evidence", () => {
  const result = projectHarvesterJournalRecovery({
    records: [harvesterRecord("execution.future_safety_event", { symbol: "BTCUSDT" })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unknown Harvester recovery event/)
})

test("ignores unknown events from other sources without treating them as Harvester recovery facts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [{
      ...record("external.future_event", { symbol: "BTCUSDT" }),
      payload: { id: "external.future_event", source: "external", name: "external.future_event", data: { symbol: "BTCUSDT" } },
    }],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.stickySafetyBlockers, [])
})

test("accepts RECOVERY account and open-order snapshots between PREFLIGHT and CLOSING", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "RECOVERY",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "RECOVERY",
        observedAt: 200,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 300,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.accountSnapshots.map(({ phase }) => phase), [
    "PREFLIGHT",
    "RECOVERY",
    "CLOSING",
  ])
  assert.deepEqual(result.data.openOrderSnapshots.map(({ phase }) => phase), [
    "PREFLIGHT",
    "RECOVERY",
  ])
})


test("restores sticky safety blockers into durable and effective market pauses", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [harvesterRecord("execution.unowned_order", {
      clientOrderId: "external-client",
      brokerOrderId: "external-broker",
      symbol: "BTCUSDT",
      side: "SELL",
      status: "FILLED",
      reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
    })],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map(),
  })

  assert.equal(restored.ok, true)
  assert.equal(restored.data.pausedMarkets.has("BTCUSDT"), true)
  assert.equal(restored.data.durablePausedMarkets.has("BTCUSDT"), true)
  assert.equal(restored.data.stickySafetyBlockers.length, 1)
})

test("ignores explicitly classified Harvester diagnostics without treating them as recovery facts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      harvesterRecord("harvester.process_started", { runtimeSessionId: "session-1" }),
      harvesterRecord("broker.connected", { broker: "binance" }),
      harvesterRecord("strategy.decision", { symbol: "BTCUSDT" }),
      harvesterRecord("execution.duplicate_fill", { symbol: "BTCUSDT" }),
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.stickySafetyBlockers, [])
  assert.deepEqual(result.data.orders, [])
})

test("rejects a RECOVERY snapshot that appears before the Journal session starts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [record("account.snapshot_captured", {
      phase: "RECOVERY",
      sourceTime: 100,
      auditStatus: "COMPLETE",
      balances: [],
      auditReasons: [],
    })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /RECOVERY account snapshot requires a started Journal session/)
})

test("rejects a RECOVERY open-order snapshot that appears before the Journal session starts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [record("account.open_orders_captured", {
      phase: "RECOVERY",
      observedAt: 100,
      readiness: "READY",
      orderCount: 0,
      orders: [],
      blockReasons: [],
    })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /RECOVERY open-order snapshot requires a started Journal session/)
})

test("fails closed when an unknown recovery event has no source classification", () => {
  const result = projectHarvesterJournalRecovery({
    records: [record("execution.future_safety_event", { symbol: "BTCUSDT" })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unknown Harvester recovery event/)
})

test("preserves execution safety DTOs through projection and restoration", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const order = new CanonicalOrder({
    clientOrderId: "harvester-client-1",
    brokerOrderId: "broker-order-1",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99.95", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
  })
  const fill = new Fill({
    tradeId: "trade-1",
    brokerOrderId: "broker-order-1",
    clientOrderId: "harvester-client-1",
    market,
    side: "BUY",
    price: new Money({ amount: "99.95", asset: quoteAsset }),
    quantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "49.975", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const facts = [
    ["execution.unowned_order", mapExecutionUnownedOrderData({ order })],
    ["execution.invalid_fill", mapExecutionInvalidFillData({ order, fill, reason: "IDENTITY_MISMATCH" })],
    ["execution.accounting_failed", mapExecutionAccountingFailedData({ order, fill, error: new Error("accounting mismatch") })],
  ]
  const records = facts.map(([name, result]) => {
    assert.equal(result.ok, true)
    return harvesterRecord(name, result.data)
  })
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true)
  assert.deepEqual(projection.data.stickySafetyBlockers.map(({ eventName, symbol }) => [eventName, symbol]), [
    ["execution.unowned_order", "DOGEUSDT"],
    ["execution.invalid_fill", "DOGEUSDT"],
    ["execution.accounting_failed", "DOGEUSDT"],
  ])

  const restored = restoreHarvesterJournalState({ projection, marketMetadata: new Map() })
  assert.equal(restored.ok, true)
  assert.equal(restored.data.pausedMarkets.has("DOGEUSDT"), true)
  assert.equal(restored.data.durablePausedMarkets.has("DOGEUSDT"), true)
  assert.equal(restored.data.stickySafetyBlockers.length, 3)
})

test("fails closed when a fully filled SELL has no explicit recovery-cycle outcome", () => {
  const result = projectHarvesterJournalRecovery({
    records: completedCycleRecords().slice(0, 6),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /fully filled SELL has no explicit recovery-cycle outcome/)
})

test("preserves an explicitly evaluated residual sell-through without resetting the recovery basis", () => {
  const records = completedCycleRecords().slice(0, 6)
  records[3] = record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-sell-1", symbol: "BTCUSDT", side: "SELL", type: "LIMIT",
    price: "102.75", quantity: "0.4", status: "PENDING",
  })
  records[4] = record("order.submitted", {
    clientOrderId: "h-BTCUSDT-sell-1", brokerOrderId: "9002", symbol: "BTCUSDT", side: "SELL",
    type: "LIMIT", price: "102.75", quantity: "0.4", status: "FILLED",
  })
  records[5] = record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-2", tradeId: "trade-2", brokerOrderId: "9002",
    clientOrderId: "h-BTCUSDT-sell-1", symbol: "BTCUSDT", side: "SELL",
    price: "102.75", quantity: "0.4", quoteQuantity: "41.1", liquidityRole: "MAKER",
    commissions: [], commissionStatus: "COMPLETE",
  })
  records.push(harvesterRecord("recovery.cycle_not_completed", {
    symbol: "BTCUSDT", marketId: "binance:BTCUSDT",
    sellOrderClientId: "h-BTCUSDT-sell-1", sellOrderBrokerOrderId: "9002",
    outcome: "CONTINUE_SELL_THROUGH", reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
    realizedNetProfit: "-8.9", activeQuantity: "0.0996", keepQuantity: "0.01", minProfit: "0.01",
  }))

  const result = projectHarvesterJournalRecovery({ records })
  assert.equal(result.ok, true)
  assert.equal(result.data.recoveryCycleEvaluations.length, 1)
  assert.equal(result.data.recoveryCycleEvaluations[0].outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(result.data.recoveryCycleEvaluations[0].sellOrderClientId, "h-BTCUSDT-sell-1")
  assert.deepEqual(result.data.recoveryCycles, [])
  const restored = restoreHarvesterJournalState({
    projection: result,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })
  assert.equal(restored.ok, true)
  const position = restored.data.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0.0996")
  assert.equal(position.freeBaseQuantity.amount, "0")
  assert.equal(position.spent.amount, "50")
  const ledger = restored.data.recoveryLedgers.get(canonicalMarket.id)
  assert.equal(ledger.netSellProceeds, "41.1")
})

test("allows another fully filled SELL only after the prior SELL has an explicit continue-sell-through outcome", () => {
  const records = completedCycleRecords().slice(0, 6)
  records[3] = record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-sell-1", symbol: "BTCUSDT", side: "SELL", type: "LIMIT",
    price: "102.75", quantity: "0.4", status: "PENDING",
  })
  records[4] = record("order.submitted", {
    clientOrderId: "h-BTCUSDT-sell-1", brokerOrderId: "9002", symbol: "BTCUSDT", side: "SELL",
    type: "LIMIT", price: "102.75", quantity: "0.4", status: "FILLED",
  })
  records[5] = record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-2", tradeId: "trade-2", brokerOrderId: "9002",
    clientOrderId: "h-BTCUSDT-sell-1", symbol: "BTCUSDT", side: "SELL",
    price: "102.75", quantity: "0.4", quoteQuantity: "41.1", liquidityRole: "MAKER",
    commissions: [], commissionStatus: "COMPLETE",
  })
  records.push(harvesterRecord("recovery.cycle_not_completed", {
    symbol: "BTCUSDT", marketId: "binance:BTCUSDT",
    sellOrderClientId: "h-BTCUSDT-sell-1", sellOrderBrokerOrderId: "9002",
    outcome: "CONTINUE_SELL_THROUGH", reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
    realizedNetProfit: "-8.9", activeQuantity: "0.0996", keepQuantity: "0.01", minProfit: "0.01",
  }))
  records.push(record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-sell-2", symbol: "BTCUSDT", side: "SELL", type: "LIMIT",
    price: "102.75", quantity: "0.0896", status: "PENDING",
  }))
  records.push(record("order.submitted", {
    clientOrderId: "h-BTCUSDT-sell-2", brokerOrderId: "9003", symbol: "BTCUSDT", side: "SELL",
    type: "LIMIT", price: "102.75", quantity: "0.0896", status: "FILLED",
  }))
  records.push(record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-3", tradeId: "trade-3", brokerOrderId: "9003",
    clientOrderId: "h-BTCUSDT-sell-2", symbol: "BTCUSDT", side: "SELL",
    price: "102.75", quantity: "0.0896", quoteQuantity: "9.2088", liquidityRole: "MAKER",
    commissions: [], commissionStatus: "COMPLETE",
  }))
  records.push(record("recovery.cycle_completed", {
    symbol: "BTCUSDT", marketId: "binance:BTCUSDT", freeQuantity: "0.01",
    keepQuantity: "0.01", minProfit: "0.01", realizedNetProfit: "0.3088",
  }))

  const result = projectHarvesterJournalRecovery({ records })
  assert.equal(result.ok, true)
  assert.equal(result.data.recoveryCycleEvaluations.length, 1)
  assert.equal(result.data.recoveryCycleEvaluations[0].outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(result.data.recoveryCycles.length, 1)
  assert.equal(result.data.recoveryCycles[0].completedOrderClientId, "h-BTCUSDT-sell-2")
})
