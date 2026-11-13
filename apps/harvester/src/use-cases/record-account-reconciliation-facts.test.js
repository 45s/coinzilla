import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import {
  recordAccountOpenOrdersCaptured,
  recordAccountSnapshotCaptured,
} from "./record-account-reconciliation-facts.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-account-recorders-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "account-recorder-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The recorder fixture must explicitly initialize its isolated ledger.")
  return store
}

const balances = (overrides = {}) => ({
  phase: "PREFLIGHT",
  auditStatus: "COMPLETE",
  sourceTime: 1_700_000_000_000,
  assetCount: 2,
  balances: [
    { asset: "BTC", free: "0.1", locked: "0", total: "0.1" },
    { asset: "USDT", free: "100", locked: "5", total: "105" },
  ],
  auditReasons: [],
  ...overrides,
})

const openOrders = (overrides = {}) => ({
  phase: "PREFLIGHT",
  observedAt: 1_700_000_000_001,
  readiness: "BLOCKED",
  orderCount: 1,
  orders: [{
    brokerOrderId: "manual-order-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "65000",
    quantity: "0.01",
    executedQuantity: "0",
    status: "OPEN",
  }],
  blockReasons: ["UNOWNED_OPEN_ORDERS"],
  ...overrides,
})

test("records complete account snapshots with deterministic idempotent identities", async (t) => {
  const durableFactsStore = await createStore(t)
  const first = await recordAccountSnapshotCaptured({ durableFactsStore, data: balances() })
  const duplicate = await recordAccountSnapshotCaptured({ durableFactsStore, data: balances() })

  assert.equal(first.ok, true, first.errors?.map(({ message }) => message).join("; "))
  assert.equal(first.data.durable, true, "The account balance snapshot must be committed before reconciliation consumes it.")
  assert.equal(first.data.record.factType, "ACCOUNT_SNAPSHOT_CAPTURED")
  assert.equal(duplicate.ok, true, "Retrying the same source snapshot must be safe.")
  assert.equal(duplicate.data.duplicate, true, "An exact retry must resolve to the existing immutable fact.")
  assert.equal(duplicate.data.record.factId, first.data.record.factId, "The same phase/source/assets must produce one stable fact identity.")
})

test("rejects a conflicting account snapshot that reuses the same phase and source timestamp", async (t) => {
  const durableFactsStore = await createStore(t)
  const first = await recordAccountSnapshotCaptured({ durableFactsStore, data: balances() })
  const conflict = await recordAccountSnapshotCaptured({
    durableFactsStore,
    data: balances({
      balances: [
        { asset: "BTC", free: "0.2", locked: "0", total: "0.2" },
        { asset: "USDT", free: "100", locked: "5", total: "105" },
      ],
    }),
  })

  assert.equal(first.ok, true, "The initial canonical account snapshot must be accepted.")
  assert.equal(conflict.ok, false, "Changed balance evidence cannot overwrite the same immutable phase/source identity.")
})

test("records blocked account-wide open orders without fabricating external ownership", async (t) => {
  const durableFactsStore = await createStore(t)
  const result = await recordAccountOpenOrdersCaptured({ durableFactsStore, data: openOrders() })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true, "The external-order observation must be committed before readiness is evaluated.")
  assert.equal(result.data.record.factType, "ACCOUNT_OPEN_ORDERS_CAPTURED")
  assert.equal(result.data.record.data.readiness, "BLOCKED")
  assert.equal(result.data.record.data.orders[0].clientOrderId, undefined, "External orders must remain without a fabricated Harvester client identity.")
})

test("rejects a conflicting open-order snapshot that reuses the same phase and observation timestamp", async (t) => {
  const durableFactsStore = await createStore(t)
  const first = await recordAccountOpenOrdersCaptured({ durableFactsStore, data: openOrders() })
  const conflict = await recordAccountOpenOrdersCaptured({
    durableFactsStore,
    data: openOrders({
      orders: [{ ...openOrders().orders[0], price: "65100" }],
    }),
  })

  assert.equal(first.ok, true, "The initial account-wide open-order snapshot must be accepted.")
  assert.equal(conflict.ok, false, "Changed open-order evidence cannot reuse the same immutable phase/observation identity.")
})

test("does not initialize a missing durable-fact store", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-account-recorders-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const durableFactsStore = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "account-recorder-test-session",
  })
  const result = await recordAccountSnapshotCaptured({ durableFactsStore, data: balances() })

  assert.equal(result.ok, false, "A recorder must never create or initialize a missing production fact ledger.")
})


test("rejects negative-zero account snapshot and open-order timestamps before append", async () => {
  const appendCalls = []
  const durableFactsStore = {
    append: async (fact) => {
      appendCalls.push(fact)
      return { ok: true, data: { durable: true } }
    },
  }

  const snapshot = await recordAccountSnapshotCaptured({
    durableFactsStore,
    data: balances({ sourceTime: -0 }),
  })
  const openOrdersResult = await recordAccountOpenOrdersCaptured({
    durableFactsStore,
    data: openOrders({ observedAt: -0 }),
  })

  assert.equal(snapshot.ok, false)
  assert.equal(openOrdersResult.ok, false)
  assert.equal(appendCalls.length, 0, "Non-canonical timestamps must be rejected before reaching durable persistence.")
})
