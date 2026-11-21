import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { OrderRegistry } from "./order-registry.js"

const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const dogeMarket = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset: new Asset({
    id: "doge",
    code: "DOGE",
  }),
  quoteAsset,
})
const zroMarket = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset: new Asset({
    id: "zro",
    code: "ZRO",
  }),
  quoteAsset,
})

function makeOrder({ market, clientOrderId, brokerOrderId, status = "OPEN" }) {
  const { baseAsset } = market
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "1",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "10",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 2,
    ...(status === "CANCELED" ? { completedAt: 3 } : {}),
  })
}

test("allows broker order IDs to collide across different markets", () => {
  const registry = new OrderRegistry({
    orders: [
      makeOrder({
        market: dogeMarket,
        clientOrderId: "h-doge-1",
        brokerOrderId: "12345",
      }),
      makeOrder({
        market: zroMarket,
        clientOrderId: "h-zro-1",
        brokerOrderId: "12345",
      }),
    ],
  })

  assert.equal(
    registry.orders.length,
    2,
    "Orders from separate markets must coexist even when the exchange reuses a market-scoped broker order ID.",
  )
  assert.deepEqual(
    registry.orders.map(({ market: orderMarket, brokerOrderId }) => [orderMarket.symbol, brokerOrderId]),
    [["DOGEUSDT", "12345"], ["ZROUSDT", "12345"]],
    "The registry must preserve both market-scoped exchange identities without conflating orders.",
  )
})

test("matches broker order updates by market when IDs collide across markets", () => {
  const dogeOrder = makeOrder({
    market: dogeMarket,
    clientOrderId: "h-doge-1",
    brokerOrderId: "12345",
  })
  const zroOrder = makeOrder({
    market: zroMarket,
    clientOrderId: "h-zro-1",
    brokerOrderId: "12345",
  })
  const registry = new OrderRegistry({
    orders: [dogeOrder, zroOrder],
  })
  const zroCanceledReport = makeOrder({
    market: zroMarket,
    clientOrderId: "exchange-generated-zro-client-id",
    brokerOrderId: "12345",
    status: "CANCELED",
  })

  const result = registry.applyUpdate({
    order: zroCanceledReport,
  })

  assert.equal(result.applied, true)
  assert.equal(result.unknown, false)
  assert.equal(
    result.registry.getOrder({ clientOrderId: "h-doge-1" }).status,
    "OPEN",
    "A same-ID report from another market must not change the DOGE order.",
  )
  assert.equal(
    result.registry.getOrder({ clientOrderId: "h-zro-1" }).status,
    "CANCELED",
    "The report must update the canonical order from the matching market.",
  )
})
