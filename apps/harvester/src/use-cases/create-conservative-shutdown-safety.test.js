import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createConservativeShutdownSafety } from "./create-conservative-shutdown-safety.js"

const test = (name, ...args) => nodeTest("[create-conservative-shutdown-safety.test.js] " + name, ...args)

function createState() {
  return {
    registry: {
      orders: [],
      getActiveOrders: () => [],
    },
    replacementIntents: new Map(),
    trailingBuyRepriceIntents: new Map(),
    shutdownRecoveryReplanSymbols: new Set(),
    recoveryManagedPausedMarkets: new Set(),
    completedRecoverySellSymbols: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    deferredEvaluations: new Set(),
  }
}

test("does not treat an external/manual open order as a Conservative-owned shutdown blocker", async () => {
  const state = createState()
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition: ({ task }) => task(),
    // External-order policy may block new strategy actions, but shutdown
    // ownership rules must not adopt, cancel, or require an external order.
    hasBlockingOpenOrdersForSymbol: () => true,
  })

  safety.beginShutdown()
  const result = await safety.auditShutdownSafety({
    symbol: "BTCUSDT",
    reconciliationComplete: true,
    journalDurable: true,
    coverageResult: {
      ok: true,
      data: {
        covered: true,
        symbols: ["BTCUSDT"],
        findings: [],
      },
    },
  })

  assert.equal(result.ok, true, "Expected result.ok to equal true in \"does not treat an external/manual open order as a Conservative-owned shutdown blocker\".")
  assert.equal(
    result.data.markets[0].status,
    "SAFE_TO_SHUTDOWN",
    "A market with no owned unresolved orders may be safe even when an unrelated manual order remains external.",
  )
})
