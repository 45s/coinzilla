import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotReconciler } from "./reconciler.js"

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
        data: [{
          asset: "USDT",
          free: "10",
        }],
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
        data: {
          id: "raw-id",
          volume: "10",
        },
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
    trackedOrders: [{
      symbol: "BTCUSDT",
      orderId: "order-1",
    }],
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
  const { broker, calls } = createBroker()
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
  assert.equal(calls.length, 1, "stop must prevent subsequent endpoint reads")
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
  const { broker, calls } = createBroker()
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
  assert.equal(calls.length, 1, "stop must prevent subsequent endpoint reads")
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

test("stop remains idempotent when scheduler cancellation throws", async () => {
  const { broker } = createBroker()
  let cancellationCalls = 0
  const reconciler = new BitunixSpotReconciler({
    broker,
    schedule: () => 1,
    cancel: () => {
      cancellationCalls += 1
      throw new Error("timer cancellation failed")
    },
  })
  const session = reconciler.start({
    symbols: ["BTCUSDT"],
    intervalMs: 500,
    onSnapshot: () => {},
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.throws(() => session.stop(), /timer cancellation failed/, "the first stop must surface a scheduler cleanup failure")
  assert.equal(session.getStatus().running, false, "a failed timer cancellation must not restore the stopped polling session")
  assert.doesNotThrow(() => session.stop(), "repeating stop after cleanup failure must remain safe and idempotent")
  assert.equal(cancellationCalls, 1, "the failed timer handle must not be cancelled repeatedly after local cleanup")
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
    cancel: () => undefined,
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


test("start republishes a full snapshot after a failed polling cycle", async () => {
  const { broker } = createBroker()
  const originalGetOrderHistory = broker.getOrderHistory
  let historyCalls = 0
  broker.getOrderHistory = async (input) => {
    historyCalls += 1
    if (historyCalls === 2) {
      return {
        ok: false,
        errors: [new Error("temporary read failure")],
      }
    }
    return originalGetOrderHistory(input)
  }
  const scheduled = []
  const snapshots = []
  let errors = 0
  const reconciler = new BitunixSpotReconciler({
    broker,
    schedule: ({ callback, delay }) => {
      scheduled.push({
        callback,
        delay,
      })
      return scheduled.length
    },
    cancel: () => undefined,
  })
  const session = reconciler.start({
    symbols: ["BTCUSDT"],
    intervalMs: 500,
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot)
    },
    onError: () => {
      errors += 1
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(snapshots.length, 1, "the first successful poll must publish one complete observation")
  assert.equal(scheduled.length, 1, "the first completed poll must schedule exactly one next cycle")
  scheduled[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(errors, 1, "a failed read cycle must report its failure to the error callback")
  assert.equal(snapshots.length, 1, "a failed read cycle must not publish a partial observation")
  assert.equal(scheduled[1].delay, 1000, "the first failed cycle must apply the configured exponential backoff")
  scheduled[1].callback()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(snapshots.length, 2, "recovery must republish even an unchanged full observation")
  assert.deepEqual(snapshots[1].balances, snapshots[0].balances, "recovery must contain unchanged balance data when exchange state is unchanged")
  assert.deepEqual(snapshots[1].symbols, snapshots[0].symbols, "recovery must contain unchanged symbol data when exchange state is unchanged")
  assert.equal(scheduled[2].delay, 500, "a successful recovery cycle must reset the polling delay to its base interval")
  session.stop()
})

test("pollOnce deduplicates identical exchange data when local observation time advances", async () => {
  const { broker } = createBroker()
  let now = 1234
  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => now,
  })

  const first = await reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  now += 2_000
  const second = await reconciler.pollOnce({ symbols: ["BTCUSDT"] })

  assert.equal(first.snapshot.observedAt, 1234)
  assert.equal(second.snapshot.observedAt, 3234)
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.equal(second.status.lastSuccessAt, 3234)
})

test("start rejects tracked orders outside its polling symbol scope before scheduling", () => {
  const { broker, calls } = createBroker()
  let scheduleCount = 0
  const reconciler = new BitunixSpotReconciler({
    broker,
    schedule: () => {
      scheduleCount += 1
      return 1
    },
  })

  assert.throws(() => reconciler.start({
    symbols: ["BTCUSDT"],
    trackedOrders: [{
      symbol: "ETHUSDT",
      orderId: "order-1",
    }],
    onSnapshot: () => {},
  }), /Tracked order symbol ETHUSDT is not in polling symbols/)
  assert.equal(calls.length, 0)
  assert.equal(scheduleCount, 0)
  assert.equal(reconciler.getStatus().running, false)
})



function createNestedObservationSources() {
  return {
    balance: {
      asset: "USDT",
      free: "10",
      metadata: {
        labels: ["spot"],
      },
    },
    order: {
      orderId: "order-1",
      status: "FILLED",
      execution: {
        fees: [{
          asset: "USDT",
          amount: "0.1",
        }],
      },
    },
    history: {
      orderId: "order-2",
      details: {
        tags: ["history"],
      },
    },
    matching: {
      id: "raw-id",
      execution: {
        fills: [{
          quantity: "1",
        }],
      },
    },
  }
}

test("pollOnce deep-freezes an isolated observation snapshot", async () => {
  const { broker } = createBroker()
  const sources = createNestedObservationSources()
  broker.getBalances = async () => ({
    ok: true,
    data: [sources.balance],
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [sources.order],
  })
  broker.getOrderHistory = async () => ({
    ok: true,
    data: [sources.history],
  })
  broker.getMatchingOrderDetails = async () => ({
    ok: true,
    data: sources.matching,
  })

  const reconciler = new BitunixSpotReconciler({
    broker,
    now: () => 1234,
  })
  const { snapshot } = await reconciler.pollOnce({
    symbols: ["BTCUSDT"],
    trackedOrders: [{
      symbol: "BTCUSDT",
      orderId: "order-3",
    }],
  })

  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.balances), true)
  assert.equal(Object.isFrozen(snapshot.balances[0].metadata.labels), true)
  assert.equal(Object.isFrozen(snapshot.symbols[0]), true)
  assert.equal(Object.isFrozen(snapshot.symbols[0].openOrders[0].execution.fees[0]), true)
  assert.equal(Object.isFrozen(snapshot.symbols[0].firstHistoryPage[0].details.tags), true)
  assert.equal(Object.isFrozen(snapshot.matchingOrderObservations[0].data.execution.fills[0]), true)
  assert.equal(Object.isFrozen(snapshot.guarantees), true)

  for (const source of Object.values(sources)) {
    assert.equal(Object.isFrozen(source), false)
  }
  sources.balance.metadata.labels.push("mutated")
  sources.order.execution.fees[0].amount = "9"
  sources.history.details.tags[0] = "mutated"
  sources.matching.execution.fills[0].quantity = "9"

  assert.deepEqual(snapshot.balances[0].metadata.labels, ["spot"])
  assert.equal(snapshot.symbols[0].openOrders[0].execution.fees[0].amount, "0.1")
  assert.deepEqual(snapshot.symbols[0].firstHistoryPage[0].details.tags, ["history"])
  assert.equal(snapshot.matchingOrderObservations[0].data.execution.fills[0].quantity, "1")
})


test("stop and immediate same-scope restart isolate the new in-flight polling generation", async () => {
  let releaseOld
  let releaseNew
  const oldWait = new Promise((resolve) => {
    releaseOld = resolve
  })
  const newWait = new Promise((resolve) => {
    releaseNew = resolve
  })
  const { broker } = createBroker()
  const originalGetBalances = broker.getBalances
  let balanceCalls = 0
  broker.getBalances = async () => {
    balanceCalls += 1
    if (balanceCalls === 1) {
      await oldWait
    } else if (balanceCalls === 2) {
      await newWait
    }
    return originalGetBalances()
  }

  const snapshots = []
  const reconciler = new BitunixSpotReconciler({ broker })
  const firstSession = reconciler.start({
    symbols: ["BTCUSDT"],
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })
  assert.equal(balanceCalls, 1, "the first generation must begin its read immediately")

  firstSession.stop()
  const secondSession = reconciler.start({
    symbols: ["BTCUSDT"],
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })
  assert.equal(balanceCalls, 2, "a new generation must not attach to the stopped generation's pending request")

  releaseOld()
  await new Promise((resolve) => setImmediate(resolve))

  const coalesced = reconciler.pollOnce({ symbols: ["BTCUSDT"] })
  assert.equal(balanceCalls, 2, "late cleanup from the old generation must not clear the new generation's in-flight promise")

  releaseNew()
  await coalesced
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(snapshots.length, 1, "only the active generation may publish an observation")
  assert.equal(reconciler.getStatus().running, true)
  secondSession.stop()
})

test("stop and immediate different-scope restart do not inherit the previous generation's scope lock", async () => {
  let releaseOld
  let releaseNew
  const oldWait = new Promise((resolve) => {
    releaseOld = resolve
  })
  const newWait = new Promise((resolve) => {
    releaseNew = resolve
  })
  const { broker } = createBroker()
  const originalGetBalances = broker.getBalances
  let balanceCalls = 0
  broker.getBalances = async () => {
    balanceCalls += 1
    if (balanceCalls === 1) {
      await oldWait
    } else if (balanceCalls === 2) {
      await newWait
    }
    return originalGetBalances()
  }

  const snapshots = []
  const reconciler = new BitunixSpotReconciler({ broker })
  const firstSession = reconciler.start({
    symbols: ["BTCUSDT"],
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })
  firstSession.stop()

  const secondSession = reconciler.start({
    symbols: ["ETHUSDT"],
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })
  assert.equal(balanceCalls, 2, "a different scope in the new generation must start without inheriting the old scope lock")

  releaseOld()
  await new Promise((resolve) => setImmediate(resolve))
  releaseNew()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(snapshots.length, 1, "the stale BTC generation must not publish after the ETH generation starts")
  assert.equal(reconciler.getStatus().running, true)
  secondSession.stop()
})
