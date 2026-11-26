import assert from "node:assert/strict"
import test from "node:test"
import { readTelegramOperatorPage, selectMarketsForAction } from "./pages.js"
import { createNavigationKeyboard } from "./keyboard.js"

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

function createStatusPageOperator({ calls } = {}) {
  return {
    getStatus: async (request) => {
      calls.push(request)
      return {
        ok: true,
        data: {
          runtimeState: "RUNNING",
          broker: "binance",
          strategyMode: "conservative",
          tradingMode: "testnet",
          tradingEnabled: true,
          readinessReport: {
            status: "DEGRADED",
            tradingGateOpen: false,
            runtimeBlockers: ["ACCOUNT_PREFLIGHT_NOT_DURABLE"],
            marketBlockers: [{ symbol: "BTCUSDT", blockers: ["MARKET_BOOK_UNAVAILABLE"] }],
            warnings: ["EXTERNAL_ORDERS_IGNORED_BY_POLICY"],
            summary: {
              readyMarkets: 1,
              enabledMarkets: 2,
              blockedMarkets: 1,
              warnings: 1,
            },
          },
          observedAt: 1700000000000,
        },
      }
    },
  }
}

test("reads a status page through the authorized read-only application query", async () => {
  const calls = []
  const fixture = createPageDependencies({
    operator: createStatusPageOperator({ calls }),
  })
  const page = await readTelegramOperatorPage({
    page: "status",
    userId: "123",
    interaction: {},
    ...fixture.dependencies,
  })
  assert.equal(calls.length, 1, "A status page must execute exactly one read-only application query.")
  assert.deepEqual(calls[0].actor, {
    id: "telegram-user:123",
    roles: ["trading-operator"],
  }, "The read query must receive the authenticated trading-operator actor.")
  assert.match(page.text, /Harvester status/)
  assert.match(page.text, /Startup audit: DEGRADED/)
  assert.match(page.text, /Trading gate: CLOSED/)
  assert.match(page.text, /ACCOUNT_PREFLIGHT_NOT_DURABLE/)
  assert.deepEqual(page.keyboard, { page: "status" })
}))

test("renders source-backed market readiness and accepted book freshness", async () => {
  const fixture = createPageDependencies({
    operator: {
      getMarkets: async () => ({
        ok: true,
        data: {
          readinessReport: {
            status: "DEGRADED",
            tradingGateOpen: true,
            summary: { readyMarkets: 1,
enabledMarkets: 2,
blockedMarkets: 1,
warnings: 0 },
            runtimeBlockers: [],
            marketBlockers: [{ symbol: "BTCUSDT",
blockers: ["MARKET_BOOK_UNAVAILABLE"] }],
            warnings: [],
          },
          markets: [{
            symbol: "BTCUSDT",
            readiness: "BLOCKED",
            latestPrice: "65000",
            priceFresh: true,
            bookRequired: true,
            bookFresh: false,
            bookTimestamp: null,
            blockers: ["MARKET_BOOK_UNAVAILABLE"],
          }],
        },
      }),
    },
  })
  const page = await readTelegramOperatorPage({
    page: "markets",
    userId: "123",
    interaction: {},
    ...fixture.dependencies,
  })

  assert.match(page.text, /Startup audit: DEGRADED/)
  assert.match(page.text, /Book: unavailable/)
  assert.match(page.text, /MARKET_BOOK_UNAVAILABLE/)
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
      getOrders: async () => ({ ok: false,
 errors: [{ code: "ORDERS_READ_FAILED" }] }),
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


test("Pause and Resume market selection follow the BUY pause state, not the legacy market pause", () => {
  const markets = [
    {
      symbol: "LINKUSDT",
      enabled: true,
      operatorPaused: true,
      operatorBuysPaused: false,
    },
    {
      symbol: "BTCUSDT",
      enabled: true,
      operatorPaused: false,
      operatorBuysPaused: true,
    },
    {
      symbol: "ADAUSDT",
      enabled: false,
      operatorPaused: false,
      operatorBuysPaused: true,
    },
  ]

  assert.deepEqual(
    selectMarketsForAction({
      markets,
      action: "PAUSE",
    }).map(({ symbol }) => symbol),
    ["LINKUSDT"],
  )
  assert.deepEqual(
    selectMarketsForAction({
      markets,
      action: "RESUME",
    }).map(({ symbol }) => symbol),
    ["BTCUSDT"],
  )

  const pauseButtons = createNavigationKeyboard({
    page: "markets",
    markets,
    marketAction: "PAUSE",
  }).inline_keyboard.flat().filter(button => button.callback_data?.startsWith("cc:ask:"))
  const resumeButtons = createNavigationKeyboard({
    page: "markets",
    markets,
    marketAction: "RESUME",
  }).inline_keyboard.flat().filter(button => button.callback_data?.startsWith("cc:ask:"))

  assert.deepEqual(
    pauseButtons.map(({ callback_data }) => callback_data),
    ["cc:ask:PAUSE:LINKUSDT"],
  )
  assert.deepEqual(
    resumeButtons.map(({ callback_data }) => callback_data),
    ["cc:ask:RESUME:BTCUSDT"],
  )
})
