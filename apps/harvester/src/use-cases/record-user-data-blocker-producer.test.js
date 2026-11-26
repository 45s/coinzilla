import assert from "node:assert/strict"
import test from "node:test"
import { recordSafetyBlockerRaised } from "./record-safety-control-facts.js"

test("records the user-data producer on newly raised sticky blockers", async () => {
  let committedFact
  const operationalStateStore = {
    append: async (fact) => {
      committedFact = fact
      return {
        ok: true,
        data: { durable: true },
      }
    },
  }

  const result = await recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNTING_INTEGRITY_FAILURE",
    evidenceDigest: "a".repeat(64),
  })

  assert.equal(result.ok, true)
  assert.equal(
    committedFact.data.producer,
    "USER_DATA_EVENT_HANDLER",
    "Durable blocker facts need producer provenance for safe operator resolution.",
  )
})
