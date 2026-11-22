import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery-with-deferrals.js"

function record({ name, data, id = name }) {
  return {
    id,
    payload: {
      id,
      name,
      data,
    },
    position: {
      fileName: "session.jsonl",
      lineNumber: 1,
    },
  }
}

function closingOpenOrders() {
  return record({
    name: "account.open_orders_captured",
    data: {
      phase: "CLOSING",
      observedAt: 201,
      readiness: "READY",
      orderCount: 0,
      orders: [],
      blockReasons: [],
    },
  })
}

test("projects a CLOSING open-order snapshot in an active started Journal session", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record({
        name: "harvester.started",
        data: {
          tradingEnabled: true,
        },
      }),
      closingOpenOrders(),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.openOrderSnapshots.map(({ phase }) => phase), ["CLOSING"])
})

test("rejects a CLOSING open-order snapshot before the Journal session starts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [closingOpenOrders()],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /CLOSING open-order snapshot requires a started Journal session/)
})

test("rejects a CLOSING open-order snapshot after the Journal session has stopped", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record({
        name: "harvester.started",
        data: {
          tradingEnabled: true,
        },
      }),
      record({
        name: "harvester.stopped",
        data: {
          outcome: "success",
          reason: "graceful shutdown completed",
        },
      }),
      closingOpenOrders(),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /CLOSING open-order snapshot requires a started Journal session/)
})
