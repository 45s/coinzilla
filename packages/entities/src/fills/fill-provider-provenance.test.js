import assert from "node:assert/strict"
import test from "node:test"
import { Asset } from "../assets/asset.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import { Fill } from "./fill.js"

const baseAsset = new Asset({ id: "DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const baseFill = {
  tradeId: "trade-1",
  brokerOrderId: "broker-1",
  clientOrderId: "client-1",
  market,
  side: "BUY",
  price: new Money({ amount: "0.1", asset: quoteAsset }),
  quantity: new Quantity({ amount: "1", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "0.1", asset: quoteAsset }),
  liquidityRole: "MAKER",
  commissionStatus: "UNKNOWN",
  commissions: [],
}

test("keeps legacy fills readable and requires complete provider provenance when supplied", () => {
  const legacy = new Fill(baseFill)
  assert.equal(legacy.providerInstanceId, undefined)
  assert.throws(() => new Fill({
    ...baseFill,
    providerInstanceId: "binanceTestnet",
  }), /requires all three stable identifiers/)
  const attributed = new Fill({
    ...baseFill,
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
