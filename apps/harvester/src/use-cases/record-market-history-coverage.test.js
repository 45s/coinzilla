import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { recordMarketHistoryCoverage } from "./record-market-history-coverage.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-coverage-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "history-coverage-test",
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  })
  await store.initialize()
  return store
}

const evidence = (overrides = {}) => ({
  factId: "market-history-coverage:BTCUSDT:1",
  symbol: "BTCUSDT",
  coveredFromTime: 1_700_000_000_000,
  verifiedAt: 1_700_000_100_000,
  evidenceDigest: "a".repeat(64),
  verifiedBy: "operator:trader",
  ...overrides,
})

test("records a market-history coverage confirmation only after verifying the existing ledger", async (t) => {
  const durableFactsStore = await createStore(t)
  const result = await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.factType, "MARKET_HISTORY_COVERAGE_CONFIRMED")
  assert.equal(result.data.record.data.symbol, "BTCUSDT")
  assert.equal(result.data.record.data.evidenceDigest, "a".repeat(64))
})

test("rejects a later coverage fact that narrows the previously verified history window", async (t) => {
  const durableFactsStore = await createStore(t)
  assert.equal((await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })).ok, true)
  const result = await recordMarketHistoryCoverage({
    durableFactsStore,
    ...evidence({
      factId: "market-history-coverage:BTCUSDT:2",
      coveredFromTime: 1_700_000_050_000,
      verifiedAt: 1_700_000_200_000,
      evidenceDigest: "b".repeat(64),
    }),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must not narrow the verified history window/)
})

test("rejects a coverage verification timestamp that moves backwards", async (t) => {
  const durableFactsStore = await createStore(t)
  assert.equal((await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })).ok, true)
  const result = await recordMarketHistoryCoverage({
    durableFactsStore,
    ...evidence({
      factId: "market-history-coverage:BTCUSDT:2",
      coveredFromTime: 1_700_000_000_000,
      verifiedAt: 1_700_000_050_000,
      evidenceDigest: "b".repeat(64),
    }),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /verification timestamp must be monotonic/)
})

test("does not initialize a missing durable-fact store", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-history-coverage-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const durableFactsStore = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "history-coverage-test",
  })
  const result = await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })

  assert.equal(result.ok, false)
})


test("rejects malformed coverage evidence before calling the durable append port", async () => {
  const appendCalls = []
  const durableFactsStore = {
    append: async (fact) => {
      appendCalls.push(fact)
      return { ok: true, data: { durable: true } }
    },
  }
  const invalidCases = [
    [{ symbol: "btcusdt" }, /canonical uppercase/],
    [{ coveredFromTime: -1 }, /non-negative safe integers/],
    [{ verifiedAt: evidence().coveredFromTime - 1 }, /verifiedAt >= coveredFromTime/],
    [{ evidenceDigest: "not-a-digest" }, /SHA-256 digest/],
    [{ verifiedBy: " operator" }, /canonical non-empty string/],
  ]

  for (const [overrides, message] of invalidCases) {
    const result = await recordMarketHistoryCoverage({
      durableFactsStore,
      ...evidence(overrides),
    })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, message)
  }
  assert.equal(appendCalls.length, 0, "Invalid evidence must never reach the durable append boundary.")
})

test("returns durable append failures and converts thrown append errors into results", async () => {
  const appendError = new Error("append unavailable")
  const rejectedStore = { append: async () => ({ ok: false, errors: [appendError] }) }
  const rejected = await recordMarketHistoryCoverage({ durableFactsStore: rejectedStore, ...evidence() })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.errors[0], appendError)

  const thrownStore = { append: async () => { throw appendError } }
  const thrown = await recordMarketHistoryCoverage({ durableFactsStore: thrownStore, ...evidence() })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.errors[0], appendError)
})
