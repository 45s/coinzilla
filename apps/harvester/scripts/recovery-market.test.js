import test from "node:test"
import assert from "node:assert/strict"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createFileDurableFactsStore } from "../src/infrastructure/durable-facts/create-file-durable-facts-store.js"
import {
  parseRecoveryMarketArguments,
  runRecoveryMarketCommand,
} from "./recovery-market.js"

const context = {
  symbol: "LINKUSDT",
  runtimeSessionId: "offline-cli-test",
  journalRecords: [],
  markets: [{
    venue: "BINANCE",
    symbol: "LINKUSDT",
    baseAsset: { id: "binance:LINK", code: "LINK" },
    quoteAsset: { id: "binance:USDT", code: "USDT" },
  }],
  coverage: {
    coveredFromTime: 100,
    verifiedAt: 200,
    evidenceDigest: "a".repeat(64),
    verifiedBy: "operator-review",
  },
  exchange: {
    currentAccountSnapshot: { sourceTime: 300, balances: [] },
    openOrders: [],
    ownedOrderHistory: [],
    tradeHistory: {
      fills: [],
      historyPagesComplete: true,
      marketHistoryPagesComplete: true,
      historyScope: "MARKET",
      marketsQueried: ["LINKUSDT"],
      historyStartTime: 100,
      marketUniverseComplete: false,
    },
  },
}

const readyContext = {
  ...context,
  journalRecords: [
    {
      position: { fileName: "legacy/session" },
      payload: {
        source: "harvester",
        name: "account.snapshot_captured",
        data: {
          phase: "PREFLIGHT",
          sourceTime: 100,
          auditStatus: "COMPLETE",
          auditReasons: [],
          balances: [
            { asset: "LINK", free: "0", locked: "0", total: "0" },
            { asset: "USDT", free: "100", locked: "0", total: "100" },
          ],
        },
      },
    },
    {
      position: { fileName: "legacy/session" },
      payload: {
        source: "harvester",
        name: "harvester.started",
        data: { tradingEnabled: true },
      },
    },
  ],
  exchange: {
    ...context.exchange,
    currentAccountSnapshot: {
      sourceTime: 300,
      balances: [
        { assetId: "binance:LINK", asset: "LINK", free: "0", locked: "0" },
        { assetId: "binance:USDT", asset: "USDT", free: "100", locked: "0" },
      ],
    },
  },
}

test("CLI argument parser requires a context and accepts explicit confirmation", () => {
  assert.deepEqual(
    parseRecoveryMarketArguments(["--context", "evidence.json", "--confirm"]),
    { confirm: true, help: false, contextPath: "evidence.json" },
  )
  assert.throws(() => parseRecoveryMarketArguments([]), /--context is required/)
  assert.throws(() => parseRecoveryMarketArguments(["--context"]), /requires a file path/)
  assert.throws(() => parseRecoveryMarketArguments(["--context", "a", "--context", "b"]), /must not be repeated/)
  assert.throws(() => parseRecoveryMarketArguments(["--live"]), /Unknown recovery CLI argument/)
})

test("CLI runs an audit-only offline context without requiring exchange credentials or durable-store writes", async () => {
  const output = []
  const errors = []
  const exitCode = await runRecoveryMarketCommand({
    args: ["--context", "evidence.json"],
    cwd: "/offline",
    env: {},
    readContext: async (filePath, encoding) => {
      assert.equal(filePath, "/offline/evidence.json")
      assert.equal(encoding, "utf8")
      return JSON.stringify(context)
    },
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  })

  assert.equal(exitCode, 2, "A skipped audit must not return a successful readiness exit code.")
  assert.equal(errors.length, 0, "A valid skipped audit is an operator-visible result, not a CLI execution error.")
  assert.equal(JSON.parse(output[0]).data.reconciliation.status, "SKIPPED")
})

test("CLI requires an absolute existing durable-fact directory only for explicit confirmation", async () => {
  const errors = []
  const exitCode = await runRecoveryMarketCommand({
    args: ["--context", "evidence.json", "--confirm"],
    cwd: "/offline",
    env: { DURABLE_FACTS_DIRECTORY: "relative/ledger" },
    readContext: async () => JSON.stringify(context),
    writeOutput: () => assert.fail("Confirmation with a relative ledger path must not run."),
    writeError: (value) => errors.push(value),
  })

  assert.equal(exitCode, 1, "Confirmation with a relative durable-fact directory must fail.")
  assert.match(errors[0], /absolute DURABLE_FACTS_DIRECTORY/)
})

test("CLI help is available without reading evidence or touching the durable-fact store", async () => {
  const output = []
  const exitCode = await runRecoveryMarketCommand({
    args: ["--help"],
    readContext: async () => assert.fail("Help must not read a context file."),
    writeOutput: (value) => output.push(value),
    writeError: () => assert.fail("Help must not emit an error."),
  })

  assert.equal(exitCode, 0)
  assert.match(output[0], /never connects to Binance/i)
  assert.match(output[0], /--confirm/)
})

test("CLI explicitly confirms a READY offline audit against an already initialized durable ledger", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "coinzilla-recovery-cli-confirm-"))
  try {
    const store = createFileDurableFactsStore({
      directory,
      runtimeSessionId: readyContext.runtimeSessionId,
    })
    const initialized = await store.initialize()
    assert.equal(initialized.ok, true)
    const output = []
    const exitCode = await runRecoveryMarketCommand({
      args: ["--context", "evidence.json", "--confirm"],
      env: { DURABLE_FACTS_DIRECTORY: directory },
      readContext: async () => JSON.stringify(readyContext),
      writeOutput: (value) => output.push(value),
      writeError: (value) => assert.fail(value),
    })

    assert.equal(exitCode, 0, "The explicit CLI confirmation must succeed only after a READY production audit and durable readback.")
    const result = JSON.parse(output[0])
    assert.equal(result.data.confirmation.confirmed, true)
    assert.equal(result.data.confirmation.alreadyConfirmed, false)
    const readback = await store.readAll()
    assert.equal(readback.ok, true)
    assert.equal(readback.data.records.filter((record) => record.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED").length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("CLI never initializes a missing durable-fact directory during confirmation", async () => {
  const directory = path.join(tmpdir(), "coinzilla-recovery-cli-missing-" + process.pid)
  const exitCode = await runRecoveryMarketCommand({
    args: ["--context", "evidence.json", "--confirm"],
    env: { DURABLE_FACTS_DIRECTORY: directory },
    readContext: async () => JSON.stringify(readyContext),
    writeOutput: () => assert.fail("A missing ledger must not produce a confirmation result."),
    writeError: () => {},
  })

  assert.equal(exitCode, 1, "The CLI must fail closed when the ledger has not been explicitly initialized.")
  await assert.rejects(access(directory), { code: "ENOENT" }, "The CLI must not create the missing ledger directory.")
})

