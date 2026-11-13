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
  assert.throws(() => new AccountSnapshot({ balances: [], sourceTime: -0 }), /sourceTime/)
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


test("stores immutable snapshot baselines for Portfolio inventory and active order commitments", () => {
  const snapshot = new AccountSnapshot({
    balances: [balance({ asset: btc }), balance({ asset: usdt, free: "900", locked: "100" })],
    sourceTime: 300,
    portfolioBaseQuantityBaseline: [{ assetId: btc.id, amount: "10" }],
    committedQuoteBalanceBaseline: [{ assetId: usdt.id, amount: "100" }],
    committedBaseBalanceBaseline: [{ assetId: btc.id, amount: "3" }],
  })

  assert.equal(snapshot.getPortfolioBaseQuantityBaseline({ assetId: btc.id }), "10", "The account snapshot must remember tracked base inventory already reflected in exchange balances.")
  assert.equal(snapshot.getCommittedQuoteBalanceBaseline({ assetId: usdt.id }), "100", "The snapshot must remember BUY quote reservations already represented by exchange locked balances.")
  assert.equal(snapshot.getCommittedBaseBalanceBaseline({ assetId: btc.id }), "3", "The snapshot must remember SELL base reservations already represented by exchange locked balances.")
  assert.equal(snapshot.getPortfolioBaseQuantityBaseline({ assetId: eth.id }), "0", "An asset with no tracked Position at snapshot time must have a zero inventory baseline.")
  assert.equal(snapshot.getCommittedQuoteBalanceBaseline({ assetId: btc.id }), "0", "An asset without BUY commitments must have a zero quote-commitment baseline.")
  assert.equal(snapshot.getCommittedBaseBalanceBaseline({ assetId: usdt.id }), "0", "An asset without SELL commitments must have a zero base-commitment baseline.")
  assert.throws(
    () => new AccountSnapshot({
      balances: [],
      sourceTime: 1,
      portfolioBaseQuantityBaseline: [
        { assetId: btc.id, amount: "1" },
        { assetId: btc.id, amount: "2" },
      ],
    }),
    /duplicate asset/,
    "Duplicate asset baselines must be rejected rather than silently overwriting snapshot accounting state.",
  )
  assert.throws(
    () => new AccountSnapshot({
      balances: [],
      sourceTime: 1,
      committedQuoteBalanceBaseline: [{ assetId: usdt.id, amount: "-1" }],
    }),
    /non-negative/,
    "Snapshot order commitments cannot be negative because they represent outstanding exchange reservations.",
  )
})

test("tracks Portfolio quote cash flow already reflected in the snapshot", () => {
  const snapshot = new AccountSnapshot({
    balances: [balance({ asset: btc }), balance({ asset: usdt, free: "80" })],
    sourceTime: 200,
    quoteCashFlowBaseline: [
      { assetId: usdt.id, amount: "100" },
      { assetId: btc.id, amount: "-0.25" },
    ],
  })

  assert.equal(snapshot.getQuoteCashFlowBaseline({ assetId: usdt.id }), "100")
  assert.equal(snapshot.getQuoteCashFlowBaseline({ assetId: btc.id }), "-0.25")
  assert.equal(snapshot.getQuoteCashFlowBaseline({ assetId: eth.id }), "0")
  assert.throws(() => new AccountSnapshot({
    balances: [],
    sourceTime: 1,
    quoteCashFlowBaseline: [
      { assetId: usdt.id, amount: "1" },
      { assetId: usdt.id, amount: "2" },
    ],
  }), /duplicate asset/)
})
