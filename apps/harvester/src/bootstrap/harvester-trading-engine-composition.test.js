import nodeTest from "node:test"
import assert from "node:assert/strict"
import {
  assertRecoverySellerRuntimeAcceptance,
  assertRecoverySellerEvaluatorConfigured,
  getHarvesterAccountSafetyBlocker,
} from "./harvester-trading-engine-composition.js"

const test = (...args) => nodeTest(
  `[harvester-trading-engine-composition.test.js] ${args[0]}`,
  ...args.slice(1),
)

test("rejects configured Recovery Seller routes before runtime acceptance", () => {
  assert.throws(
    () => assertRecoverySellerRuntimeAcceptance({
      recoverySellerPairs: {
        BTCUSDT: {},
      },
      acceptanceComplete: false,
    }),
    /RS-4 integration and RS-5 offline lifecycle acceptance/,
    "Configured Recovery Seller routes must stay disabled until their acceptance gates are complete.",
  )
})

test("requires a production evaluator for configured Recovery Seller routes", () => {
  assert.throws(
    () => assertRecoverySellerEvaluatorConfigured({
      recoverySellerPairs: {
        BTCUSDT: {},
      },
      evaluateRecoverySellerTransition: null,
    }),
    /production transition evaluator/,
    "Recovery Seller configuration must fail before broker connection when its evaluator is absent.",
  )
})

test("preserves account-wide reconciliation blockers", () => {
  const blocker = getHarvesterAccountSafetyBlocker({
    userDataState: {
      accountingFailed: true,
    },
  })

  assert.deepEqual(
    blocker,
    {
      scope: "ACCOUNT",
      reason: "USER_DATA_RECONCILIATION_REQUIRED",
      blockerId: null,
    },
    "A failed account reconciliation must continue to block the account independently of strategy-specific STOP state.",
  )
})
