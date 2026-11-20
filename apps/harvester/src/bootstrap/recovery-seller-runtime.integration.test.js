import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../domain/strategies/recovery-seller/legacy-position.js"
import { createRecoverySellerRuntimeDispatch } from "./create-recovery-seller-runtime-dispatch.js"
import { createRecoverySellerAccountingWorkflow } from "../use-cases/create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerOrderSubmitter } from "../use-cases/create-recovery-seller-order-submitter.js"
import { createRecoverySellerStopWorkflow } from "../use-cases/create-recovery-seller-stop-workflow.js"

const baseAsset = new Asset({
  id: "zro",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: [
    "LIMIT_MAKER",
    "LIMIT",
  ],
  tradingRules: new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.001",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
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

function createStore() {
  const records = []
  return {
    records,
    append: async (fact) => {
      records.push(fact)
      return {
        ok: true,
        data: {
          durable: true,
          record: fact,
        },
      }
    },
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
      },
    }),
  }
}

function createSharedState() {
  return {
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: OrderRegistry.empty(),
    legacyPositions: new Map(),
    recoverySellerBuyExecutionByCycle: new Map(),
    recoverySellerSellReservations: new Map(),
    recoverySellerCycleStates: new Map(),
    recoverySellerCycleOutcomes: new Map(),
    updateQueue: Promise.resolve(),
  }
}

function createAccountSnapshot() {
  return {
    balances: [
      new Balance({
        free: new Quantity({
          amount: "100",
          asset: baseAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: baseAsset,
        }),
      }),
      new Balance({
        free: new Quantity({
          amount: "1000",
          asset: quoteAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: quoteAsset,
        }),
      }),
    ],
  }
}

function createOfflineBroker() {
  let acknowledgedOrder
  return {
    getAcknowledgedOrder: () => acknowledgedOrder,
    broker: {
      providerInstanceId: "binance-offline-integration",
      providerType: "binance",
      accountId: "offline-integration-account",
      placeOrder: async ({ order }) => {
        acknowledgedOrder = new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "offline-broker-order-1",
          providerInstanceId: "binance-offline-integration",
          providerType: "binance",
          accountId: "offline-integration-account",
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({
            amount: order.price,
            asset: quoteAsset,
          }),
          originalQuantity: new Quantity({
            amount: order.quantity,
            asset: baseAsset,
          }),
          executedQuantity: new Quantity({
            amount: "0",
            asset: baseAsset,
          }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 2,
          updatedAt: 2,
        })
        return {
          ok: true,
          data: acknowledgedOrder,
        }
      },
    },
  }
}

function createSubmitterFixture({ store, accounting, stopWorkflow, broker }) {
  const unresolved = []
  const submit = createRecoverySellerOrderSubmitter({
    broker,
    recoverySellerAccountingWorkflow: accounting,
    onDurableSubmissionIntent: async (fact) => store.append({
      factType: "ORDER_SUBMISSION_INTENT",
      data: fact,
    }),
    onDurableSubmissionOutcome: async (fact) => store.append({
      factType: "ORDER_SUBMISSION_OUTCOME",
      data: fact,
    }),
    onUnresolvedSubmission: async (fact) => {
      unresolved.push(fact)
      return stopWorkflow.latch({
        explanation: "Offline integration observed an unresolved submission",
        orderIdentity: {
          clientOrderId: fact.order?.clientOrderId,
        },
      })
    },
    canSubmit: () => true,
  })
  return {
    submit,
    unresolved,
  }
}

function createDispatchFixture({ accounting, stopWorkflow }) {
  const pairConfig = {
    enabled: true,
    investment: "100",
    orderQuantity: "5",
    sellQuantity: "50",
    minProfit: "0.01",
    priceStepPercent: "0.05",
    makerPercent: "0",
    takerPercent: "0",
  }
  return createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow: accounting,
    recoverySellerStopWorkflow: stopWorkflow,
    recoverySellerPairs: {
      ZROUSDT: pairConfig,
    },
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => createAccountSnapshot(),
    evaluateBuyDecision: (snapshot) => ({
      decision: {
        outcome: "SUBMIT",
        reasonCode: "INTEGRATION_INITIAL_BUY",
      },
      action: {
        side: "BUY",
        purpose: "RECOVERY_BUY",
        positionId: snapshot.cycleState.positionId,
        cycleId: snapshot.cycleState.cycleId,
        type: "LIMIT_MAKER",
        price: "2",
        quantity: "5",
      },
    }),
  })
}

