import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest } = shared
const test = (...args) => nodeTest(`[account-preflight.test.js] ${args[0]}`, ...args.slice(1))

function configureDurableStartupAuditBroker({ broker, calls, counters }) {
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    calls.push("account:snapshot")
    return {
      ok: true,
      data: {
        balances: ["BTC", "ETH", "USDT"].map((code) => {
          const asset = new Asset({ id: `asset:${code}`,
            code })
          return new Balance({
            free: new Quantity({ amount: "12.5",
              asset }),
            locked: new Quantity({ amount: "0.5",
              asset }),
          })
        }),
        sourceTime: 123,
      },
    }
  }
  broker.getOpenOrders = async (input) => {
    counters.openOrderReads += 1
    calls.push("account:open-orders")
    assert.deepEqual(input, {}, "configureDurableStartupAuditBroker: expected input to deeply equal {}.")
    return { ok: true,
      data: [] }
  }
}

function createDurableStartupAuditPublisher({ calls, events, counters }) {
  return {
    publish: (event) => {
      events.push(event)
      calls.push(`publish:${event.name}`)
      return { ok: true }
    },
    flush: async () => {
      counters.flushCount += 1
      calls.push(`journal:flush:${counters.flushCount}`)
      return { ok: true,
        durable: true }
    },
  }
}

function createDurableStartupAuditFixture({ calls }) {
  const broker = createBroker(calls)
  const counters = { accountReads: 0,
    openOrderReads: 0,
    flushCount: 0 }
  configureDurableStartupAuditBroker({ broker,
    calls,
    counters })
  const events = []
  const eventPublisher = createDurableStartupAuditPublisher({ calls,
    events,
    counters })
  return {
    broker,
    events,
    eventPublisher,
    getAccountReads: () => counters.accountReads,
    getOpenOrderReads: () => counters.openOrderReads,
    getFlushCount: () => counters.flushCount,
  }
}

function assertDurableStartupAudit({ fixture, calls }) {
  assert.equal(fixture.getAccountReads(), 1, "assertDurableStartupAudit: expected fixture.getAccountReads() to equal 1.")
  assert.equal(fixture.getOpenOrderReads(), 1, "assertDurableStartupAudit: expected fixture.getOpenOrderReads() to equal 1.")
  assert.equal(fixture.getFlushCount(), 2, "assertDurableStartupAudit: expected fixture.getFlushCount() to equal 2.")
  const balances = fixture.events.filter((event) => event.name === "account.snapshot_captured")
  const openOrders = fixture.events.filter((event) => event.name === "account.open_orders_captured")
  assert.equal(balances.length, 1, "assertDurableStartupAudit: expected balances.length to equal 1.")
  assert.equal(openOrders.length, 1, "assertDurableStartupAudit: expected openOrders.length to equal 1.")
  assert.equal(balances[0].data.phase, "PREFLIGHT", "assertDurableStartupAudit: expected balances[0].data.phase to equal \"PREFLIGHT\".")
  assert.equal(openOrders[0].data.phase, "PREFLIGHT", "assertDurableStartupAudit: expected openOrders[0].data.phase to equal \"PREFLIGHT\".")
  assert.equal(openOrders[0].data.readiness, "READY", "assertDurableStartupAudit: expected openOrders[0].data.readiness to equal \"READY\".")
  assert.equal(balances[0].data.balances.find((item) => item.asset === "BTC").total, "13", "assertDurableStartupAudit: expected balances[0].data.balances.find((item) => item.asset === \"BTC\").total to equal \"13\".")
  const lastAuditFlush = calls.lastIndexOf("journal:flush:2")
  const marketSubscription = calls.findIndex((call) => call === "subscribe:BTCUSDT")
  assert.ok(lastAuditFlush >= 0, "assertDurableStartupAudit: expected lastAuditFlush >= 0 to be truthy.")
  assert.ok(marketSubscription > lastAuditFlush, "assertDurableStartupAudit: expected marketSubscription > lastAuditFlush to be truthy.")
}


