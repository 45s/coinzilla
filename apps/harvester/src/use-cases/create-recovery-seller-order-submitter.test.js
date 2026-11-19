import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  CanonicalOrder,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerOrderSubmitter } from "./create-recovery-seller-order-submitter.js"

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
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
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

function createSharedState() {
  return {
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: OrderRegistry.empty(),
    legacyPositions: new Map(),
    updateQueue: Promise.resolve(),
  }
}

function createAcknowledgedOrder({ order }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: "broker-rs-1",
    providerInstanceId: "binance-testnet-primary",
    providerType: "binance",
    accountId: "harvester-testnet",
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
}

function createSubmitter({ sharedState, broker, unresolved } = {}) {
  const workflow = createRecoverySellerAccountingWorkflow({
    sharedState,
  })
  const durableFacts = []
  const submit = createRecoverySellerOrderSubmitter({
    broker,
    recoverySellerAccountingWorkflow: workflow,
    onDurableSubmissionIntent: async (fact) => {
      durableFacts.push({
        type: "INTENT",
        fact,
      })
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onDurableSubmissionOutcome: async (fact) => {
      durableFacts.push({
        type: "OUTCOME",
        fact,
      })
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onUnresolvedSubmission: async (fact) => {
      unresolved.push(fact)
      return {
        ok: true,
        data: { durable: true },
      }
    },
    canSubmit: () => true,
  })
  return {
    submit,
    workflow,
    durableFacts,
  }
}

function createAction() {
  return {
    side: "BUY",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
    type: "LIMIT_MAKER",
    price: "1.999",
    quantity: "5",
  }
}

function createBroker({ onPlaceOrder, placeOrderFailure } = {}) {
  return {
    providerInstanceId: "binance-testnet-primary",
    providerType: "binance",
    accountId: "harvester-testnet",
    placeOrder: async ({ order }) => {
      onPlaceOrder?.({ order })
      if (placeOrderFailure) {
        throw new Error("broker acknowledgement timed out")
      }
      return {
        ok: true,
        data: createAcknowledgedOrder({ order }),
      }
    },
  }
}

test("submits one RS order through the shared executor and registers immutable RS ownership", async () => {
  const sharedState = createSharedState()
  const unresolved = []
  let pendingWasRegisteredBeforeBroker = false
  const broker = createBroker({
    onPlaceOrder: ({ order }) => {
      const registered = sharedState.orderRegistry.getOrder({
        clientOrderId: order.clientOrderId,
      })
      pendingWasRegisteredBeforeBroker = registered?.status === "PENDING"
    },
  })
  const { submit, workflow, durableFacts } = createSubmitter({
    sharedState,
    broker,
    unresolved,
  })

  const result = await submit({
    lifecycleDecision: {
      outcome: "SUBMIT",
      reasonCode: "BUY_TRANCHE_ELIGIBLE",
    },
    action: createAction(),
    marketMetadata,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.submitted, true)
  assert.equal(pendingWasRegisteredBeforeBroker, true)
  assert.equal(durableFacts.length, 2)
  assert.equal(unresolved.length, 0)
  assert.equal(workflow.getActiveOrders().length, 1)
  assert.deepEqual(
    workflow.getOrderRegistry().getOwnership({
      clientOrderId: result.data.submittedOrders[0].clientOrderId,
    }),
    {
      strategyId: "RS_recoverySeller",
      positionId: "rs-position-1",
      purpose: "RECOVERY_BUY",
      cycleId: "rs-cycle-1",
      brokerOrderId: "broker-rs-1",
    },
  )
})

test("retains an unknown RS submission and requires durable sticky STOP without retry", async () => {
  const sharedState = createSharedState()
  const unresolved = []
  const broker = createBroker({
    placeOrderFailure: true,
  })
  const { submit, workflow } = createSubmitter({
    sharedState,
    broker,
    unresolved,
  })

  const result = await submit({
    lifecycleDecision: {
      outcome: "SUBMIT",
      reasonCode: "BUY_TRANCHE_ELIGIBLE",
    },
    action: createAction(),
    marketMetadata,
  })

  assert.equal(result.ok, false)
  assert.equal(unresolved.length, 1)
  assert.equal(unresolved[0].outcome, "UNKNOWN")
  assert.equal(workflow.getActiveOrders()[0].status, "UNKNOWN")
  assert.equal(workflow.getActiveOrders().length, 1)
})

test("does not call the broker when the RS lifecycle decision is not SUBMIT", async () => {
  const sharedState = createSharedState()
  const unresolved = []
  let placeOrderCalls = 0
  const broker = createBroker({
    onPlaceOrder: () => {
      placeOrderCalls += 1
    },
  })
  const { submit } = createSubmitter({
    sharedState,
    broker,
    unresolved,
  })

  const result = await submit({
    lifecycleDecision: {
      outcome: "BLOCK",
      reasonCode: "MARKET_PAUSED",
    },
    action: undefined,
    marketMetadata,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.submitted, false)
  assert.equal(placeOrderCalls, 0)
})
