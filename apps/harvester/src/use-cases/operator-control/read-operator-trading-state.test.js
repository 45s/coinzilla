import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[read-operator-trading-state.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { createReadOperatorTradingState } from "./read-operator-trading-state.js"

const actor = Object.freeze({ id: "telegram-user:12345", roles: Object.freeze(["trading-operator"]) })

function createHarness(overrides = {}) {
  const ownedOrder = {
    brokerOrderId: "101",
    clientOrderId: "h-buy-1",
    market: { symbol: "DOGEUSDT" },
    side: "BUY",
    status: "OPEN",
    limitPrice: { amount: "0.12" },
    originalQuantity: { amount: "10" },
    executedQuantity: { amount: "2" },
  }
  const providers = {
    getPortfolio: () => ({
      positions: [{
        value: {
          market: { id: "doge", symbol: "DOGEUSDT", baseAsset: { code: "DOGE" }, quoteAsset: { code: "USDT" } },
          baseQuantity: { amount: "8" },
          freeBaseQuantity: { amount: "1" },
          totalBaseQuantity: { amount: "9" },
          spent: { amount: "0.96" },
          quoteNetCashFlow: { amount: "-0.96" },
        },
      }],
    }),
    getRecoveryLedger: () => undefined,
    getAccountSnapshot: () => ({
      sourceTime: 900,
      balances: [{
        asset: { code: "USDT" },
        free: { amount: "100" },
        locked: { amount: "10" },
      }],
    }),
    getOpenOrders: async () => ({
      ok: true,
      data: [
        { id: "101", symbol: "DOGEUSDT", side: "BUY", status: "NEW", clientOrderId: "h-buy-1", originalPrice: "0.12", originalQuantity: "10", executedQuantity: "2" },
        { id: "202", symbol: "BTCUSDT", side: "SELL", status: "NEW", clientOrderId: "manual-1", originalPrice: "50000", originalQuantity: "0.1", executedQuantity: "0" },
      ],
    }),
    engine: { getActiveOrders: () => [ownedOrder] },
    getObservedAt: () => 1000,
    ...overrides,
  }
  return createReadOperatorTradingState(providers)
}

test("returns immutable portfolio positions with active and retained inventory separated", async () => {
  const queries = createHarness()
  const result = await queries.getPositions({ actor })
  assert.equal(result.ok, true)
  assert.equal(result.data.positions[0].activeQuantity, "8")
  assert.equal(result.data.positions[0].freeQuantity, "1")
  assert.equal(result.data.positions[0].totalQuantity, "9")
  assert.equal(Object.isFrozen(result.data.positions[0]), true)
})

test("labels Harvester-owned and external open orders without adopting external orders", async () => {
  const queries = createHarness()
  const result = await queries.getOrders({ actor })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.orders.map(({ ownership }) => ownership), ["HARVESTER", "EXTERNAL"])
  assert.equal(result.data.orders[1].clientOrderId, "manual-1")
  assert.equal(Object.isFrozen(result.data.orders), true)
})

test("returns exchange balances with source timestamp and age", async () => {
  const queries = createHarness()
  const result = await queries.getBalances({ actor })
  assert.equal(result.ok, true)
  assert.equal(result.data.sourceTime, 900)
  assert.equal(result.data.ageMs, 100)
  assert.equal(result.data.balances[0].free, "100")
  assert.equal(result.data.balances[0].locked, "10")
})

test("rejects unauthorized reads before invoking any provider", async () => {
  let reads = 0
  const queries = createHarness({
    getPortfolio: () => { reads += 1; return { positions: [] } },
  })
  const result = await queries.getPositions({ actor: { id: "intruder", roles: [] } })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED")
  assert.equal(reads, 0)
})

test("fails closed when the account-wide order snapshot is unavailable", async () => {
  const failure = new Error("exchange snapshot unavailable")
  const queries = createHarness({ getOpenOrders: async () => ({ ok: false, errors: [failure] }) })
  const result = await queries.getOrders({ actor })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "HARVESTER_OPERATOR_ORDERS_READ_FAILED")
  assert.equal(result.errors[0].cause, failure)
})