test("marks trading ready only after the mandatory account preflight audit", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.userDataReady, true, "marks trading ready only after the mandatory account preflight audit: expected result.userDataReady to equal true.")
  broker.emitUserDataStatus({
    type: "ready",
    recoveryRequired: false
  })
  assert.equal(result.userDataReady, true, "marks trading ready only after the mandatory account preflight audit: expected result.userDataReady to equal true.")
  assert.equal(result.placeOrder, undefined, "marks trading ready only after the mandatory  () => ({\n        ok: false,\n        errors: [new Error(\"fsync failed\")]\n      }),\n    },\n    logger: {\n      info() {},\n      error() {},\n      debug() {}\n    },\n  }) to reject or throw with /Unable to durably persist PREFLIGHT account snapshot/ as required by the account preflight gate.")
  assert.ok(calls.includes("disconnect"), "fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed: expected calls.includes(\"disconnect\") to be truthy.")
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false, "fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed: expected calls.some((call) => call.startsWith(\"subscribe:book:\")) to equal false.")
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false, "fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed: expected calls.some((call) => call.startsWith(\"subscribe:BTCUSDT\")) to equal false.")
})

test("fails closed before market subscriptions when the account-wide open-order query fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  broker.getOpenOrders = async () => ({
    ok: false,
    errors: [new {},
      debug() {}
    },
  }), /Unable to load authoritative account-wide open orders/, "fails closed before market subscriptions when the account-wide open-order query fails: expected startHarvesterForTest({\n    loadConfig: async () => appConfig,\n    env: {\n      ...binanceEnv,\n      NODE_ENV: \"development\"\n    },\n    brokerAdapterFactory: () => broker,\n    eventPublisher: {\n      publish: (event) => { events.push(event); return { ok: true } },\n      flush: async () => ({\n        ok: true,\n        durable: true\n      }),\n    },\n    logger: {\n      info() {},\n      error() {},\n      debug() {}\n    },\n  }) to reject or throw with /Unable to load authoritative account-wide open orders/ as required by the account preflight gate.")
  assert.ok(events.some((event) => event.name === "account.snapshot_captured"), "fails closed before market subscriptions when the account-wide open-order query fails: expected events.some((event) => event.name === \"account.snapshot_captured\") to be truthy.")
  assert.equal(events.some((event) => event.name === "account.open_orders_captured"), false, "fails closed before market subscriptions when the account-wide open-order query fails: expected events.some((event) => event.name === \"account.open_orders_captured\") to equal false.")
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false, "fails closed before market subscriptions when the account-wide open-order query fails: expected calls.some((call) => call.startsWith(\"subscribe:book:\")) to equal false.")
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false, "fails closed before market subscriptions when the account-wide open-order query fails: expected calls.some((call) => call.startsWith(\"subscribe:BTCUSDT\")) to equal false.")
  assert.ok(calls.includes("disconnect"), "fails closed before market subscriptions when the account-wide open-order query fails: expected calls.includes(\"disconnect\") to be truthy.")
})

test("captures and durably journals balances and account-wide open orders on trading startup", async () => {
  const calls = []
  const fixture = createDurableStartupAuditFixture({
    calls,
  })
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => fixture.broker,
    eventPublisher: fixture.eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })

  assertDurableStartupAudit({
    fixture,
    calls,
  })
  await runtime.stop()
})

test("blocks trading startup when either account audit query fails", async () => {
  for (const failure of ["balances", "open-orders"]) {
    const calls = []
    const broker = createBroker(calls)
    if (failure === "balances") {
      broker.getAccountSnapshot = async () => ({
        ok: false,
        errors: [new Error("account status failed")]
      })
    } else {
      broker.getOpenOrders = async () => ({
        ok: false,
        errors: [new Error("open orders status failed")]
      })
    }

    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failure === "balances"
      ? /Unable to load canonical exchange account balances/
      : /Unable to load authoritative account-wide open orders/, "blocks trading startup when either account audit query fails: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {},\n        debug() {}\n      },\n    }) to reject or throw with failure === \"balances\"\n      ? /Unable to load canonical exchange account balances/\n      : /Unable to load authoritative account-wide open orders/ as required by the account preflight gate.")
    assert.equal(calls.includes("disconnect"), true, "blocks trading startup when either account audit query fails: expected calls.includes(\"disconnect\") to equal true.")
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false, "blocks trading startup when either account audit query fails: expected calls.some((call) => call.startsWith(\"subscribe:BTCUSDT\")) to equal false.")
  }
})

