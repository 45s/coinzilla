import nodeTest from "node:test"
import assert from "node:assert/strict"
import { publishStrategyDecision } from "./publish-strategy-decision.js"

const test = (...args) => nodeTest(`[publish-strategy-decision.test.js] ${args[0]}`, ...args.slice(1))

function createRecoveryDecisionDependencies({ events } = {}) {
  return {
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return { ok: true }
      },
    },
    pairs: {
      DOGEUSDT: {
        keepQuantity: 1,
      },
    },
  }
}

function createQuantityIncrementDustContext() {
  return {
    decision: {
      strategy: "CONSERVATIVE",
      reason: "RESIDUAL_DUST",
      actions: [],
      inventoryDisposition: {
        status: "EXCHANGE_CONSTRAINED_DUST",
        reason: "QUANTITY_INCREMENT",
        quantity: "0.05",
        quantityStepSize: "0.1",
        evaluatedQuantity: "0",
        evaluatedNotional: "0.005",
        evaluatedPrice: "0.1",
      },
    },
    symbol: "DOGEUSDT",
    marketPrice: {
      price: "0.1",
      timestamp: 1234,
    },
    metadata: {
      metadataCapturedAt: 1000,
      metadataVersion: null,
      tradingRules: {
        constraints: [{
          type: "QUANTITY_INCREMENT",
          status: "SUPPORTED",
          value: {
            amount: "0.1",
            asset: {
              code: "DOGE",
            },
          },
        }],
      },
    },
    activeOrdersBefore: [],
    lastBuyPrice: null,
    recoveryLedgerBefore: {
      outstandingRecoveryAmount: "0",
    },
    portfolioBefore: {
      getPosition: () => ({
        baseQuantity: {
          amount: "1.05",
        },
      }),
    },
    effectiveActions: [],
  }
}

test("keeps residual notional distinct from a zero exchange-rounded candidate notional", () => {
  const events = []
  publishStrategyDecision({
    dependencies: createRecoveryDecisionDependencies({ events }),
    context: createQuantityIncrementDustContext(),
  })

  assert.equal(events.length, 1)
  const evidence = events[0].data.recoveryEvidence
  assert.equal(evidence.residualQuantity, "0.05")
  assert.equal(evidence.candidateQuantity, "0")
  assert.equal(evidence.candidateNotional, "0")
  assert.equal(evidence.residualNotional, "0.005")
  assert.equal(evidence.inventoryDisposition.evaluatedNotional, "0.005")
})
