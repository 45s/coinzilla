import nodeTest from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

// The immutable archive fixture is the authority for exchange-reported execution quote quantities.
// Runtime replay must carry these values through unchanged rather than reconstructing them from price × quantity.
const archivedFixture = JSON.parse(readFileSync(
  new URL("../audits/fixtures/2026-11-22-conservative-recovery.json", import.meta.url),
  "utf8",
))

function getArchivedFill(tradeId) {
  const fill = archivedFixture.fills.find((candidate) => candidate.tradeId === tradeId)
  assert.ok(fill, `The immutable archive fixture must contain execution trade ${tradeId}.`)
  assert.equal(typeof fill.quoteQuantity, "string", `Archived trade ${tradeId} must retain its exact exchange quote quantity.`)
  return fill
}

const test = (...args) => {
  const [name, ...options] = args
  return nodeTest(`[2026-11-22-conservative-recovery-runtime-replay.test.js] ${name}`, ...options)
}

function createAppConfig({ symbol, orderQuantity, keepQuantity, minProfit, priceStepPercent, investment }) {
  return {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          conservative: {
            enabled: true,
          },
          aggressive: {
            enabled: false,
          },
        },
        pairs: {
          [symbol]: {
            enabled: true,
            tradingEnvironment: "testnet",
            enableVolatilityProtection: false,
            externalOrdersPolicy: "ignore",
            investment,
            orderQuantity,
            keepQuantity,
            minProfit,
            priceStepPercent,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

async function createArchivedAdmissionReplay({ scenario }) {
  return createDogeTradingReplay({
    marketSymbol: scenario.symbol,
    appConfig: createAppConfig(scenario),
    scenarioExpectations: createScenarioExpectations({
      initialPrice: scenario.initialPrice,
    }),
    exchangeFilters: scenario.exchangeFilters,
  })
}

async function publishFirstArchivedBuy({ replay, scenario }) {
  const initialBuySubmission = replay.waitForSubmittedOrder("BUY")
  await replay.publishMarketPrice(scenario.initialPrice)
  const initialBuy = await initialBuySubmission
  const [archivedBuy] = scenario.buys
  assert.equal(initialBuy.price, archivedBuy.price)
  const recoverySellSubmission = replay.waitForSubmittedOrder("SELL")
  const archivedFill = getArchivedFill(archivedBuy.tradeId)
  await replay.publishOrderFill({
    order: initialBuy,
    price: archivedBuy.price,
    tradeId: archivedBuy.tradeId,
    fillQuantity: initialBuy.quantity,
    cumulativeExecutedQuantity: initialBuy.quantity,
    quoteQuantity: archivedFill.quoteQuantity,
    commissionAmount: archivedBuy.commissionAmount,
    commissionAsset: archivedBuy.commissionAsset,
  })
  assert.equal(
    replay.receivedExecutionReports.at(-1)?.fill?.quoteQuantity,
    archivedFill.quoteQuantity,
  )
  const recoverySell = await recoverySellSubmission
  assert.equal(recoverySell.side, "SELL")
  assert.equal(recoverySell.status, "OPEN")
}

async function assertArchivedAdmissionRemainsClosed({ replay, scenario }) {
  await replay.publishMarketPrice(
    scenario.buys[1]?.price ?? scenario.sell.price,
  )
  assert.equal(
    replay.submittedCanonicalOrders.filter(({ side }) => side === "BUY").length,
    1,
  )
  assert.equal(
    replay.submittedCanonicalOrders.filter(({ side }) => side === "SELL").length,
    1,
  )
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length,
    0,
  )
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "strategy.paused").length,
    0,
  )
  assert.equal(replay.harvesterRuntimeErrors.length, 0)
}

async function runArchivedAdmissionReplay({ t, scenario }) {
  const replay = await createArchivedAdmissionReplay({ scenario })
  let stopped = false
  t.after(async () => {
    if (!stopped) {
      try {
        await replay.runtime.stop()
      } catch {
        // An unresolved recovery cycle is intentionally not repaired by this admission replay.
      }
    }
  })
  await publishFirstArchivedBuy({
    replay,
    scenario,
  })
  await assertArchivedAdmissionRemainsClosed({
    replay,
    scenario,
  })
  try {
    await replay.runtime.stop()
  } catch {
    // Shutdown safety remains fail-closed while the recovery cycle is unresolved.
  }
  stopped = true
}


