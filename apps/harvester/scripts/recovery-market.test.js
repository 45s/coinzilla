import test from "node:test"
import assert from "node:assert/strict"
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
