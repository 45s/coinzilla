import assert from "node:assert/strict"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-durable-facts-store.js"
import { recordConfigurationBaseline } from "./record-configuration-baseline.js"
import { recordProcessStarted } from "./record-process-started.js"
import { recordProcessStopped } from "./record-process-stopped.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-facts-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "process-facts-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}
const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
      pairs: {
        ETHUSDT: { enabled: false, investment: 100, minProfit: 0.01 },
        BTCUSDT: { enabled: true, investment: 250, minProfit: 0.02 },
      },
    },
  },
}

test("records a deterministic non-secret configuration fingerprint and market set", async (t) => {
  const operationalStateStore = await createStore(t)
  const first = await recordConfigurationBaseline({ operationalStateStore, appConfig })
  const duplicate = await recordConfigurationBaseline({ operationalStateStore, appConfig })

  assert.equal(first.ok, true, first.errors?.[0]?.message)
  assert.equal(first.data.durable, true)
  assert.match(first.data.fingerprint, /^[0-9a-f]{64}$/)
  assert.deepEqual(first.data.markets, ["BTCUSDT", "ETHUSDT"])
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.duplicate, true, "The same canonical configuration baseline must be idempotent.")

  const changedConfig = structuredClone(appConfig)
  changedConfig.strategies.CG_coinGrabber.pairs.BTCUSDT.investment = 300
  const changed = await recordConfigurationBaseline({ operationalStateStore, appConfig: changedConfig })
  assert.equal(changed.ok, true)
  assert.notEqual(changed.data.fingerprint, first.data.fingerprint, "A decision-affecting configuration change must produce a new immutable baseline.")
})

test("binds process start and clean/unclean stop facts to the durable store runtime session", async (t) => {
  const operationalStateStore = await createStore(t)
  const baseline = await recordConfigurationBaseline({ operationalStateStore, appConfig })
  const started = await recordProcessStarted({
    operationalStateStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  const stopped = await recordProcessStopped({
    operationalStateStore,
    reason: "SHUTDOWN_COMPLETED",
    clean: true,
  })

  assert.equal(started.ok, true, started.errors?.[0]?.message)
  assert.equal(started.data.durable, true)
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  assert.equal(stopped.data.durable, true)
  const all = await operationalStateStore.readAll()
  const processFacts = all.data.records.filter(({ factType }) => factType.startsWith("PROCESS_"))
  assert.deepEqual(processFacts.map(({ factType }) => factType), ["PROCESS_STARTED", "PROCESS_STOPPED"])
  assert.ok(processFacts.every(({ runtimeSessionId }) => runtimeSessionId === "process-facts-test-session"))
  assert.equal(processFacts[1].data.clean, true)
})

test("rejects malformed process-boundary and configuration-baseline facts", async (t) => {
  const operationalStateStore = await createStore(t)
  const fingerprint = "a".repeat(64)
  const invalidFacts = [
    {
      factId: "configuration-baseline:" + fingerprint,
      factType: "CONFIGURATION_BASELINE",
      data: { schemaVersion: 1, strategyName: "CG_coinGrabber", markets: ["ETHUSDT", "BTCUSDT"], fingerprint },
    },
    {
      factId: "configuration-baseline:" + fingerprint,
      factType: "CONFIGURATION_BASELINE",
      data: { schemaVersion: 1, strategyName: "CG_coinGrabber", markets: ["BTCUSDT"], fingerprint, apiToken: "must-not-persist" },
    },
    {
      factId: "process-started:wrong-session",
      factType: "PROCESS_STARTED",
      data: { configurationFingerprint: fingerprint, strategyName: "CG_coinGrabber", markets: ["BTCUSDT"] },
    },
    {
      factId: "process-stopped:process-facts-test-session",
      factType: "PROCESS_STOPPED",
      data: { reason: "SHUTDOWN_COMPLETED", clean: "true" },
    },
  ]
  for (const fact of invalidFacts) {
    const result = await operationalStateStore.append(fact)
    assert.equal(result.ok, false, "Malformed or mismatched process facts must fail closed.")
  }
})

test("rejects process boundaries that are not tied to the store runtime session", async (t) => {
  const operationalStateStore = await createStore(t)
  const result = await recordProcessStopped({
    operationalStateStore: { ...operationalStateStore, runtimeSessionId: "another-session" },
    reason: "SHUTDOWN_COMPLETED",
    clean: true,
  })

  assert.equal(result.ok, false)
})
