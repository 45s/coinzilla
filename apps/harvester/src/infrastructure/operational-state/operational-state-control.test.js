import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "./create-file-operational-state-store.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-control-facts-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "control-facts-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The control-fact fixture must explicitly initialize its isolated ledger.")
  return store
}

const evidenceDigest = "a".repeat(64)
const blockerIdFor = ({ scope = "MARKET", symbol = "BTCUSDT", reason = "UNOWNED_EXECUTION", evidenceDigest: digest = evidenceDigest } = {}) =>
  createHash("sha256").update([scope, symbol ?? "", reason, digest].join("\0")).digest("hex")

test("accepts canonical operator and strategy market pause/resume facts", async (t) => {
  const store = await createStore(t)
  const facts = [
    {
      factId: "operator-control:telegram-request-1",
      factType: "OPERATOR_MARKET_PAUSED",
      data: { requestId: "telegram-request-1", actorId: "telegram-actor-1", symbol: "BTCUSDT" },
    },
    {
      factId: "operator-control:telegram-request-2",
      factType: "OPERATOR_MARKET_RESUMED",
      data: { requestId: "telegram-request-2", actorId: "telegram-actor-1", symbol: "BTCUSDT" },
    },
    {
      factId: "strategy-market-paused:runtime-1:1",
      factType: "STRATEGY_MARKET_PAUSED",
      data: { symbol: "ETHUSDT", reason: "ACKNOWLEDGED_FILL_IDENTITY_MISMATCH" },
    },
    {
      factId: "strategy-market-resumed:runtime-1:2",
      factType: "STRATEGY_MARKET_RESUMED",
      data: { symbol: "ETHUSDT", reason: "AUTHORITATIVE_RECONCILIATION_COMPLETED" },
    },
  ]
  for (const fact of facts) {
    const result = await store.append(fact)
    assert.equal(result.ok, true, "A canonical control fact must be accepted: " + fact.factType)
    assert.equal(result.data.durable, true, "A control fact must receive an explicit durable acknowledgement.")
  }
})

test("rejects malformed operator and strategy control facts", async (t) => {
  const store = await createStore(t)
  const invalidFacts = [
    {
      factId: "operator-control:request-1",
      factType: "OPERATOR_MARKET_PAUSED",
      data: { requestId: "request-1", actorId: "actor-1", symbol: "btcUSDT" },
    },
    {
      factId: "operator-control:request-2",
      factType: "OPERATOR_MARKET_RESUMED",
      data: { requestId: "request-2", actorId: "actor-1", symbol: "BTCUSDT", credentialLabel: "must-not-persist" },
    },
    {
      factId: "operator-control:wrong-request",
      factType: "OPERATOR_MARKET_PAUSED",
      data: { requestId: "request-3", actorId: "actor-1", symbol: "BTCUSDT" },
    },
    {
      factId: "strategy-market-paused:runtime-1:3",
      factType: "STRATEGY_MARKET_PAUSED",
      data: { symbol: "BTCUSDT", reason: "SAFETY_PAUSE", ignored: true },
    },
    {
      factId: "strategy-market-resumed:runtime-1:4",
      factType: "STRATEGY_MARKET_RESUMED",
      data: { symbol: "btcUSDT", reason: "RECONCILED" },
    },
  ]
  for (const fact of invalidFacts) {
    const result = await store.append(fact)
    assert.equal(result.ok, false, "Malformed control fact " + fact.factId + " must be rejected.")
  }
})

test("accepts a sticky market safety blocker and a separate evidence-backed resolution", async (t) => {
  const store = await createStore(t)
  const blockerId = blockerIdFor()
  const raised = await store.append({
    factId: "safety-blocker-raised:" + blockerId,
    factType: "SAFETY_BLOCKER_RAISED",
    data: {
      blockerId,
      scope: "MARKET",
      symbol: "BTCUSDT",
      reason: "UNOWNED_EXECUTION",
      evidenceDigest,
    },
  })
  const resolved = await store.append({
    factId: "safety-blocker-resolved:" + blockerId,
    factType: "SAFETY_BLOCKER_RESOLVED",
    data: {
      blockerId,
      resolvedBy: "operator:trader",
      resolution: "AUTHORITATIVE_RECONCILIATION",
      evidenceDigest: "b".repeat(64),
    },
  })

  assert.equal(raised.ok, true, "A market-scoped safety blocker with immutable evidence identity must be accepted.")
  assert.equal(raised.data.durable, true, "A raised blocker must be durably acknowledged.")
  assert.equal(resolved.ok, true, "A blocker resolution must be a separate typed fact.")
  assert.equal(resolved.data.durable, true, "A blocker resolution must be durably acknowledged.")
})

test("rejects safety blockers with invalid scope, evidence, identity, or resolution classification", async (t) => {
  const store = await createStore(t)
  const validId = blockerIdFor()
  const invalidFacts = [
    {
      factId: "safety-blocker-raised:" + validId,
      factType: "SAFETY_BLOCKER_RAISED",
      data: { blockerId: validId, scope: "GLOBAL", symbol: "BTCUSDT", reason: "UNOWNED_EXECUTION", evidenceDigest },
    },
    {
      factId: "safety-blocker-raised:" + validId,
      factType: "SAFETY_BLOCKER_RAISED",
      data: { blockerId: validId, scope: "ACCOUNT", symbol: "BTCUSDT", reason: "UNOWNED_EXECUTION", evidenceDigest },
    },
    {
      factId: "safety-blocker-raised:" + validId,
      factType: "SAFETY_BLOCKER_RAISED",
      data: { blockerId: validId, scope: "MARKET", symbol: "BTCUSDT", reason: "unowned execution", evidenceDigest },
    },
    {
      factId: "safety-blocker-raised:" + validId,
      factType: "SAFETY_BLOCKER_RAISED",
      data: { blockerId: validId, scope: "MARKET", symbol: "BTCUSDT", reason: "UNOWNED_EXECUTION", evidenceDigest: "not-a-digest" },
    },
    {
      factId: "safety-blocker-resolved:" + validId,
      factType: "SAFETY_BLOCKER_RESOLVED",
      data: { blockerId: validId, resolvedBy: "operator:trader", resolution: "AUTOMATIC_RESTART", evidenceDigest },
    },
    {
      factId: "safety-blocker-resolved:" + validId,
      factType: "SAFETY_BLOCKER_RESOLVED",
      data: { blockerId: validId, resolvedBy: "operator:trader", resolution: "OPERATOR_ACTION", evidenceDigest, note: "extra" },
    },
  ]
  for (const fact of invalidFacts) {
    const result = await store.append(fact)
    assert.equal(result.ok, false, "Invalid safety blocker fact " + fact.factId + " must fail closed.")
  }
})
