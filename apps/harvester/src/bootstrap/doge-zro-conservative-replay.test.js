import nodeTest, { describe, beforeEach, afterEach } from "node:test"
const test = (name, ...args) => nodeTest("[doge-zro-conservative-dogeTradingReplay.test.js] " + name, ...args)
import assert from "node:assert/strict"

const tradingConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        minProfit: 0.01,
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          investment: 200,
          orderQuantity: 400,
          keepQuantity: 1,
          priceStepPercent: 0.05,
          pricePrecision: 5,
          quantityPrecision: 0,
          makerPercent: 0.1,
          takerPercent: 0.1,
        },
      },
    },
  },
}

describe("DOGEUSDT Conservative strategy dogeTradingReplay", () => {
  const marketSymbol = "DOGEUSDT"
  let dogeTradingReplay

  beforeEach(async () => {
    dogeTradingReplay = await createDogeTradingReplay({ marketSymbol, tradingConfig })
  })

  afterEach(async () => {
    if (dogeTradingReplay?.runtime) await dogeTradingReplay.runtime.stop()
    dogeTradingReplay = undefined
  })

  test("submits the initial DOGE BUY when the market reaches its configured entry trigger", async () => {
    const standingBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
    assert.deepEqual(
      [standingBuyOrder.market.symbol, standingBuyOrder.side, standingBuyOrder.price, standingBuyOrder.quantity, standingBuyOrder.type],
      [
        symbol: marketSymbol,
        "BUY",
        dogeTradingReplay.scenarioExpectations.buyPrice,
        String(dogeTradingReplay.marketConfiguration.orderQuantity),
        "LIMIT",
      ],
    ,
      "the initial market-price trigger must create a DOGE BUY with the configured market, side, price, quantity, and order type",
    )
    assert.deepEqual(
      dogeTradingReplay.outgoingOrderRequests.map(({ params }) => [
        params.symbol,
        params.side,
        params.price,
        params.quantity,
        params.type,
      ]),
      [
        [
          symbol: marketSymbol,
          "BUY",
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          "LIMIT",
        ],
      ],
    ,
      "the initial strategy evaluation must send exactly one matching BUY request to the broker",
    )
    assert.deepEqual(
      dogeTradingReplay.receivedPrices.map(({ symbol: receivedSymbol, price }) => [
        receivedSymbol,
        price,
      ]),
      [[marketSymbol, dogeTradingReplay.scenarioExpectations.initialPrice]],
    ,
      "the replay must publish the configured initial market price before submitting the first BUY",
    )
  })

  test("submits the recovery SELL before the next standing BUY after the actual BUY fill", async () => {
    const { recoverySell: recoverySellOrder, nextStandingBuy } =
      await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay)
    assert.deepEqual(
      [recoverySellOrder.market.symbol, recoverySellOrder.side, recoverySellOrder.price, recoverySellOrder.quantity, recoverySellOrder.type],
      [
        symbol: marketSymbol,
        "SELL",
        dogeTradingReplay.scenarioExpectations.sellPrice,
        dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
        "LIMIT",
      ],
    ,
      "the completed BUY fill must create the recovery SELL at the configured recovery price and sellable quantity",
    )
    assert.deepEqual(
      [
        nextStandingBuy.market.symbol,
        nextStandingBuy.side,
        nextStandingBuy.price,
        nextStandingBuy.quantity,
        nextStandingBuy.type,
      ],
      [
        symbol: marketSymbol,
        "BUY",
        dogeTradingReplay.scenarioExpectations.nextBuyPrice,
        String(dogeTradingReplay.marketConfiguration.orderQuantity),
        "LIMIT",
      ],
    ,
      "the completed BUY fill must create the next standing BUY one configured price step below the completed BUY price",
    )
    assert.deepEqual(
      dogeTradingReplay.receivedExecutionReports.map(({ executedOrder, fill }) => [
        executedOrder.symbol,
        executedOrder.side,
        executedOrder.price,
        executedOrder.executedQuantity,
        fill.price,
        fill.quantity,
        fill.quoteQuantity,
        fill.commissionAmount,
        fill.commissionAsset,
      ]),
      [
        [
          symbol: marketSymbol,
          "BUY",
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          "28.628",
          "0.4",
          marketSymbol.slice(0, -4),
        ],
      ],
    ,
      "the BUY execution report must include the exact order facts, executed quantity, quote notional, and DOGE commission",
    )
    assert.deepEqual(
      dogeTradingReplay.outgoingOrderRequests.map(({ params }) => [
        params.symbol,
        params.side,
        params.price,
        params.quantity,
        params.type,
      ]),
      [
        [
          symbol: marketSymbol,
          "BUY",
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          "LIMIT",
        ],
        [
          symbol: marketSymbol,
          "SELL",
          dogeTradingReplay.scenarioExpectations.sellPrice,
          dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
          "LIMIT",
        ],
        [
          symbol: marketSymbol,
          "BUY",
          dogeTradingReplay.scenarioExpectations.nextBuyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          "LIMIT",
        ],
      ],
    ,
      "the broker must receive the recovery SELL request before the next standing BUY request",
    )
  })

  test("combines four completed BUY fills into one profitable recovery SELL and retains the configured inventory", async () => {
    let standingBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
    const completedBuyOrders = []
    let recoverySellOrder

    for (let index = 0; index < 4; index += 1) {
      const sellSubmitted = dogeTradingReplay.waitForOrder("SELL", index + 1)
      const nextBuySubmitted = dogeTradingReplay.waitForOrder("BUY", index + 2)
      await dogeTradingReplay.triggerPrice(standingBuyOrder.price)
      await dogeTradingReplay.fillOrder({
        order: standingBuyOrder,
        price: standingBuyOrder.price,
        tradeId: String(645 + index),
      })
      const [nextSell, nextStandingBuyOrder] = await Promise.all([
        sellSubmitted,
        nextBuySubmitted,
      ])
      completedBuyOrders.push(standingBuyOrder)
      recoverySellOrder = nextSell
      standingBuyOrder = nextStandingBuyOrder
    }

    assert.equal(completedBuyOrders.length, 4,
      "the replay must complete four distinct BUY orders before calculating the combined recovery SELL",
    )
    assert.deepEqual(
      dogeTradingReplay.receivedExecutionReports
        .filter(({ executedOrder }) => executedOrder.side === "BUY")
        .map(({ executedOrder, fill }) => [
          executedOrder.price,
          executedOrder.executedQuantity,
          fill.price,
          fill.quantity,
          fill.quoteQuantity,
          fill.commissionAmount,
          fill.commissionAsset,
        ]),
      [
        ["0.07157", "400", "0.07157", "400", "28.628", "0.4", "DOGE"],
        ["0.07153", "400", "0.07153", "400", "28.612", "0.4", "DOGE"],
        ["0.07149", "400", "0.07149", "400", "28.596", "0.4", "DOGE"],
        ["0.07145", "400", "0.07145", "400", "28.58", "0.4", "DOGE"],
      ],
      "each BUY must reconcile its executed quantity, quote notional, and base-asset commission",
    )
    assert.equal(dogeTradingReplay.cancelledOrders.length, 3,
      "the strategy must confirm cancellation of exactly three superseded recovery SELL orders before replacing them",
    )
    assert.ok(
      dogeTradingReplay.cancelledOrders.every((order) => order.status === "CANCELED"),
    ,
      "every superseded recovery SELL order must have an authoritative CANCELED status",
    )
    assert.deepEqual(
      completedBuyOrders.map((order) => [
        order.market.symbol,
        order.side,
        order.type,
      ]),
      Array.from({ length: 4 }, () => [marketSymbol, "BUY", "LIMIT"]),
    ,
      "all four completed strategy orders must belong to DOGEUSDT and be LIMIT BUY orders",
    )
    assert.deepEqual(
      dogeTradingReplay.outgoingOrderRequests.map(({ params }) => params.side),
      ["BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY"],
    ,
      "four completed BUY fills must produce the expected alternating BUY and SELL broker request sequence",
    )
    assert.deepEqual(
      [recoverySellOrder.market.symbol, recoverySellOrder.side, recoverySellOrder.type],
      [marketSymbol, "SELL", "LIMIT"],
    ,
      "the latest recovery SELL after four completed BUY fills must belong to DOGEUSDT and be a LIMIT SELL",
    )
    assert.equal(recoverySellOrder.quantity, "1595",
      "the combined recovery SELL must contain exactly 1,595 DOGE",
    )
    assert.equal(recoverySellOrder.price, "0.07182",
      "the combined recovery SELL must use the calculated 0.07182 USDT limit price",
    )
    assert.ok(Number(recoverySellOrder.quantity) > dogeTradingReplay.marketConfiguration.keepQuantity,
      "the recovery SELL must sell more DOGE than the configured retained inventory quantity",
    )

    const recoveryCycleCompletion = dogeTradingReplay.waitForCycle()
    await dogeTradingReplay.triggerPrice(recoverySellOrder.price)
    await dogeTradingReplay.fillOrder({
      order: recoverySellOrder,
      price: recoverySellOrder.price,
      tradeId: "649",
    })
    const recoveryCycleResult = await recoveryCycleCompletion
    assert.equal(recoveryCycleResult.freeQuantity, "3.4",
      "the completed recovery cycle must report exactly 3.4 DOGE as free retained inventory",
    )
    assert.equal(recoveryCycleResult.realizedNetProfit, "0.0223471",
      "the completed recovery cycle must report the exact realized net profit after actual commissions",
    )
    assert.ok(Number(recoveryCycleResult.realizedNetProfit) >= tradingConfig.strategies.CG_coinGrabber.settings.minProfit,
      "the recovery cycle must not complete below the configured minimum net profit",
    )
    assert.deepEqual(
      dogeTradingReplay.receivedExecutionReports
        .filter(({ executedOrder }) => executedOrder.side === "SELL")
        .map(({ executedOrder, fill }) => [
          executedOrder.price,
          executedOrder.executedQuantity,
          fill.price,
          fill.quantity,
          fill.quoteQuantity,
          fill.commissionAmount,
          fill.commissionAsset,
        ]),
      [[
        "0.07182",
        "1595",
        "0.07182",
        "1595",
        "114.5529",
        "0.1145529",
        "USDT",
      ]],
      "SELL proceeds and quote-asset commission must match the actual execution",
    )

    const finalStrategyPosition = dogeTradingReplay.runtime.portfolio.getPosition({ marketSymbol })
    const expectedRetainedInventoryQuantity = subtractDecimal({
      left: "1598.4",
      right: recoverySellOrder.quantity,
    })
    assert.equal(finalStrategyPosition.baseQuantity.amount, "0",
      "the completed recovery SELL must leave no active DOGE position quantity",
    )
    assert.equal(expectedRetainedInventoryQuantity, "3.4",
      "the retained inventory calculation must equal the expected 3.4 DOGE remainder",
    )
    assert.equal(finalStrategyPosition.freeBaseQuantity.amount, expectedRetainedInventoryQuantity,
      "the Portfolio free inventory must equal the retained quantity calculated by the recovery cycle",
    )
    assert.equal(finalStrategyPosition.freeBaseQuantity.amount, "3.4",
      "the completed recovery cycle must preserve exactly 3.4 DOGE as free inventory",
    )
    assert.ok(
      Number(finalStrategyPosition.freeBaseQuantity.amount) >= dogeTradingReplay.marketConfiguration.keepQuantity,
    ,
      "the retained free DOGE inventory must be at least the configured keepQuantity",
    )
    assert.equal(
      dogeTradingReplay.receivedExecutionReports.filter(
        ({ executedOrder }) => executedOrder.side === "BUY",
      ).length,
      4,
    ,
      "the recovery cycle must account for all four BUY execution reports exactly once",
    )
    assert.equal(
      dogeTradingReplay.receivedExecutionReports.filter(
        ({ executedOrder }) => executedOrder.side === "SELL",
      ).length,
      1,
    ,
      "the recovery cycle must account for its final SELL execution report exactly once",
    )
  })

  test("completes the recovery recoveryCycleCompletion after the SELL fill report", async () => {
    const { recoverySell: recoverySellOrder } = await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay)
    const recoveryCycleCompletion = dogeTradingReplay.waitForCycle()
    await dogeTradingReplay.triggerPrice(dogeTradingReplay.scenarioExpectations.sellFillPrice)
    await dogeTradingReplay.fillOrder({
      order: recoverySellOrder,
      price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
      tradeId: "650",
    })

    const recoveryCycleResult = await recoveryCycleCompletion
    assert.equal(recoveryCycleResult.freeQuantity, dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
      "the recovery completion event must report the exact retained free DOGE quantity",
    )
    assert.equal(recoveryCycleResult.realizedNetProfit, dogeTradingReplay.scenarioExpectations.expectedProfit,
      "the recovery completion event must report the exact realized net profit from the SELL fill",
    )

    const finalStrategyPosition = dogeTradingReplay.runtime.portfolio.getPosition({ marketSymbol })
    assert.equal(finalStrategyPosition.baseQuantity.amount, "0",
      "the reconciled SELL fill must leave zero active DOGE position quantity",
    )
    assert.equal(
      finalStrategyPosition.freeBaseQuantity.amount,
      dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
    ,
      "the completed recovery cycle must preserve the configured free DOGE inventory quantity",
    )
    assert.deepEqual(
      dogeTradingReplay.receivedExecutionReports.map(({ executedOrder, fill }) => [
        executedOrder.symbol,
        executedOrder.side,
        executedOrder.price,
        executedOrder.executedQuantity,
        fill.price,
        fill.quantity,
        fill.quoteQuantity,
        fill.commissionAmount,
        fill.commissionAsset,
      ]),
      [
        [
          symbol: marketSymbol,
          "BUY",
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          dogeTradingReplay.scenarioExpectations.buyPrice,
          String(dogeTradingReplay.marketConfiguration.orderQuantity),
          "28.628",
          "0.4",
          marketSymbol.slice(0, -4),
        ],
        [
          symbol: marketSymbol,
          "SELL",
          dogeTradingReplay.scenarioExpectations.sellPrice,
          dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
          dogeTradingReplay.scenarioExpectations.sellFillPrice,
          dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
          "28.67192",
          "0.02867192",
          "USDT",
        ],
      ],
    ,
      "the replay must complete user-data reconciliation before accepting simulated market events",
    )
  })
})

