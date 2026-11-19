import assert from "node:assert/strict"
import test from "node:test"
import { Asset } from "../assets/asset.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import { CanonicalOrder } from "./canonical-order.js"

const baseAsset = new Asset({
  id: "DOGE",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})
const baseOrder = {
  clientOrderId: "client-1",
  market,
  side: "BUY",
  type: "LIMIT",
  limitPrice: new Money({
    amount: "0.1",
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
  status: "PENDING",
}

test("keeps legacy orders readable and requires complete provider provenance when supplied", () => {
  const legacy = new CanonicalOrder(baseOrder)
  assert.equal(legacy.providerInstanceId, undefined)
  assert.throws(() => new CanonicalOrder({
    ...baseOrder,
    providerInstanceId: "binanceTestnet",
  }), /requires all three stable identifiers/)
  const attributed = new CanonicalOrder({
    ...baseOrder,
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  })
  assert.deepEqual([
    attributed.providerInstanceId,
    attributed.providerType,
    attributed.accountId,
  ], ["binanceTestnet", "binance", "binance-primary"])
})
