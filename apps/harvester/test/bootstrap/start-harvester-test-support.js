import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { prepareHarvesterStartupState, startHarvester } from "../../src/bootstrap/start-harvester.js"
import { createBroker } from "./broker-test-support.js"
import { resolveHarvesterOptions } from "../../src/bootstrap/config/resolve-harvester-options.js"
import { createRecoverySellerStopWorkflow } from "../../src/use-cases/create-recovery-seller-stop-workflow.js"
import { createFileOperationalStateStore } from "../../src/infrastructure/operational-state/create-file-operational-state-store.js"
import { recordConfigurationBaseline } from "../../src/use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../../src/use-cases/record-process-started.js"
import { recordProcessStopped } from "../../src/use-cases/record-process-stopped.js"
import { createBinanceBrokerAdapter } from "../../src/infrastructure/brokers/binance-broker-adapter.js"
import {
  assertRecoverySellerEvaluatorConfigured,
  assertRecoverySellerRuntimeAcceptance,
} from "../../src/bootstrap/harvester-runtime-setup.js"

export { mkdtemp, rm, os, path, prepareHarvesterStartupState, startHarvester, resolveHarvesterOptions, createRecoverySellerStopWorkflow, createFileOperationalStateStore, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, createBinanceBrokerAdapter, assertRecoverySellerEvaluatorConfigured, assertRecoverySellerRuntimeAcceptance }
export { Asset, Balance, CanonicalOrder, Fill, Market, Money, Order, Quantity, TradingRules, multiplyDecimal, createMarketTradingRules, createMarketMetadata, createOpenOrderSnapshot, createBinanceCapabilities, createBrokerTestState, createBrokerOrderPorts, createBrokerAccountPorts, createBrokerCandlePorts, createBrokerPriceStreamPorts, createBrokerUserDataPorts, createBroker, makeVolatilityReadyBroker } from "./broker-test-support.js"

export const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({
    ok: true,
    durable: true
  }),
})

export async function waitForTestSignal(...args) {
  const [promise, label, getDiagnostics, timeoutMs = 15_000] = args
  let timeout
  try {
    await Promise.race([
      promise,
      new Promise((...executorArgs) => {
        const [, reject] = executorArgs
        timeout = setTimeout(() => {
          reject(new Error(
            `${label  } was not observed within ${  timeoutMs  }ms; diagnostics: ${ 
            JSON.stringify(getDiagnostics())}`,
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false }
      },
      pairs: {
        BTCUSDT: {
          enabled: true,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 0.01,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
        ETHUSDT: {
          enabled: false,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 0.1,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
      },
    },
  },
}

export const withExternalOrdersPolicy = (...args) => {
  const [symbol, externalOrdersPolicy] = args
  return {
  ...appConfig,
  strategies: {
    ...appConfig.strategies,
    CG_coinGrabber: {
      ...appConfig.strategies.CG_coinGrabber,
      pairs: {
        ...appConfig.strategies.CG_coinGrabber.pairs,
        [symbol]: {
          ...appConfig.strategies.CG_coinGrabber.pairs[symbol],
          externalOrdersPolicy,
        },
      },
    },
  },
  }
}

export const binanceEnv = {
  NODE_ENV: "test",
  TRADING_MODE: "testnet",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}

export const startHarvesterForTest = (input = {}) => {
  const eventPublisher = input.eventPublisher ?? testEventPublisher
  if (eventPublisher !== testEventPublisher && typeof eventPublisher.flush !== "function") {
    eventPublisher.flush = testEventPublisher.flush
  }
  return startHarvester({
    ...input,
    env: {
      ...binanceEnv,
      ...input.env
    },
    brokerAdapterFactory: input.brokerAdapterFactory ?? (({ config: brokerConfig } = {}) =>
      createBroker([], { tradingMode: brokerConfig.tradingMode })),
    eventPublisher,
  })
}

export function createTwoMarketStartupConfig() {
  const strategy = appConfig.strategies.CG_coinGrabber
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...strategy,
        pairs: {
          ...strategy.pairs,
          ETHUSDT: {
            ...strategy.pairs.ETHUSDT,
            enabled: true,
          },
        },
      },
    },
  }
}

export const createFill = ({
  tradeId = "trade-1",
  quantity = "0.01"
} = {}) => {
  const baseAsset = new Asset({
    id: "asset:BTC",
    code: "BTC"
  })
  const quoteAsset = new Asset({
    id: "asset:USDT",
    code: "USDT"
  })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset
  })
  return new Fill({
    tradeId,
    brokerOrderId: `order-${  tradeId}`,
    market,
    side: "BUY",
    price: new Money({
      amount: "65000",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "650",
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

export async function createPriorProcessHistory({ directory, runtimeSessionId, priorAppConfig, clean = false } = {}) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId,
  })
  const initialization = await store.initialize()
  assert.equal(initialization.ok, true, "the prior process history fixture must start from a valid durable ledger")
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: store,
    appConfig: priorAppConfig,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const started = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  if (clean) {
    const stopped = await recordProcessStopped({
      operationalStateStore: store,
      reason: "CLEAN_TEST_SHUTDOWN",
      clean: true,
    })
    assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  }
}
