import assert from "node:assert/strict"
import test from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
  const rpc = createFakeRpcClient(handlers)
  broker.tradingConnection = rpc
  return { broker, rpc }
}

test("getServerTime returns exact exchange server milliseconds from the unsigned time method", async () => {
  const { broker, rpc } = createBroker({
    time: () => ({ serverTime: 1_700_000_000_123 }),
  })

  const result = await broker.getServerTime()

  assert.deepEqual(result.data, { serverTime: 1_700_000_000_123 })
  assert.deepEqual(rpc.calls, [{
    method: "time",
    params: {},
    options: {},
  }])
})

test("getServerTime rejects missing or unsafe server timestamps", async () => {
  for (const serverTime of [undefined, -1, Number.MAX_SAFE_INTEGER + 1, "1700000000000"]) {
    const { broker } = createBroker({
      time: () => ({ serverTime }),
    })
    const result = await broker.getServerTime()
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
})

test("getAccountSnapshot returns canonical balances and account source updateTime", async () => {
  const { broker, rpc } = createBroker({
    "account.status": () => ({
      updateTime: 1_700_000_000_123,
      balances: [
        { asset: "USDT", free: "10.25000000", locked: "1.75000000" },
        { asset: "DOGE", free: "100.00000000", locked: "0.00000000" },
      ],
    }),
  })

  const result = await broker.getAccountSnapshot()

  assert.equal(result.ok, true)
  assert.equal(result.data.sourceTime, 1_700_000_000_123)
  assert.equal(result.data.balances.length, 2)
  assert.equal(result.data.balances[0].asset.code, "USDT")
  assert.equal(result.data.balances[0].free.amount, "10.25")
  assert.equal(result.data.balances[0].locked.amount, "1.75")
  assert.equal(result.data.balances[0].total.amount, "12")
  assert.deepEqual(rpc.calls, [{
    method: "account.status",
    params: { omitZeroBalances: false },
    options: { signed: true },
  }])
})

test("getAccountSnapshot fails closed when account source updateTime is missing or invalid", async () => {
  for (const updateTime of [undefined, -1, Number.MAX_SAFE_INTEGER + 1, "1700000000000"]) {
    const { broker } = createBroker({
      "account.status": () => ({
        updateTime,
        balances: [],
      }),
    })
    const result = await broker.getAccountSnapshot()
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
})