test("blocks trading startup when either PREFLIGHT audit event cannot be durably flushed", async () => {
  for (const scenario of [{
    failedFlush: 1,
    nonOperationalState: false
  }, {
    failedFlush: 1,
    nonOperationalState: true
  }, {
    failedFlush: 2,
    nonOperationalState: true
  }]) {
    const {
      failedFlush,
      nonOperationalState
    } = scenario
    const calls = []
    const broker = createBroker(calls)
    const events = []
    let flushCount = 0
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => { events.push(event); return { ok: true } },
        flush: async () => {
          flushCount += 1
          if (flushCount !== failedFlush) {return {
            ok: true,
            durable: true
          }}
          return nonOperationalState
            ? {
              ok: true,
              durable: false
            }
            : {
              ok: false,
              errors: [new Error("journal fsync failed")]
            }
        },
      },
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failedFlush === 1
      ? /Unable to durably persist PREFLIGHT account snapshot/
      : /Unable to durably persist account open-orders audit/, "blocks trading startup when either PREFLIGHT audit event cannot be durably flushed: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      eventPublisher: {\n        publish: (event) => { events.push(event); return { ok: true } },\n        flush: async () => {\n          flushCount += 1\n          if (flushCount !== failedFlush) {return {\n            ok: true,\n            durable: true\n          }}\n          return nonOperationalState\n            ? {\n              ok: true,\n              durable: false\n            }\n            : {\n              ok: false,\n              errors: [new Error(\"journal fsync failed\")]\n            }\n        },\n      },\n      logger: {\n        info() {},\n        error() {},\n        debug() {}\n      },\n    }) to reject or throw with failedFlush === 1\n      ? /Unable to durably persist PREFLIGHT account snapshot/\n      : /Unable to durably persist account open-orders audit/ as required by the account preflight gate.")
    assert.equal(events.some((event) => event.name === "account.snapshot_captured"), true, "blocks trading startup when either PREFLIGHT audit event cannot be durably flushed: expected events.some((event) => event.name === \"account.snapshot_captured\") to equal true.")
    if (failedFlush === 2) {
      assert.equal(events.some((event) => event.name === "account.open_orders_captured"), true, "blocks trading startup when either PREFLIGHT audit event cannot be durably flushed: expected events.some((event) => event.name === \"account.open_orders_captured\") to equal true.")
    }
    assert.equal(calls.includes("disconnect"), true, "blocks trading startup when either PREFLIGHT audit event cannot be durably flushed: expected calls.includes(\"disconnect\") to equal true.")
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false, "blocks trading startup when either PREFLIGHT audit event cannot be durably flushed: expected calls.some((call) => call.startsWith(\"subscribe:BTCUSDT\")) to equal false.")
  }
})

test("blocks trading startup when either PREFLIGHT audit event publication fails", async () => {
  for (const failedEvent of ["account.snapshot_captured", "account.open_orders_captured"]) {
    const calls = []
    const broker = createBroker(calls)
    const events = []
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => {
          events.push(event)
          return event.name === failedEvent
            ? {
              ok: false,
              errors: [new Error("event publication rejected")]
            }
            : { ok: true }
        },
        flush: async () => ({
          ok: true,
          durable: true
        }),
      },
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failedEvent === "account.snapshot_captured"
      ? /Unable to publish PREFLIGHT account snapshot audit event/
      : /Unable to publish account open-orders audit event/, "blocks trading startup when either PREFLIGHT audit event publication fails: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      eventPublisher: {\n        publish: (event) => {\n          events.push(event)\n          return event.name === failedEvent\n            ? {\n              ok: false,\n              errors: [new Error(\"event publication rejected\")]\n            }\n            : { ok: true }\n        },\n        flush: async () => ({\n          ok: true,\n          durable: true\n        }),\n      },\n      logger: {\n        info() {},\n        error() {},\n        debug() {}\n      },\n    }) to reject or throw with failedEvent === \"account.snapshot_captured\"\n      ? /Unable to publish PREFLIGHT account snapshot audit event/\n      : /Unable to publish account open-orders audit event/ as required by the account preflight gate.")
    assert.equal(calls.includes("disconnect"), true, "blocks trading startup when either PREFLIGHT audit event publication fails: expected calls.includes(\"disconnect\") to equal true.")
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false, "blocks trading startup when either PREFLIGHT audit event publication fails: expected calls.some((call) => call.startsWith(\"subscribe:BTCUSDT\")) to equal false.")
  }
})
