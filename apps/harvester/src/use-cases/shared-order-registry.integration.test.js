import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { createAccountRuntimeRegistry } from "../application/providers/account-runtime-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"
import { createHarnessBroker } from "./conservative-trading-engine-harness.js"

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})
const marketMetadata = createMarketMetadata()
const appConfig = {
  strategies: {
    [StrategyId.COIN_GRABBER]: {
      enabled: true,
      settings: {
        conservative: {
          enabled: true,
        },
        aggressive: {
          enabled: false,
        },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          investment: 1000,
          orderQuantity: 1,
          keepQuantity: 0.1,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          makerPercent: 0,
          takerPercent: 0.075,
          pricePrecision: 2,
          quantityPrecision: 1,
        },
      },
    },
  },
}

function createMarketMetadata() {
  return {
    market,
    orderType: "LIMIT_MAKER",
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    unvalidatedConstraints: [],
    tradingRules: new TradingRules({
      market,
      constraints: [
        {
          type: "PRICE_INCREMENT",
          status: "SUPPORTED",
          value: new Money({
            amount: "0.01",
            asset: quoteAsset,
          }),
        },
        {
          type: "QUANTITY_INCREMENT",
          status: "SUPPORTED",
          value: new Quantity({
            amount: "0.1",
            asset: baseAsset,
          }),
        },
        {
          type: "MIN_QUANTITY",
          status: "SUPPORTED",
          value: new Quantity({
            amount: "0.1",
            asset: baseAsset,
          }),
        },
        {
          type: "MIN_NOTIONAL",
          status: "SUPPORTED",
          value: new Money({
            amount: "5",
            asset: quoteAsset,
          }),
        },
      ],
    }),
  }
}

function createSharedAccountState() {
  return createAccountRuntimeRegistry({
    providers: [{
      providerInstanceId: "test-provider",
      providerType: "binance",
      accountId: "test-account",
      environment: "testnet",
    }],
  }).get("test-provider").state
}

function createEngineOptions({
  sharedAccountState,
  brokerState,
  evaluateRecoverySellerTransition,
  recoverySellerPairs,
  recoverySellerWorkflow,
} = {}) {
  return {
    broker: {
      ...brokerState.broker,
      providerInstanceId: "binance-primary",
      providerType: "binance",
      accountId: "test-account",
    },
    strategyPolicy: conservativeStrategyPolicy,
    appConfig,
    getPortfolio: () => sharedAccountState.portfolio,
    getRecoveryLedger: () => RecoveryLedger.empty({ market }),
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => brokerState.accountSnapshot,
    onOperationalStateSubmissionIntent: async () => ({
      ok: true,
      data: { durable: true },
    }),
    onOperationalStateSubmissionOutcome: async () => ({
      ok: true,
      data: { durable: true },
    }),
    updateTradingAccounting: async () => ({
      ok: true,
      data: {
        applied: false,
        duplicate: true,
      },
    }),
    completeRecoveryCycle: async () => ({
      ok: true,
      data: {
        eligible: false,
      },
    }),
    canTrade: () => true,
    onPause: async () => {},
    isStopping: () => false,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    hasUnownedOpenOrdersForSymbol: () => false,
    initialState: { orderRegistry: sharedAccountState.orderRegistry },
    sharedAccountState,
    evaluateRecoverySellerTransition,
    recoverySellerPairs,
    recoverySellerWorkflow,
  }
}

function createEngine({
  sharedAccountState,
  evaluateRecoverySellerTransition,
  recoverySellerPairs = {},
  recoverySellerWorkflow,
}) {
  const brokerState = createHarnessBroker({
    market,
    baseAsset,
    quoteAsset,
    marketMetadata,
    baseFreeBalance: "0",
    quoteFreeBalance: "1000",
    quoteCashFlowBaseline: "0",
    portfolioBaseQuantityBaseline: "0",
    additionalTrackedBaseQuantityBaseline: "0",
    committedQuoteBalanceBaseline: "0",
    committedBaseBalanceBaseline: "0",
  })
  const engine = makeConservativeTradingEngine(createEngineOptions({
    sharedAccountState,
    brokerState,
    evaluateRecoverySellerTransition,
    recoverySellerPairs,
    recoverySellerWorkflow,
  }))
  return {
    engine,
    brokerState,
  }
}

test("Conservative engine and RS accounting workflow observe one live account OrderRegistry", async () => {
  const sharedAccountState = createSharedAccountState()
  const initialRegistry = sharedAccountState.orderRegistry
  const recoverySellerWorkflow = createRecoverySellerAccountingWorkflow({
    sharedState: sharedAccountState,
  })
  const { engine } = createEngine({ sharedAccountState })

  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
      symbol: "DOGEUSDT",
      bestBidPrice: "99",
      bestBidQuantity: "100",
      bestAskPrice: "101",
      bestAskQuantity: "100",
      timestamp: Date.now(),
    },
  })
  const evaluation = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now(),
    },
  })

  assert.equal(evaluation.ok, true, "The Conservative market evaluation must complete.")
  assert.notEqual(
    sharedAccountState.orderRegistry,
    initialRegistry,
    "The Conservative engine must publish its pending/acknowledged order transition to the account state.",
  )
  assert.equal(
    sharedAccountState.orderRegistry.getActiveOrders().length,
    1,
    "The account registry must contain the submitted Conservative BUY.",
  )
  assert.equal(
    recoverySellerWorkflow.getOrderRegistry(),
    sharedAccountState.orderRegistry,
    "The RS accounting workflow must observe the exact current registry snapshot used by the CG engine.",
  )
})


test("Conservative engine dispatches RS evaluation through the shared account transition", async () => {
  const sharedAccountState = createSharedAccountState()
  const recoverySellerWorkflow = createRecoverySellerAccountingWorkflow({
    sharedState: sharedAccountState,
  })
  const evaluatedSymbols = []
  const { engine } = createEngine({
    sharedAccountState,
    recoverySellerWorkflow,
    recoverySellerPairs: {
      DOGEUSDT: {
        enabled: true,
      },
    },
    evaluateRecoverySellerTransition: async ({ symbol }) => {
      evaluatedSymbols.push(symbol)
      return {
        ok: true,
        data: {
          symbol,
          skipped: true,
          reason: "RS_POLICY_NOT_READY",
        },
      }
    },
  })

  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
      symbol: "DOGEUSDT",
      bestBidPrice: "99",
      bestBidQuantity: "100",
      bestAskPrice: "101",
      bestAskQuantity: "100",
      timestamp: Date.now(),
    },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now(),
    },
  })

  assert.deepEqual(
    evaluatedSymbols,
    ["DOGEUSDT"],
    "The shared engine must dispatch the same market transition to the configured RS policy exactly once.",
  )
  assert.equal(
    typeof sharedAccountState.runTransition,
    "function",
    "RS evaluation must run under the account-owned transition coordinator.",
  )
})