async function createIntegrationFixture() {
  const store = createStore()
  const stopResult = await createRecoverySellerStopWorkflow({
    operationalStateStore: store,
  })
  assert.equal(stopResult.ok, true, stopResult.errors?.[0]?.message)
  const stopWorkflow = stopResult.data
  const accounting = createRecoverySellerAccountingWorkflow({
    sharedState: createSharedState(),
    createCycleId: () => "integration-cycle-1",
    onOperationalStateExecutionFill: async (fact) => store.append({
      factType: "EXECUTION_FILL",
      data: fact,
    }),
  })
  const legacyInitialized = await accounting.initializeLegacyPositions({
    records: [
      {
        market,
        position: createLegacyPosition({
          invested: "100",
          quantity: "50",
        }),
        accounting: createLegacyPositionAccounting(),
      },
    ],
  })
  assert.equal(legacyInitialized.ok, true, legacyInitialized.errors?.[0]?.message)
  const offlineBroker = createOfflineBroker()
  const submitter = createSubmitterFixture({
    store,
    accounting,
    stopWorkflow,
    broker: offlineBroker.broker,
  })
  const dispatch = createDispatchFixture({
    accounting,
    stopWorkflow,
  })
  return {
    store,
    stopWorkflow,
    accounting,
    offlineBroker,
    submitter,
    dispatch,
  }
}

async function assertAppliedBuyFill({ fixture, order, ownership }) {
  const fill = new Fill({
    tradeId: "offline-trade-1",
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    providerInstanceId: "binance-offline-integration",
    providerType: "binance",
    accountId: "offline-integration-account",
    market,
    side: "BUY",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "5",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    executedAt: 3,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const applied = await fixture.accounting.applyBuyFill({
    fill,
  })
  assert.equal(applied.ok, true, applied.errors?.[0]?.message)
  assert.equal(applied.data.applied, true)
  assert.equal(fixture.accounting.getBuyExecutionQuantity({
    cycleId: "integration-cycle-1",
  }), "5")
  assert.equal(fixture.accounting.getBuyExecutionVwap({
    cycleId: "integration-cycle-1",
  }), "2")
  assert.equal(fixture.accounting.getPortfolio().getPosition({
    marketId: market.id,
    positionId: ownership.positionId,
  }).baseQuantity.amount, "5")
  assert.equal(fixture.store.records.at(-1).factType, "EXECUTION_FILL")
}

async function runRuntimeIntegrationScenario() {
  const fixture = await createIntegrationFixture()
  const result = await fixture.dispatch({
    symbol: "ZROUSDT",
    state: {
      prices: new Map([
        [
          "ZROUSDT",
          {
            symbol: "ZROUSDT",
            price: "2",
          },
        ],
      ]),
      paused: new Set(),
      durablePausedMarkets: new Set(),
      operatorPausedMarkets: new Set(),
    },
    isMarketPriceFresh: () => true,
    isStopping: () => false,
    hasBlockingOpenOrdersForSymbol: () => false,
    authorizeRecoverySellerAction: async ({ action }) => ({
      ok: true,
      data: {
        allowed: action.strategyId === "RS_recoverySeller",
      },
    }),
    submitRecoverySellerOrder: fixture.submitter.submit,
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.submitted, true)
  assert.ok(fixture.offlineBroker.getAcknowledgedOrder())
  assert.equal(fixture.submitter.unresolved.length, 0)
  assert.equal(fixture.accounting.getActiveOrders().length, 1)
  const order = fixture.offlineBroker.getAcknowledgedOrder()
  const ownership = fixture.accounting.getOrderRegistry().getOwnership({
    clientOrderId: order.clientOrderId,
  })
  assert.equal(ownership.strategyId, "RS_recoverySeller")
  assert.equal(ownership.purpose, "RECOVERY_BUY")
  assert.equal(ownership.cycleId, "integration-cycle-1")
  assert.deepEqual(fixture.store.records.map(({ factType }) => factType), [
    "ORDER_SUBMISSION_INTENT",
    "ORDER_SUBMISSION_OUTCOME",
  ])

  await assertAppliedBuyFill({
    fixture,
    order,
    ownership,
  })
  assert.equal(fixture.stopWorkflow.getStopState().status, "CLEAR")
}

test("composes RS runtime dispatch, durable submission, shared ownership and BUY-fill accounting offline", async () => {
  await runRuntimeIntegrationScenario()
})
