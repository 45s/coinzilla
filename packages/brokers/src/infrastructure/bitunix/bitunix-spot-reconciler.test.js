import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotReconciler } from "./bitunix-spot-reconciler.js"

function createBroker({ fail = null } = {}) {
  const calls = []
  const read = ({ name, data }) => async (input) => {
    calls.push({
      name,
      input,
    })
    if (fail === name) {
      return {
        ok: false,
        errors: [new Error("read failed")],
      }
    }
    return {
      ok: true,
      data,
    }
  }
  return {
    calls,
    broker: {
      getBalances: read({
        name: "balances",
        data: [{ asset: "USDT", free: "10" }],
      }),
      getOpenOrders: read({
        name: "openOrders",
        data: [],
      }),
      getOrderHistory: read({
        name: "history",
        data: [],
      }),
      getMatchingOrderDetails: read({
        name: "matching",
        data: { id: "raw-id", volume: "10" },
      }),
    },
  }
}

test("pollOnce publishes an observed snapshot without inventing source time or canonical fills", async () => {
  const { broker, calls } = createBroker()
  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => 1234,
  })
  const result = await reconciler.pollOnce({
    symbols: ["btcusdt"],
    trackedOrders: [{ symbol: "BTCUSDT", orderId: "order-1" }],
  })
  assert.equal(result.snapshot.observedAt, 1234)
  assert.equal(result.snapshot.sourceTime, null)
  assert.equal(result.snapshot.mode, "POLLING")
  assert.equal(result.snapshot.guarantees.fillsCanonical, false)
  assert.equal(result.snapshot.matchingOrderObservations[0].interpretation, "EXCHANGE_NATIVE_UNVERIFIED")
  assert.equal(calls.length, 4)
  assert.equal(result.snapshot.symbols[0].historyCoverage, "FIRST_PAGE_ONLY")
})

test("pollOnce rejects failed reads and never publishes a partial snapshot", async () => {
  const { broker } = createBroker({
    fail: "history",
  })
  const reconciler = new BitunixSpotReconciler({ broker })
  await assert.rejects(reconciler.pollOnce({ symbols: ["BTCUSDT"] }), /order history.*failed/)
  assert.equal(reconciler.getStatus().lastSuccessAt, null)
})

test("pollOnce rejects missing or duplicate symbol scope before I/O", async () => {
  const { broker, calls } = createBroker()
  const reconciler = new BitunixSpotReconciler({ broker })
  await assert.rejects(reconciler.pollOnce({ symbols: [] }), /at least one explicit symbol/)
  await assert.rejects(reconciler.pollOnce({ symbols: ["BTCUSDT", "btcusdt"] }), /unique/)
  assert.equal(calls.length, 0)
})

test("pollOnce deduplicates unchanged observations", async () => {
  const { broker } = createBroker()
  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => 1234,
  })
  const first = await reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  const second = await reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
})

test("pollOnce coalesces concurrent cycles into one in-flight read", async () => {
  let release
  let count = 0
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const { broker } = createBroker()
  const original = broker.getBalances
  broker.getBalances = async () => {
    count += 1
    await wait
    return original()
  }
  const reconciler = new BitunixSpotReconciler({ broker })
  const first = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  const second = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a, b)
  assert.equal(count, 1)
})

test("pollOnce invalidates in-flight observations when stopped", async () => {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const { broker } = createBroker()
  const original = broker.getBalances
  broker.getBalances = async () => {
    await wait
    return original()
  }
  const reconciler = new BitunixSpotReconciler({ broker })
  const pending = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  reconciler.stop()
  release()
  await assert.rejects(pending, /invalidated by stop/)
})

test("pollOnce rejects a concurrent request with a different symbol scope", async () => {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const { broker } = createBroker()
  const original = broker.getBalances
  broker.getBalances = async () => {
    await wait
    return original()
  }
  const reconciler = new BitunixSpotReconciler({ broker })
  const pending = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  await assert.rejects(reconciler.pollOnce({ symbols: ["ETHUSDT"] }), /different scope/)
  release()
  await pending
})

test("stop fences an in-flight manual poll even when the scheduler was never started", async () => {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const { broker } = createBroker()
  const original = broker.getBalances
  broker.getBalances = async () => {
    await wait
    return original()
  }
  const reconciler = new BitunixSpotReconciler({ broker })
  const pending = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  reconciler.stop()
  release()
  await assert.rejects(pending, /invalidated by stop/)
})

test("start publishes the first observation, reports status and stops scheduling", async () => {
  const { broker, calls } = createBroker()
  let scheduled
  let snapshots = 0
  let statuses = 0
  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => 1000,
    schedule: ({ callback }) => {
      scheduled = callback
      return 1
    },
    cancel: () => {
      scheduled = null
    },
  })
  const session = reconciler.start({
    symbols: ["BTCUSDT"],
    intervalMs: 500,
    onSnapshot: () => {
      snapshots += 1
    },
    onStatus: () => {
      statuses += 1
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(snapshots, 1)
  assert.equal(statuses, 1)
  assert.equal(typeof scheduled, "function")
  session.stop()
  assert.equal(scheduled, null)
  const requestCount = calls.length
  assert.equal(reconciler.getStatus().running, false)
  assert.equal(requestCount, 3)
})

test("start retries a snapshot after callback failure and backs off the failed cycle", async () => {
  const { broker } = createBroker()
  const scheduled = []
  let snapshots = 0
  let errors = 0
  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => 1000,
    schedule: ({ callback, delay }) => {
      scheduled.push({
        callback,
        delay,
      })
      return scheduled.length
    },
    cancel: () => {},
  })
  const session = reconciler.start({
    symbols: ["BTCUSDT"],
    intervalMs: 500,
    onSnapshot: () => {
      snapshots += 1
      if (snapshots === 1) {
        throw new Error("consumer unavailable")
      }
    },
    onError: () => {
      errors += 1
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(errors, 1)
  assert.equal(scheduled[0].delay, 1000)
  scheduled[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(snapshots, 2)
  assert.equal(scheduled[1].delay, 500)
  session.stop()
})
