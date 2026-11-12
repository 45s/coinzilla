import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "./create-file-durable-facts-store.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-account-facts-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "account-facts-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The account-fact fixture must explicitly initialize its isolated test ledger.")
  return store
}

const balanceSnapshot = (overrides = {}) => ({
  factId: "account-snapshot:RECOVERY:1700000000000",
  factType: "ACCOUNT_SNAPSHOT_CAPTURED",
  data: {
    phase: "RECOVERY",
    auditStatus: "COMPLETE",
    sourceTime: 1_700_000_000_000,
    assetCount: 2,
    balances: [
      { asset: "BTC", free: "0.1000", locked: "0.0200", total: "0.1200" },
      { asset: "USDT", free: "100.00", locked: "25.00", total: "125.00" },
    ],
    auditReasons: [],
  },
  ...overrides,
})

const openOrdersSnapshot = (overrides = {}) => ({
  factId: "account-open-orders:RECOVERY:1700000000000",
  factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
  data: {
    phase: "RECOVERY",
    observedAt: 1_700_000_000_000,
    readiness: "RECONCILED",
    orderCount: 1,
    orders: [{
      clientOrderId: "harvester-buy-1",
      brokerOrderId: "exchange-order-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "65000.00",
      quantity: "0.0100",
      executedQuantity: "0.0020",
      status: "PARTIALLY_FILLED",
    }],
    blockReasons: [],
  },
  ...overrides,
})

test("accepts complete exact-decimal balance and account-wide open-order snapshots", async (t) => {
  const store = await createStore(t)
  const balances = await store.append(balanceSnapshot())
  const orders = await store.append(openOrdersSnapshot())

  assert.equal(balances.ok, true, "A complete balance snapshot with exact free/locked/total values must be accepted.")
  assert.equal(balances.data.durable, true, "The balance snapshot must be committed before it can be used for recovery.")
  assert.equal(orders.ok, true, "A reconciled account-wide open-order snapshot must be accepted.")
  assert.equal(orders.data.durable, true, "The open-order snapshot must be durably committed.")
  const read = await store.readAll()
  assert.equal(read.ok, true, "The committed account snapshots must remain readable after append.")
  assert.deepEqual(
    read.data.records.slice(-2).map(({ factType }) => factType),
    ["ACCOUNT_SNAPSHOT_CAPTURED", "ACCOUNT_OPEN_ORDERS_CAPTURED"],
    "The verified stream must retain both reconciliation evidence types in append order.",
  )
})

test("rejects balance snapshots with incomplete or contradictory exact accounting", async (t) => {
  const store = await createStore(t)
  const invalidFacts = [
    balanceSnapshot({ factId: "account-snapshot:bad-total", data: {
      ...balanceSnapshot().data,
      balances: [{ asset: "BTC", free: "0.1", locked: "0.02", total: "0.11" }, { asset: "USDT", free: "100", locked: "25", total: "125" }],
    } }),
    balanceSnapshot({ factId: "account-snapshot:duplicate-asset", data: {
      ...balanceSnapshot().data,
      balances: [
        { asset: "BTC", free: "0.1", locked: "0", total: "0.1" },
        { asset: "BTC", free: "0.2", locked: "0", total: "0.2" },
      ],
    } }),
    balanceSnapshot({ factId: "account-snapshot:wrong-count", data: {
      ...balanceSnapshot().data,
      assetCount: 1,
    } }),
    balanceSnapshot({ factId: "account-snapshot:complete-with-reason", data: {
      ...balanceSnapshot().data,
      auditReasons: ["BALANCE_SOURCE_INCOMPLETE"],
    } }),
    balanceSnapshot({ factId: "account-snapshot:incomplete-without-reason", data: {
      ...balanceSnapshot().data,
      auditStatus: "INCOMPLETE",
    } }),
    balanceSnapshot({ factId: "account-snapshot:decimal-number", data: {
      ...balanceSnapshot().data,
      balances: [
        { asset: "BTC", free: 0.1, locked: "0.02", total: "0.12" },
        { asset: "USDT", free: "100", locked: "25", total: "125" },
      ],
    } }),
  ]

  for (const fact of invalidFacts) {
    const result = await store.append(fact)
    assert.equal(
      result.ok,
      false,
      "Malformed balance snapshot " + fact.factId + " must be rejected instead of becoming recovery evidence.",
    )
  }
})

test("rejects open-order snapshots whose count, identity, state, or readiness contradicts their contents", async (t) => {
  const store = await createStore(t)
  const validOrder = openOrdersSnapshot().data.orders[0]
  const invalidFacts = [
    openOrdersSnapshot({ factId: "open-orders:wrong-count", data: {
      ...openOrdersSnapshot().data,
      orderCount: 0,
    } }),
    openOrdersSnapshot({ factId: "open-orders:duplicate-identity", data: {
      ...openOrdersSnapshot().data,
      orderCount: 2,
      orders: [validOrder, { ...validOrder, clientOrderId: "another-client-id" }],
    } }),
    openOrdersSnapshot({ factId: "open-orders:ready-with-orders", data: {
      ...openOrdersSnapshot().data,
      readiness: "READY",
    } }),
    openOrdersSnapshot({ factId: "open-orders:blocked-without-reason", data: {
      ...openOrdersSnapshot().data,
      readiness: "BLOCKED",
    } }),
    openOrdersSnapshot({ factId: "open-orders:terminal-order", data: {
      ...openOrdersSnapshot().data,
      orders: [{ ...validOrder, status: "FILLED" }],
    } }),
    openOrdersSnapshot({ factId: "open-orders:over-executed", data: {
      ...openOrdersSnapshot().data,
      orders: [{ ...validOrder, executedQuantity: "0.0200" }],
    } }),
  ]

  for (const fact of invalidFacts) {
    const result = await store.append(fact)
    assert.equal(
      result.ok,
      false,
      "Contradictory account-wide open-order snapshot " + fact.factId + " must fail closed.",
    )
  }
})

test("accepts an explicitly blocked open-order snapshot without treating it as an empty account", async (t) => {
  const store = await createStore(t)
  const fact = openOrdersSnapshot({
    factId: "account-open-orders:PREFLIGHT:blocked-1",
    data: {
      phase: "PREFLIGHT",
      observedAt: 1_700_000_000_001,
      readiness: "BLOCKED",
      orderCount: 1,
      orders: [{
        brokerOrderId: "manual-order-1",
        symbol: "ETHUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "3500",
        quantity: "0.5",
        executedQuantity: "0",
        status: "OPEN",
      }],
      blockReasons: ["UNOWNED_OPEN_ORDERS"],
    },
  })
  const result = await store.append(fact)

  assert.equal(result.ok, true, "An explicitly blocked snapshot with the external order evidence must be retained.")
  assert.equal(result.data.record.data.readiness, "BLOCKED", "The durable fact must preserve the blocked classification.")
  assert.equal(result.data.record.data.orders[0].clientOrderId, undefined, "An external order must not acquire a fabricated Harvester client identity.")
})
