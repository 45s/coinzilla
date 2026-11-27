import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createOperationalStateCallbacks } from "./harvester-operational-state-callbacks.js"

const test = (...args) => nodeTest(
  `[harvester-operational-state-callbacks.test.js] ${args[0]}`,
  ...args.slice(1),
)

test("assigns monotonic runtime-scoped transition identities to market pause callbacks", async () => {
  const transitions = []
  const callbacks = createOperationalStateCallbacks({
    operationalStateStore: {
      runtimeSessionId: "runtime-test",
    },
    recordStrategyMarketControl: async (transition) => {
      transitions.push(transition)
      return {
        ok: true,
        data: {
          durable: true,
        },
      }
    },
  })

  await callbacks.onOperationalStateStrategyMarketPaused({
    symbol: "BTCUSDT",
    reason: "TEST",
  })
  await callbacks.onOperationalStateStrategyMarketPaused({
    symbol: "ETHUSDT",
    reason: "TEST",
  })

  assert.deepEqual(
    transitions.map(({ transitionId }) => transitionId),
    [
      "runtime-test:1",
      "runtime-test:2",
    ],
    "Each market pause must receive a unique, increasing transition ID scoped to the runtime session.",
  )
  assert.deepEqual(
    transitions.map(({ symbol }) => symbol),
    [
      "BTCUSDT",
      "ETHUSDT",
    ],
    "The callback must preserve the market associated with each durable pause transition.",
  )
})
