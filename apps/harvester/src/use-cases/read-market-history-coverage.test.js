import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-durable-facts-store.js"
import { recordMarketHistoryCoverage } from "./record-market-history-coverage.js"
import { readMarketHistoryCoverage } from "./read-market-history-coverage.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-coverage-read-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "history-coverage-read-test",
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

test("projects the latest durable coverage fact into the exact audit evidence contract", async (t) => {
  const operationalStateStore = await createStore(t)
  await recordMarketHistoryCoverage({ operationalStateStore, ...evidence() })
  await recordMarketHistoryCoverage({
    operationalStateStore,
    ...evidence({
      factId: "market-history-coverage:BTCUSDT:2",
      coveredFromTime: 1_699_999_900_000,
      verifiedAt: 1_700_000_200_000,
      evidenceDigest: "b".repeat(64),
    }),
  })
  const result = await readMarketHistoryCoverage({ operationalStateStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data, {
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    baselineFactId: "market-history-coverage:BTCUSDT:2",
    symbol: "BTCUSDT",
    coveredFromTime: 1_699_999_900_000,
    verifiedAt: 1_700_000_200_000,
    evidenceDigest: "b".repeat(64),
    verifiedBy: "operator:trader",
  })
})

test("does not borrow another market's history coverage", async (t) => {
  const operationalStateStore = await createStore(t)
  await recordMarketHistoryCoverage({ operationalStateStore, ...evidence() })
  const result = await readMarketHistoryCoverage({ operationalStateStore, symbol: "ETHUSDT" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /No durable history-coverage fact exists for ETHUSDT/)
})

test("refuses a missing or corrupt durable-fact store", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-history-coverage-read-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "history-coverage-read-test",
  })
  const result = await readMarketHistoryCoverage({ operationalStateStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
})


test("rejects a durable history-coverage sequence that narrows prior verified coverage", async () => {
  const operationalStateStore = {
    readAll: async () => ({
      ok: true,
      data: {
        records: [
          {
            factId: "coverage:btc:1",
            factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
            data: {
              symbol: "BTCUSDT",
              coveredFromTime: 100,
              verifiedAt: 200,
              evidenceDigest: "a".repeat(64),
              verifiedBy: "operator:trader",
            },
          },
          {
            factId: "coverage:btc:2",
            factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
            data: {
              symbol: "BTCUSDT",
              coveredFromTime: 150,
              verifiedAt: 300,
              evidenceDigest: "b".repeat(64),
              verifiedBy: "operator:trader",
            },
          },
        ],
      },
    }),
  }
  const result = await readMarketHistoryCoverage({ operationalStateStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /narrows the verified history window/)
})


test("rejects invalid read ports, symbols, and malformed record collections", async () => {
  const missingPort = await readMarketHistoryCoverage({ operationalStateStore: {}, symbol: "BTCUSDT" })
  assert.equal(missingPort.ok, false, "A missing durable-fact read port must be rejected before history coverage is returned.")
  assert.match(missingPort.errors[0].message, /durable-fact read port/, "The error must identify the required durable-fact read capability.")

  const invalidSymbol = await readMarketHistoryCoverage({
    operationalStateStore: { readAll: async () => ({ ok: true, data: { records: [] } }) },
    symbol: "btcusdt",
  })
  assert.equal(invalidSymbol.ok, false, "A non-canonical market symbol must not be used to read durable coverage.")
  assert.match(invalidSymbol.errors[0].message, /canonical uppercase/, "The error must identify the canonical market-symbol requirement.")

  const malformedRecords = await readMarketHistoryCoverage({
    operationalStateStore: { readAll: async () => ({ ok: true, data: { records: null } }) },
    symbol: "BTCUSDT",
  })
  assert.equal(malformedRecords.ok, false, "A malformed durable record collection must fail the coverage read.")
  assert.match(malformedRecords.errors[0].message, /records array/, "The error must identify the required records array in the durable read result.")
})

test("rejects a durable history-coverage sequence with a regressing verification timestamp", async () => {
  const operationalStateStore = {
    readAll: async () => ({
      ok: true,
      data: {
        records: [
          {
            factId: "coverage:btc:1",
            factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
            data: {
              symbol: "BTCUSDT",
              coveredFromTime: 100,
              verifiedAt: 200,
              evidenceDigest: "a".repeat(64),
              verifiedBy: "operator:trader",
            },
          },
          {
            factId: "coverage:btc:2",
            factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
            data: {
              symbol: "BTCUSDT",
              coveredFromTime: 100,
              verifiedAt: 150,
              evidenceDigest: "b".repeat(64),
              verifiedBy: "operator:trader",
            },
          },
        ],
      },
    }),
  }
  const result = await readMarketHistoryCoverage({ operationalStateStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, false, "A durable coverage history with a regressing verification time must be rejected.")
  assert.match(result.errors[0].message, /verification timestamp regresses/, "The failure must identify the non-monotonic verification timestamp.")
})
