import assert from "node:assert/strict"
import nodeTest from "node:test"
import { Asset, CanonicalOrder, Market, Money, OrderRegistry, Quantity } from "@coinzilla/entities"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createOrderOwnership } from "../domain/orders/order-ownership.js"
import { createConservativeEngineOrderEventContext } from "./conservative-trading-engine.js"

const test = (...[name, ...args]) => nodeTest(`[conservative-engine-order-event-composition.test.js] ${name}`, ...args)
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

function createContext({ orderRegistry, reconcileTerminalMixedSell } = {}) {
  const noOperation = async () => ({ ok: true })
  return {
    state: {
      registry: orderRegistry,
      processedFillsByOrder: new Map(),
      reconciledTerminalOrderClientIds: new Set(),
    },
    pairs: [],
    dependencies: {
      broker: {
        getFills: async () => ({
          ok: true,
          data: [],
        }),
      },
      recoverySellerWorkflow: { reconcileTerminalMixedSell },
      recoverySellerStopWorkflow: { latch: noOperation },
      eventPublisher: { publish: noOperation },
      isStopping: () => false,
      logger: {},
      completeRecoveryCycle: noOperation,
      onUnownedExternalOrderObserved: noOperation,
    },
    pause: noOperation,
    processExecutionFillTransition: noOperation,
    ensureCancellationEligible: noOperation,
    processUserDataEventTransition: noOperation,
    publishDurableIntent: noOperation,
    cancelOrderWithOperationalState: noOperation,
    markCancellationUnknown: noOperation,
    markCancellationFailure: noOperation,
    publishOrderCancelled: noOperation,
    publishOrderCancelFailed: noOperation,
    runTransition: async ({ task }) => task(),
  }
}

test("wires terminal RS SELL reconciliation to the mixed ownership accounting workflow", async () => {
  const terminalOrder = new CanonicalOrder({
    clientOrderId: "rs-terminal-sell-1",
    brokerOrderId: "broker-rs-terminal-sell-1",
    market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status: "CANCELED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      purpose: "RECOVERY_SELL",
      cycleId: "rs-cycle-1",
    },
    clientOrderId: terminalOrder.clientOrderId,
    brokerOrderId: terminalOrder.brokerOrderId,
  })
  const orderRegistry = new OrderRegistry({
    orders: [terminalOrder],
    ownerships: [ownership],
  })
  let reconciled
  const context = createContext({
    orderRegistry,
    reconcileTerminalMixedSell: async (input) => {
      reconciled = input
      return {
        ok: true,
        data: { applied: true },
      }
    },
  })
  createConservativeEngineOrderEventContext({ context })

  const result = await context.reconcileTerminalOrderFills({ order: terminalOrder })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(reconciled?.order?.clientOrderId, terminalOrder.clientOrderId)
  assert.deepEqual(reconciled?.canonicalFills, [])
})
