import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { Market } from "@coinzilla/entities"
import { AccountSnapshot } from "./account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "./assert-account-snapshot-covers-markets.js"

const btc = new Asset({ id: "btc", code: "BTC" })
const usdt = new Asset({ id: "usdt", code: "USDT" })
const eth = new Asset({ id: "eth", code: "ETH" })
const balance = ({ asset, free = "0", locked = "0" }) => new Balance({
  free: new Quantity({ amount: free, asset }),
  locked: new Quantity({ amount: locked, asset }),
})
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: btc,
  quoteAsset: usdt,
})

test("stores canonical balances by asset and preserves the source timestamp", () => {
  const snapshot = new AccountSnapshot({
    balances: [
      balance({ asset: btc, free: "0.25", locked: "0.05" }),
      balance({ asset: usdt, free: "1000.50" }),
    ],
    sourceTime: 123456,
  })

  assert.equal(snapshot.sourceTime, 123456)
  assert.equal(snapshot.getFreeBalance({ assetId: btc.id }).amount, "0.25")
  assert.equal(snapshot.getLockedBalance({ assetId: btc.id }).amount, "0.05")
  assert.equal(snapshot.getBalance({ assetId: usdt.id }).total.amount, "1000.5")
  assert.equal(snapshot.getBalance({ assetId: "missing" }), undefined)
  assert.deepEqual(snapshot.value.balances.length, 2)
})

test("accepts zero free balances and does not adopt wallet inventory into a Position", () => {
  const snapshot = new AccountSnapshot({
    balances: [
      balance({ asset: btc, free: "0", locked: "0" }),
      balance({ asset: usdt, free: "0", locked: "0" }),
    ],
    sourceTime: 1,
  })

  assert.equal(snapshot.getFreeBalance({ assetId: btc.id }).amount, "0")
  assert.equal(snapshot.getFreeBalance({ assetId: usdt.id }).amount, "0")
})

test("rejects invalid snapshots, duplicate assets, and negative balances", () => {
  assert.throws(() => new AccountSnapshot({ balances: [], sourceTime: -1 }), /sourceTime/)
  assert.throws(() => new AccountSnapshot({ balances: [null], sourceTime: 1 }), /canonical Balance/)
  assert.throws(() => new AccountSnapshot({
    balances: [balance({ asset: btc }), balance({ asset: btc })],
    sourceTime: 1,
  }), /duplicate asset/)
  assert.throws(() => new AccountSnapshot({
    balances: [balance({ asset: btc, free: "-1" })],
    sourceTime: 1,
  }), /Quantity.amount must be non-negative/)
})

test("requires explicit balances for both assets of every enabled market", () => {
  const complete = new AccountSnapshot({
    balances: [balance({ asset: btc }), balance({ asset: usdt })],
    sourceTime: 1,
  })
  assert.equal(assertAccountSnapshotCoversMarkets({
    accountSnapshot: complete,
    markets: [market],
  }).valid, true)

  const incomplete = new AccountSnapshot({
    balances: [balance({ asset: btc })],
    sourceTime: 1,
  })
  assert.throws(
    () => assertAccountSnapshotCoversMarkets({
      accountSnapshot: incomplete,
      markets: [market],
    }),
    /missing required market asset balances: USDT/,
  )
})

test("reports each missing asset only once across markets", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: eth,
    quoteAsset: usdt,
  })
  const snapshot = new AccountSnapshot({
    balances: [balance({ asset: btc })],
    sourceTime: 1,
  })

  assert.throws(
    () => assertAccountSnapshotCoversMarkets({
      accountSnapshot: snapshot,
      markets: [market, otherMarket],
    }),
    /USDT, ETH/,
  )
})