// These are explicit current-runtime test filters, not historical exchange-filter evidence; the archive did not capture decision-time filters.
const scenarios = [
  {
    symbol: "ZROUSDT",
    investment: 100,
    orderQuantity: 5,
    keepQuantity: 0.01,
    minProfit: 0.01,
    priceStepPercent: 0.05,
    initialPrice: "1.1706",
    exchangeFilters: {
      tickSize: "0.001",
      minQty: "0.01",
      stepSize: "0.01",
      minNotional: "5",
    },
    buys: [
      {
        price: "1.17",
        tradeId: "15735",
        commissionAmount: "0.005",
        commissionAsset: "ZRO",
      },
      {
        price: "1.169",
        tradeId: "15736",
        commissionAmount: "0.005",
        commissionAsset: "ZRO",
      },
      {
        price: "1.168",
        tradeId: "15737",
        commissionAmount: "0.005",
        commissionAsset: "ZRO",
      },
      {
        price: "1.167",
        tradeId: "15738",
        commissionAmount: "0.005",
        commissionAsset: "ZRO",
      },
    ],
    sell: {
      price: "1.174",
      quantity: "19.95",
      tradeId: "15740",
      commissionAmount: "0.0234213",
      commissionAsset: "USDT",
    },
    expectedFreeQuantity: "0.03",
    expectedRealizedNetProfit: "0.0278787",
    expectedDust: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.02",
      reason: "MIN_NOTIONAL",
      minimumQuantity: "0.01",
      minimumNotional: "5",
      evaluatedQuantity: "0.01",
      evaluatedNotional: "0.01174",
    },
  },
  {
    symbol: "DOGEUSDT",
    investment: 100,
    orderQuantity: 400,
    keepQuantity: 1,
    minProfit: 0.01,
    priceStepPercent: 0.05,
    initialPrice: "0.05485",
    exchangeFilters: {
      tickSize: "0.00001",
      minQty: "1",
      stepSize: "1",
      minNotional: "5",
    },
    buys: [
      {
        price: "0.05482",
        tradeId: "303728",
        commissionAmount: "0.4",
        commissionAsset: "DOGE",
      },
      {
        price: "0.05479",
        tradeId: "303729",
        commissionAmount: "0.4",
        commissionAsset: "DOGE",
      },
      {
        price: "0.05476",
        tradeId: "303737",
        commissionAmount: "0.4",
        commissionAsset: "DOGE",
      },
      {
        price: "0.05473",
        tradeId: "303738",
        commissionAmount: "0.4",
        commissionAsset: "DOGE",
      },
    ],
    sell: {
      price: "0.05501",
      quantity: "1595",
      tradeId: "303742",
      commissionAmount: "0.08774095",
      commissionAsset: "USDT",
    },
    expectedFreeQuantity: "3.4",
    expectedRealizedNetProfit: "0.01320905",
    expectedDust: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "2.4",
      reason: "MIN_NOTIONAL",
      minimumQuantity: "1",
      minimumNotional: "5",
      evaluatedQuantity: "2",
      evaluatedNotional: "0.11002",
    },
  },
  {
    symbol: "ADAUSDT",
    investment: 200,
    orderQuantity: 50,
    keepQuantity: 0,
    minProfit: 0.05,
    priceStepPercent: 0.3,
    initialPrice: "0.1445",
    exchangeFilters: {
      tickSize: "0.0001",
      minQty: "0.1",
      stepSize: "0.1",
      minNotional: "5",
    },
    buys: [
      {
        price: "0.144",
        tradeId: "145912",
        commissionAmount: "0.05",
        commissionAsset: "ADA",
      },
    ],
    sell: {
      price: "0.1455",
      quantity: "49.9",
      tradeId: "145942",
      commissionAmount: "0.00726045",
      commissionAsset: "USDT",
    },
    expectedFreeQuantity: "0.05",
    expectedRealizedNetProfit: "0.05318955",
    expectedDust: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.05",
      reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.1",
      evaluatedQuantity: "0",
    },
  },
]

const [zroScenario, dogeScenario, adaScenario] = scenarios

test("blocks subsequent archived ZROUSDT BUYs while the first recovery cycle is active", async (t) => {
  await runArchivedAdmissionReplay({
    t,
    scenario: zroScenario,
  })
})

test("blocks subsequent archived DOGEUSDT BUYs while the first recovery cycle is active", async (t) => {
  await runArchivedAdmissionReplay({
    t,
    scenario: dogeScenario,
  })
})

test("blocks subsequent archived ADAUSDT BUYs while the first recovery cycle is active", async (t) => {
  await runArchivedAdmissionReplay({
    t,
    scenario: adaScenario,
  })
})
