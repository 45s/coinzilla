import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

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

async function fillArchivedBuy({ replay, scenario, index, currentBuy }) {
  const buy = scenario.buys[index]
  const recoverySellSubmission = replay.waitForSubmittedOrder("SELL", index + 1)
  const nextBuySubmission = index < scenario.buys.length - 1
    ? replay.waitForSubmittedOrder("BUY", index + 2)
    : null

  assert.equal(currentBuy.price, buy.price, "The replay must submit each archived BUY at its recorded execution price.")
  await replay.publishMarketPrice(currentBuy.price)
  await replay.publishFullOrderFill({
    order: currentBuy,
    price: buy.price,
    tradeId: buy.tradeId,
    commissionAmount: buy.commissionAmount,
    commissionAsset: buy.commissionAsset,
  })

  const [recoverySell, nextBuy] = await Promise.all([
    recoverySellSubmission,
    nextBuySubmission ?? Promise.resolve(null),
  ])
  return {
    recoverySell,
    nextBuy,
  }
}

async function fillArchivedBuys({ replay, scenario }) {
  const initialBuySubmission = replay.waitForSubmittedOrder("BUY")
  await replay.publishMarketPrice(scenario.initialPrice)
  let currentBuy = await initialBuySubmission
  let latestRecoverySell

  for (let index = 0; index < scenario.buys.length; index += 1) {
    const result = await fillArchivedBuy({
      replay,
      scenario,
      index,
      currentBuy,
    })
    latestRecoverySell = result.recoverySell
    if (result.nextBuy) {
      currentBuy = result.nextBuy
    }
  }
  return latestRecoverySell
}

async function fillArchivedRecoverySell({ replay, scenario, recoverySell }) {
  assert.equal(recoverySell.price, scenario.sell.price, "The recovery SELL must use the archived SELL execution price.")
  assert.equal(recoverySell.quantity, scenario.sell.quantity, "The recovery SELL quantity must match the archived executed quantity.")

  const completionWaiter = replay.waitForRecoveryCycleCompletion()
  await replay.publishMarketPrice(recoverySell.price)
  await replay.publishFullOrderFill({
    order: recoverySell,
    price: scenario.sell.price,
    tradeId: scenario.sell.tradeId,
    commissionAmount: scenario.sell.commissionAmount,
    commissionAsset: scenario.sell.commissionAsset,
  })
  return completionWaiter
}

function assertCycleCompleted({ replay, scenario, completion }) {
  assert.equal(completion.freeQuantity, scenario.expectedFreeQuantity, "The completed runtime cycle must retain the exact archived residual inventory.")
  assert.equal(completion.realizedNetProfit, scenario.expectedRealizedNetProfit, "The runtime completion event must report exact net profit after actual commissions.")
  assert.deepEqual(
    completion.dust,
    scenario.expectedDust,
    "Completion must preserve the exact exchange-constrained residual and limiting-filter evidence from the explicit test fixture.",
  )
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length,
    1,
    "Each archived runtime replay must publish exactly one recovery-cycle completion event.",
  )
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "strategy.paused").length,
    0,
    "A valid archived recovery cycle must not raise a strategy safety pause.",
  )
  assert.equal(replay.harvesterRuntimeErrors.length, 0, "The production runtime replay must complete without uncaught Harvester errors.")
}

function assertPortfolioReset({ replay, scenario }) {
  const position = replay.runtime.portfolio.getPosition({ symbol: scenario.symbol })
  const recoveryLedger = replay.runtime.getRecoveryLedger({ marketId: position.market.id })
  assert.equal(position.baseQuantity.amount, "0", "A completed recovery cycle must release its active Portfolio base quantity.")
  assert.equal(position.freeBaseQuantity.amount, scenario.expectedFreeQuantity, "The exact residual inventory must remain free in Portfolio after cycle reset.")
  assert.equal(position.spent.amount, "0", "A completed recovery cycle must reset its active BUY cost basis.")
  assert.equal(recoveryLedger.buyCost, "0", "A completed recovery cycle must reset RecoveryLedger BUY cost.")
  assert.equal(recoveryLedger.netSellProceeds, "0", "A completed recovery cycle must reset RecoveryLedger net SELL proceeds.")
}

async function runArchivedRecoveryCycle({ t, scenario }) {
  const replay = await createDogeTradingReplay({
    marketSymbol: scenario.symbol,
    appConfig: createAppConfig(scenario),
    scenarioExpectations: {
      initialPrice: scenario.initialPrice,
    },
    exchangeFilters: scenario.exchangeFilters,
  })
  let stopped = false
  t.after(async () => {
    if (!stopped) {
      await replay.runtime.stop()
    }
  })

  const recoverySell = await fillArchivedBuys({
    replay,
    scenario,
  })
  const completion = await fillArchivedRecoverySell({
    replay,
    scenario,
    recoverySell,
  })
  assertCycleCompleted({
    replay,
    scenario,
    completion: await completion,
  })
  assertPortfolioReset({
    replay,
    scenario,
  })

  await replay.runtime.stop()
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
      evaluatedQuantity: "0.02",
      evaluatedNotional: "0.02348",
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
      evaluatedQuantity: "2.4",
      evaluatedNotional: "0.132024",
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

test("replays archived ZROUSDT fills with explicit test filters and records exact MIN_NOTIONAL dust", async (t) => {
  await runArchivedRecoveryCycle({
    t,
    scenario: zroScenario,
  })
})

test("replays archived DOGEUSDT fills with explicit test filters and records exact MIN_NOTIONAL dust", async (t) => {
  await runArchivedRecoveryCycle({
    t,
    scenario: dogeScenario,
  })
})

test("replays archived ADAUSDT fills with explicit test filters and records exact QUANTITY_INCREMENT dust", async (t) => {
  await runArchivedRecoveryCycle({
    t,
    scenario: adaScenario,
  })
})
