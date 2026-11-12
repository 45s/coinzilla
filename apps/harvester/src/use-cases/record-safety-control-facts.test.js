import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import {
  recordSafetyBlockerRaised,
  recordSafetyBlockerResolved,
  recordStrategyMarketControl,
} from "./record-safety-control-facts.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-safety-recorders-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "safety-recorders-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The safety-recorder fixture must explicitly initialize its isolated ledger.")
  return store
}

test("records strategy pause/resume transitions with distinct durable identities", async (t) => {
  const durableFactsStore = await createStore(t)
  const strategyPause = await recordStrategyMarketControl({
    durableFactsStore, action: "PAUSE", transitionId: "session-1:1", symbol: "ETHUSDT", reason: "FILL_RECONCILIATION_FAILED",
  })
  const strategyResume = await recordStrategyMarketControl({
    durableFactsStore, action: "RESUME", transitionId: "session-1:2", symbol: "ETHUSDT", reason: "AUTHORITATIVE_RECONCILIATION_COMPLETED",
  })

  assert.equal(strategyPause.ok, true, "A strategy pause transition must be durably recorded.")
  assert.equal(strategyResume.ok, true, "A strategy resume transition must be durably recorded.")
  const read = await durableFactsStore.readAll()
  assert.deepEqual(
    read.data.records.slice(-2).map(({ factType }) => factType),
    ["STRATEGY_MARKET_PAUSED", "STRATEGY_MARKET_RESUMED"],
    "The fact stream must preserve each explicit strategy control transition in order.",
  )
})

test("records a sticky safety blocker and resolves it only after a committed raise with explicit evidence", async (t) => {
  const durableFactsStore = await createStore(t)
  const raised = await recordSafetyBlockerRaised({
    durableFactsStore,
    scope: "MARKET",
    symbol: "BTCUSDT",
    reason: "UNOWNED_EXECUTION",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, "The triggering safety evidence must be committed before a blocker is considered durable.")
  const blockerId = raised.data.record.data.blockerId
  const resolved = await recordSafetyBlockerResolved({
    durableFactsStore,
    blockerId,
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "b".repeat(64),
  })
  assert.equal(resolved.ok, true, "A blocker may be resolved only by a separate evidence-backed resolution fact.")
  assert.equal(resolved.data.record.data.blockerId, blockerId)
  const duplicate = await recordSafetyBlockerResolved({
    durableFactsStore,
    blockerId,
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "b".repeat(64),
  })
  assert.equal(duplicate.ok, true, "Retrying an exact resolution after an uncertain acknowledgement must be idempotent.")
  assert.equal(duplicate.data.duplicate, true, "An exact resolution retry must reuse its immutable fact identity.")
})

test("refuses to resolve an absent safety blocker or accept an implicit restart resolution", async (t) => {
  const durableFactsStore = await createStore(t)
  const absent = await recordSafetyBlockerResolved({
    durableFactsStore,
    blockerId: "c".repeat(64),
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "d".repeat(64),
  })
  assert.equal(absent.ok, false, "A resolution without a committed raised blocker must be rejected.")
  const raised = await recordSafetyBlockerRaised({
    durableFactsStore,
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNTING_INTEGRITY_FAILURE",
    evidenceDigest: "e".repeat(64),
  })
  assert.equal(raised.ok, true, "The account-level blocker fixture must be recorded.")
  const implicit = await recordSafetyBlockerResolved({
    durableFactsStore,
    blockerId: raised.data.record.data.blockerId,
    resolvedBy: "process-restart",
    resolution: "PROCESS_RESTART",
    evidenceDigest: "f".repeat(64),
  })
  assert.equal(implicit.ok, false, "A process restart must never be accepted as a blocker-resolution action.")
})

test("does not initialize a missing durable-fact store for safety controls", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-safety-recorders-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const durableFactsStore = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "safety-recorders-test-session",
  })
  const result = await recordOperatorMarketControl({
    durableFactsStore, action: "PAUSE", requestId: "request-1", actorId: "actor-1", symbol: "BTCUSDT",
  })
  assert.equal(result.ok, false, "Safety recorders must never initialize a missing ledger.")
})
