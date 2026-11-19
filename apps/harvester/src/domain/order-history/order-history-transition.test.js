import assert from "node:assert/strict"
import test from "node:test"
import { mergeOrderHistoryRecords } from "./order-history-transition.js"
import { createOrderHistoryRecordFixture } from "../../../test-support/order-history-fixtures.js"

test("advances one partial-fill record to FILLED while preserving its first-seen evidence", () => {
  const current = createOrderHistoryRecordFixture()
  const candidate = createOrderHistoryRecordFixture({
    executedQuantity: "1.0000",
    remainingQuantity: "0.0000",
    status: "FILLED",
    updatedAt: 200,
    lastSeenAt: "2026-11-19T00:00:02.000Z",
    lastSourceEventId: "event-002",
    lastSourceEventName: "order.updated",
    lastSourceEventTimestamp: "2026-11-19T00:00:02.000Z",
  })
  const merged = mergeOrderHistoryRecords({
    current,
    candidate,
  })

  assert.equal(merged.id, current.id, "A later fill must update the original order row.")
  assert.equal(merged.executedQuantity, "1.0000", "Cumulative execution must advance without numeric conversion.")
  assert.equal(merged.status, "FILLED", "The final canonical order status must be retained.")
  assert.equal(merged.firstSeenAt, current.firstSeenAt, "Upserts must preserve the first-seen timestamp.")
  assert.equal(merged.firstSourceEventId, current.firstSourceEventId, "Upserts must preserve the first source event.")
  assert.equal(merged.lastSourceEventId, "event-002", "Upserts must retain the newest applied source event.")
})

test("ignores a stale event that would regress cumulative execution", () => {
  const current = createOrderHistoryRecordFixture({
    executedQuantity: "0.5000",
    remainingQuantity: "0.5000",
    updatedAt: 200,
  })
  const stale = createOrderHistoryRecordFixture({
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    status: "PARTIALLY_FILLED",
    updatedAt: 150,
    lastSourceEventId: "stale-event",
  })

  assert.equal(
    mergeOrderHistoryRecords({ current, candidate: stale }),
    current,
    "Out-of-order event delivery must never reduce the stored executed quantity.",
  )
})

test("rejects conflicting immutable order facts under the same composite identity", () => {
  const current = createOrderHistoryRecordFixture()
  const conflicting = createOrderHistoryRecordFixture({
    market: {
      ...current.market,
      symbol: "ETHUSDT",
    },
    symbol: "ETHUSDT",
    id: current.id,
  })

  assert.throws(
    () => mergeOrderHistoryRecords({
      current,
      candidate: conflicting,
    }),
    (error) => error.code === "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT",
    "A reused provider/account/client-order identity must not silently overwrite another order.",
  )
})
