import assert from "node:assert/strict"
import test from "node:test"
import { readTelegramOperatorPage } from "./telegram-operator-pages.js"

function createPageDependencies({ operator = {} } = {}) {
  const diagnostics = {
    failures: [],
    reports: [],
    fail(request) { this.failures.push(request) },
    report(request) { this.reports.push(request) },
    describeError: error => ({ message: error.message }),
  }
  const logEntries = []
  return {
    diagnostics,
    logEntries,
    dependencies: {
      operator,
      diagnostics,
      logStage: entry => logEntries.push(entry),
      buildNavigationKeyboard: ({ page } = {}) => ({ page }),
    },
  }
}

test("reads a status page through the authorized read-only application query", async () => {
  const calls = []
  const fixture = createPageDependencies({
    operator: {
      getStatus: async request => {
        calls.push(request)
        return {
          ok: true,
          data: {
            runtimeState: "RUNNING",
            broker: "binance",
            strategyMode: "conservative",
            tradingMode: "testnet",
            tradingEnabled: true,
            observedAt: 1700000000000,
          },
        }
      },
    },
  })
  const page = await readTelegramOperatorPage({
    page: "status",
    userId: "123",
    interaction: {},
    ...fixture.dependencies,
  })
  assert.equal(
    calls.length,
    1,
    "A status page must execute exactly one read-only application query.",
  )
  assert.deepEqual(
    calls[0].actor,
    { id: "telegram-user:123", roles: ["trading-operator"] },
    "The read query must receive the authenticated trading-operator actor.",
  )
  assert.match(
    page.text,
    /Harvester status/,
    "The status response must be formatted from the application-owned status snapshot.",
  )
  assert.deepEqual(
    page.keyboard,
    { page: "status" },
    "The page must use the navigation keyboard for the selected query.",
  )
})

test("returns an unavailable page when the requested query is not provided", async () => {
  const fixture = createPageDependencies()
  const page = await readTelegramOperatorPage({
    page: "orders",
    userId: "123",
    interaction: {},
    ...fixture.dependencies,
  })
  assert.match(
    page.text,
    /query is not available/,
    "A missing application query must be reported as unavailable instead of throwing.",
  )
  assert.equal(
    fixture.diagnostics.reports.length,
    1,
    "An unavailable query must emit one structured diagnostic.",
  )
})

test("does not hide a failed application query behind a successful page", async () => {
  const fixture = createPageDependencies({
    operator: {
      getOrders: async () => ({ ok: false, errors: [{ code: "ORDERS_READ_FAILED" }] }),
    },
  })
  const page = await readTelegramOperatorPage({
    page: "orders",
    userId: "123",
    interaction: {},
    ...fixture.dependencies,
  })
  assert.match(
    page.text,
    /Unable to read the Harvester order snapshot/,
    "A rejected read query must produce the explicit unavailable-data response.",
  )
  assert.equal(
    fixture.diagnostics.failures.length,
    1,
    "A failed application result must be preserved in diagnostics.",
  )
})
