import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { recordMarketHistoryCoverage } from "./record-market-history-coverage.js"
import { readMarketHistoryCoverage } from "./read-market-history-coverage.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-coverage-read-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
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
  const durableFactsStore = await createStore(t)
  await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })
  await recordMarketHistoryCoverage({
    durableFactsStore,
    ...evidence({
      factId: "market-history-coverage:BTCUSDT:2",
      coveredFromTime: 1_699_999_900_000,
      verifiedAt: 1_700_000_200_000,
      evidenceDigest: "b".repeat(64),
    }),
  })
  const result = await readMarketHistoryCoverage({ durableFactsStore, symbol: "BTCUSDT" })

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
  const durableFactsStore = await createStore(t)
  await recordMarketHistoryCoverage({ durableFactsStore, ...evidence() })
  const result = await readMarketHistoryCoverage({ durableFactsStore, symbol: "ETHUSDT" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /No durable history-coverage fact exists for ETHUSDT/)
})

test("refuses a missing or corrupt durable-fact store", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-history-coverage-read-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const durableFactsStore = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "history-coverage-read-test",
  })
  const result = await readMarketHistoryCoverage({ durableFactsStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
})


test("rejects a durable history-coverage sequence that narrows prior verified coverage", async () => {
  const durableFactsStore = {
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
  const result = await readMarketHistoryCoverage({ durableFactsStore, symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /narrows the verified history window/)
})
