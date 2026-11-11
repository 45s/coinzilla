import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { createPendingCanonicalOrder } from "../../../src/domain/orders/create-pending-canonical-order.js"
import { HARVESTER_EVENT_NAMES } from "../../../src/application/events/event-names.js"
import {
  mapExecutionUnownedOrderData,
  mapFillAppliedData,
  mapHarvesterStartedData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapRecoveryCycleCompletedData,
  mapStrategyPausedData,
} from "../../../src/application/events/lifecycle-event-dtos.js"

export const recoveryTestMarket = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
})

const firstSession = "process-001.jsonl"
const secondSession = "process-002.jsonl"

function requireMapped({ mapper, input, eventName, session, lineNumber }) {
  const result = mapper(input)
  if (result?.ok !== true) {
    const detail = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error("Unable to build " + eventName + " fixture: " + (detail || "DTO mapping failed"))
  }
  const id = session + ":" + lineNumber
  return Object.freeze({
    id,
    payload: Object.freeze({
      id,
      name: eventName,
      source: "harvester",
      data: result.data,
    }),
    position: Object.freeze({ fileName: session, lineNumber }),
  })
}

function pendingOrder({ clientOrderId, side, price, quantity }) {
  return createPendingCanonicalOrder({
    order: { symbol: recoveryTestMarket.symbol, side, type: "LIMIT", price, quantity },
    market: recoveryTestMarket,
    clientOrderId,
    supportedOrderTypes: ["LIMIT"],
  })
}

function acknowledgedOrder({
  clientOrderId,
  brokerOrderId,
  side,
  price,
  quantity,
  executedQuantity,
  status,
}) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market: recoveryTestMarket,
    side,
    type: "LIMIT",
    limitPrice: new Money({ amount: price, asset: recoveryTestMarket.quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: recoveryTestMarket.baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: recoveryTestMarket.baseAsset }),
    status,
  })
}

function canonicalFill({
  tradeId,
  brokerOrderId,
  clientOrderId,
  side,
  quantity,
  quoteQuantity,
  baseCommission = "0",
  executedAt,
}) {
  const commissions = baseCommission === "0"
    ? []
    : [new Commission({
      amount: new Money({ amount: baseCommission, asset: recoveryTestMarket.baseAsset }),
    })]
  return new Fill({
    tradeId,
    brokerOrderId,
    clientOrderId,
    market: recoveryTestMarket,
    side,
    price: new Money({ amount: side === "BUY" ? "100" : "103.112", asset: recoveryTestMarket.quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: recoveryTestMarket.baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: recoveryTestMarket.quoteAsset }),
    liquidityRole: "MAKER",
    executedAt,
    commissions,
    commissionStatus: "COMPLETE",
  })
}

/**
 * Build two chronological process-session fixtures from the same canonical
 * values and lifecycle DTO mappers used by production event publication.
 *
 * The fixture intentionally represents the legacy Journal observer envelope.
 * It is not an ADR-0001 durable-fact stream and must not be used as evidence
 * that the current Journal is an authoritative recovery store.
 */
