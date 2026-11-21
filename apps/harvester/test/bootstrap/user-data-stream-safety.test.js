import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest } = shared
const test = (...args) => nodeTest(`[user-data-stream-safety.test.js] ${args[0]}`, ...args.slice(1))
test("does not clear a genuine startup stream-recovery gate with only the initial balance snapshot", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "connectionClosed",
      recoveryRequired: true
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
    "does not clear a genuine startup stream-recovery gate with only the initial balance snapshot: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: {\n        ...binanceEnv,\n        NODE_ENV: \"development\",\n      },\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /user-data stream reconciliation is required/ as required by the recovery safety gate.", "Startup must reject a stream that already requires reconciliation; the initial balance snapshot alone cannot establish safe trading readiness.")
})

test("fails startup when user-data recovery is required during subscription setup", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "recovered",
      recoveryRequired: true,
      reconciliationRequired: true
    })
    return result
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
    "fails startup when user-data recovery is required during subscription setup: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /user-data stream reconciliation is required/ as required by the recovery safety gate.", "Startup must fail closed when the stream reports a recovery requirement during subscription setup.")
})

test("fails startup closed when user-data subscription cannot be established", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.subscribeForUserData = async () => ({
    ok: false,
    errors: [new Error("user stream unavailable")],
  })

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Unable to subscribe to user data: user stream unavailable/,
    "fails startup closed when user-data subscription cannot be established: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /Unable to subscribe to user data: user stream unavailable/ as required by the recovery safety gate.", "Startup must reject an unavailable user-data subscription rather than expose a partially initialized runtime.")
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "filters:ETHUSDT", "disconnect"], "Failed subscription setup must disconnect the broker and unwind startup resources in the expected order.")
})

test("does not clear the ownership gate after stream recovery acknowledgement", async () => {
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

  broker.emitUserDataStatus({
    type: "connectionClosed",
    recoveryRequired: true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "A user-data disconnect must close readiness until authoritative ownership reconciliation completes.")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The runtime must expose the unresolved authoritative-reconciliation status after disconnect.")

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: false,
    subscriptionId: "stale-subscription",
    recoveryGeneration: 0,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "A stale broker acknowledgement without the matching application audit must not reopen trading.")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The unresolved reconciliation status must remain visible after a stale acknowledgement.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Shutdown must remain incomplete until the ownership/reconciliation gate is satisfied.")
})
