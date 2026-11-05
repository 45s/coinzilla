import test from "node:test"
import assert from "node:assert/strict"
import { summarizeHarvesterJournalHistory } from "./summarize-harvester-journal-history.js"

test("detects prior order and fill history across Journal sessions", () => {
  const result = summarizeHarvesterJournalHistory({
    records: [
      { id: "1", payload: { name: "harvester.started", source: "harvester" } },
      { id: "2", payload: { name: "order.submission_requested", source: "harvester" } },
      { id: "3", payload: { name: "order.cancel_requested", source: "harvester" } },
      { id: "4", payload: { name: "execution.fill_applied", source: "harvester" } },
      { id: "5", payload: { name: "account.snapshot_captured", source: "harvester" } },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.hasPriorTradingHistory, true)
  assert.equal(result.totalTradingEvents, 4)
  assert.equal(result.counts["account.snapshot_captured"], 1)
  assert.equal(result.counts["order.submission_requested"], 1)
  assert.equal(result.counts["order.cancel_requested"], 1)
  assert.equal(result.counts["execution.fill_applied"], 1)
})

test("detects a prior trading-enabled startup even without persisted order intents", () => {
  const result = summarizeHarvesterJournalHistory({
    records: [
      { id: "1", payload: { name: "harvester.started", source: "harvester", data: { tradingEnabled: true } } },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.hasPriorTradingHistory, true)
  assert.equal(result.counts["harvester.started"], 1)
})

test("allows a Journal containing only read-only startup events", () => {
  const result = summarizeHarvesterJournalHistory({
    records: [
      { id: "1", payload: { name: "harvester.started", source: "harvester", data: { tradingEnabled: false } } },
      { id: "2", payload: { name: "config.validated", source: "harvester" } },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.hasPriorTradingHistory, false)
  assert.equal(result.totalTradingEvents, 0)
})

test("requires recovery after a prior account snapshot even without order events", () => {
  const result = summarizeHarvesterJournalHistory({
    records: [
      { id: "1", payload: { name: "account.snapshot_captured", source: "harvester" } },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.hasPriorTradingHistory, true)
  assert.equal(result.counts["account.snapshot_captured"], 1)
})

test("fails closed for an invalid records input", () => {
  const result = summarizeHarvesterJournalHistory({ records: null })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be an array/)
})