export function createRecoveryCrashFixture() {
  const records = []
  const append = ({ session, mapper, input, eventName }) => {
    const lineNumber = records.filter((record) => record.position.fileName === session).length + 1
    records.push(requireMapped({ mapper, input, eventName, session, lineNumber }))
    return records.length
  }

  append({
    session: firstSession,
    eventName: HARVESTER_EVENT_NAMES.STARTED,
    mapper: mapHarvesterStartedData,
    input: {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: [recoveryTestMarket.symbol],
      tradingEnabled: true,
    },
  })

  const buyClientOrderId = "harvester-BTCUSDT-buy-001"
  const buyIntent = pendingOrder({
    clientOrderId: buyClientOrderId,
    side: "BUY",
    price: "100",
    quantity: "1",
  })
  append({
    session: firstSession,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
    mapper: mapOrderSubmissionRequestedData,
    input: { order: buyIntent },
  })

  append({
    session: firstSession,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
    mapper: mapOrderSubmittedData,
    input: {
      order: acknowledgedOrder({
        clientOrderId: buyClientOrderId,
        brokerOrderId: "9001",
        side: "BUY",
        price: "100",
        quantity: "1",
        executedQuantity: "0.4",
        status: "PARTIALLY_FILLED",
      }),
    },
  })

  const partialBuyFill = canonicalFill({
    tradeId: "buy-trade-001",
    brokerOrderId: "9001",
    clientOrderId: buyClientOrderId,
    side: "BUY",
    quantity: "0.4",
    quoteQuantity: "40",
    baseCommission: "0.0004",
    executedAt: 1_700_000_000_001,
  })
  append({
    session: firstSession,
    eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    mapper: mapFillAppliedData,
    input: { fill: partialBuyFill },
  })

  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.STARTED,
    mapper: mapHarvesterStartedData,
    input: {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: [recoveryTestMarket.symbol],
      tradingEnabled: true,
    },
  })

  const finalBuyFill = canonicalFill({
    tradeId: "buy-trade-002",
    brokerOrderId: "9001",
    clientOrderId: buyClientOrderId,
    side: "BUY",
    quantity: "0.6",
    quoteQuantity: "60",
    baseCommission: "0.0004",
    executedAt: 1_700_000_000_002,
  })
  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    mapper: mapFillAppliedData,
    input: { fill: finalBuyFill },
  })

  const sellClientOrderId = "harvester-BTCUSDT-sell-001"
  const sellIntent = pendingOrder({
    clientOrderId: sellClientOrderId,
    side: "SELL",
    price: "103.112",
    quantity: "0.9892",
  })
  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
    mapper: mapOrderSubmissionRequestedData,
    input: { order: sellIntent },
  })

  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
    mapper: mapOrderSubmittedData,
    input: {
      order: acknowledgedOrder({
        clientOrderId: sellClientOrderId,
        brokerOrderId: "9002",
        side: "SELL",
        price: "103.112",
        quantity: "0.9892",
        executedQuantity: "0.9892",
        status: "FILLED",
      }),
    },
  })

  const sellFill = canonicalFill({
    tradeId: "sell-trade-001",
    brokerOrderId: "9002",
    clientOrderId: sellClientOrderId,
    side: "SELL",
    quantity: "0.9892",
    quoteQuantity: "102",
    executedAt: 1_700_000_000_003,
  })
  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    mapper: mapFillAppliedData,
    input: { fill: sellFill },
  })

  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
    mapper: mapRecoveryCycleCompletedData,
    input: {
      symbol: recoveryTestMarket.symbol,
      marketId: recoveryTestMarket.id,
      freeQuantity: "0.01",
      keepQuantity: "0.01",
      minProfit: "0.01",
      realizedNetProfit: "2",
    },
  })

  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-manual-order-001",
    brokerOrderId: "manual-7001",
    market: recoveryTestMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99", asset: recoveryTestMarket.quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: recoveryTestMarket.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: recoveryTestMarket.baseAsset }),
    status: "OPEN",
  })
  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.EXECUTION_UNOWNED_ORDER,
    mapper: mapExecutionUnownedOrderData,
    input: { order: externalOrder },
  })

  append({
    session: secondSession,
    eventName: HARVESTER_EVENT_NAMES.STRATEGY_PAUSED,
    mapper: mapStrategyPausedData,
    input: {
      symbol: recoveryTestMarket.symbol,
      reason: "UNOWNED_ORDER",
    },
  })

  return Object.freeze({
    market: recoveryTestMarket,
    records: Object.freeze(records),
    checkpoints: Object.freeze({
      afterOrderIntent: 2,
      afterBrokerAcknowledgement: 3,
      afterPartialFillApplied: 4,
      beforeFillAppliedPublication: 3,
      afterFinalBuyFillApplied: 6,
      afterRecoverySellFillApplied: 9,
      afterRecoveryCycleCompletion: 10,
      afterUnownedOrderBlockerPublication: 11,
      afterStrategyPausePublication: 12,
    }),
  })
}
