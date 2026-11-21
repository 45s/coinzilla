import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest, createFill, assertRecoverySellerEvaluatorConfigured, assertRecoverySellerRuntimeAcceptance } = shared
const test = (...args) => nodeTest(`[trading-safety.test.js] ${args[0]}`, ...args.slice(1))

test("rejects configured RS routes when the runtime acceptance gate is closed", () => {
  const recoverySellerPairs = {
    BTCUSDT: {
      enabled: true,
    },
  }
  assert.throws(() => assertRecoverySellerRuntimeAcceptance({
    recoverySellerPairs,
  }), /RS-4 integration and RS-5 offline lifecycle acceptance/, "Configured RS routes must be rejected until integration and offline lifecycle acceptance is complete.")
  assert.doesNotThrow(() => assertRecoverySellerRuntimeAcceptance({
    recoverySellerPairs: {},
  }), "An empty RS route configuration must remain valid while the runtime acceptance gate is closed.")
  assert.doesNotThrow(() => assertRecoverySellerRuntimeAcceptance({
    recoverySellerPairs,
    acceptanceComplete: true,
  }), "RS routes may be configured after the runtime acceptance gate is explicitly opened.")
  assert.throws(() => assertRecoverySellerEvaluatorConfigured({
    recoverySellerPairs,
  }), /before broker connection/, "Configured RS routes must not reach broker startup without an evaluator.")
  assert.doesNotThrow(() => assertRecoverySellerEvaluatorConfigured({
    recoverySellerPairs,
    evaluateRecoverySellerTransition: async () => ({ ok: true }),
  }), "Accepted RS routes must pass startup validation when their evaluator is provided.")
})

test("starts the Conservative trading engine and applies fills to Portfolio", async () => {
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => createBroker(),
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.tradingEnabled, true, "The startup composition must activate trading when all required startup gates pass.")
  assert.equal(result.strategyMode, "conservative", "The enabled runtime must use the configured Conservative strategy mode.")
  const first = await result.updatePortfolio({ fill: createFill({ tradeId: "trade-portfolio-1" }) })
  const second = await result.updatePortfolio({ fill: createFill({ tradeId: "trade-portfolio-2" }) })
  assert.equal(first.ok, true, "The first canonical fill must be accepted by the Portfolio workflow.")
  assert.equal(first.data.applied, true, "The first unique fill must be applied exactly once.")
  assert.equal(second.ok, true, "The second canonical fill must be accepted by the Portfolio workflow.")
  assert.equal(second.data.applied, true, "The second unique fill must be applied exactly once.")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.02", "Portfolio base quantity must equal the sum of both accepted 0.01 BTC fills.")
  assert.equal(result.portfolio.appliedFillIds.length, 2, "Portfolio must retain exactly one applied identity for each of the two unique fills.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "An incomplete broker shutdown must be reported instead of being treated as successful.")
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE", "The runtime must expose the incomplete shutdown state after the expected cleanup failure.")
})

test("serializes concurrent Portfolio updates without losing fills", async () => {
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {}
  })
  const [first, second] = await Promise.all([
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-1" }) }),
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-2" }) }),
  ])
  assert.equal(first.ok, true, "The first concurrent Portfolio update must complete successfully.")
  assert.equal(second.ok, true, "The second concurrent Portfolio update must complete successfully.")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.02", "Serialized concurrent updates must preserve the combined quantity of both fills.")
  assert.equal(result.portfolio.appliedFillIds.length, 2, "Serialized concurrent updates must apply both distinct fill identities without loss.")
})

test("does not expose a broker port that could bypass the trading engine", async () => {
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

  assert.equal(result.placeOrder, undefined, "The public runtime must not expose a direct broker order-submission escape hatch.")
  assert.equal(result.broker, undefined, "The public runtime must not expose its broker adapter or bypass the Trading Engine boundary.")
  await result.stop()
})

test("retains an explicitly injected application event publisher in TESTNET runtime", async () => {
  const eventPublisher = { publish: () => ({ ok: true }) }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {},
    eventPublisher,
  })

  assert.equal(result.eventPublisher, eventPublisher, "The runtime must preserve the exact application event publisher instance supplied by its caller.")
  await result.stop()
})
