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

  assert.equal(currentBuy.price, buy.price)
  await replay.publishMarketPrice(currentBuy.price)
  await replay.publishFullOrderFill({
    order: currentBuy,
    price: buy.price,
    tradeId: buy.tradeId,
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
  assert.equal(recoverySell.price, scenario.sell.price)
  assert.equal(recoverySell.quantity, scenario.sell.quantity)

  const completionWaiter = replay.waitForRecoveryCycleCompletion()
  await replay.publishMarketPrice(recoverySell.price)
  await replay.publishFullOrderFill({
    order: recoverySell,
    price: scenario.sell.price,
    tradeId: scenario.sell.tradeId,
  })
  return completionWaiter
}

function assertCycleCompleted({ replay, scenario, completion }) {
  assert.equal(completion.freeQuantity, scenario.expectedFreeQuantity)
  assert.equal(completion.realizedNetProfit, scenario.expectedRealizedNetProfit)
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length,
    1,
  )
  assert.equal(
    replay.receivedLifecycleEvents.filter(({ name }) => name === "strategy.paused").length,
    0,
  )
  assert.equal(replay.harvesterRuntimeErrors.length, 0)
}

function assertPortfolioReset({ replay, scenario }) {
  const position = replay.runtime.portfolio.getPosition({ symbol: scenario.symbol })
  const recoveryLedger = replay.runtime.getRecoveryLedger({ marketId: position.market.id })
  assert.equal(position.baseQuantity.amount, "0")
  assert.equal(position.freeBaseQuantity.amount, scenario.expectedFreeQuantity)
  assert.equal(position.spent.amount, "0")
  assert.equal(recoveryLedger.buyCost, "0")
  assert.equal(recoveryLedger.netSellProceeds, "0")
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
      },
      {
        price: "1.169",
        tradeId: "15736",
      },
      {
        price: "1.168",
        tradeId: "15737",
      },
      {
        price: "1.167",
        tradeId: "15738",
      },
    ],
    sell: {
      price: "1.174",
      quantity: "19.95",
      tradeId: "15740",
    },
    expectedFreeQuantity: "0.03",
    expectedRealizedNetProfit: "0.0278787",
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
      },
      {
        price: "0.05479",
        tradeId: "303729",
      },
      {
        price: "0.05476",
        tradeId: "303737",
      },
      {
        price: "0.05473",
        tradeId: "303738",
      },
    ],
    sell: {
      price: "0.05501",
      quantity: "1595",
      tradeId: "303742",
    },
    expectedFreeQuantity: "3.4",
    expectedRealizedNetProfit: "0.01320905",
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
      },
    ],
    sell: {
      price: "0.1455",
      quantity: "49.9",
      tradeId: "145942",
    },
    expectedFreeQuantity: "0.05",
    expectedRealizedNetProfit: "0.05318955",
  },
]

for (const scenario of scenarios) {
  test(`replays archived ${scenario.symbol} fills and completes profitable exchange-constrained residual inventory`, async (t) => {
    await runArchivedRecoveryCycle({
      t,
      scenario,
    })
  })
}
