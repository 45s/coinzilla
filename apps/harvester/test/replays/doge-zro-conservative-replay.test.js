import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

const test = (...testArguments) => {
  const [name, ...options] = testArguments;
  return nodeTest(`[doge-zro-conservative-replay.test.js] ${name}`, ...options);
};

const MARKET_SYMBOL = "DOGEUSDT"
const COMPLETED_BUY_COUNT = 4
const CANCELED_RECOVERY_SELL_COUNT = 3
const EXPECTED_RECOVERY_SELL_QUANTITY_AFTER_FOUR_BUYS = "1595"
const EXPECTED_RECOVERY_SELL_PRICE_AFTER_FOUR_BUYS = "0.07182"
const EXPECTED_RETAINED_DOGE_QUANTITY = "3.4"
const EXPECTED_REALIZED_PROFIT_AFTER_FOUR_BUYS = "0.0223471"
const MINIMUM_RECOVERY_PROFIT = "0.01"
const FIRST_BUY_TRADE_ID = 645
const FINAL_RECOVERY_SELL_TRADE_ID = "649"
const SINGLE_CYCLE_RECOVERY_SELL_TRADE_ID = "650"

const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 200,
          orderQuantity: 400,
          keepQuantity: 1,
          minProfit: 0.01,
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

const expectedBuyFillReportsAfterFourBuys = [
  {
    orderPrice: "0.07157",
    executedQuantity: "400",
    fillPrice: "0.07157",
    fillQuantity: "400",
    quoteQuantity: "28.628",
    commissionAmount: "0.4",
    commissionAsset: "DOGE",
  },
  {
    orderPrice: "0.07153",
    executedQuantity: "400",
    fillPrice: "0.07153",
    fillQuantity: "400",
    quoteQuantity: "28.612",
    commissionAmount: "0.4",
    commissionAsset: "DOGE",
  },
  {
    orderPrice: "0.07149",
    executedQuantity: "400",
    fillPrice: "0.07149",
    fillQuantity: "400",
    quoteQuantity: "28.596",
    commissionAmount: "0.4",
    commissionAsset: "DOGE",
  },
  {
    orderPrice: "0.07145",
    executedQuantity: "400",
    fillPrice: "0.07145",
    fillQuantity: "400",
    quoteQuantity: "28.58",
    commissionAmount: "0.4",
    commissionAsset: "DOGE",
  },
]

function runDogeTradingReplayTest(...testArguments) {
  const [name, run] = testArguments;
  test(name, async (t) => {
    const dogeTradingReplay = await createDogeTradingReplay({
      marketSymbol: MARKET_SYMBOL,
      appConfig,
    });
    t.after(async () => {
      await dogeTradingReplay.runtime.stop();
    });
    await run(dogeTradingReplay);
  });
}

runDogeTradingReplayTest("submits the initial DOGE BUY when the market reaches its configured entry trigger", async (dogeTradingReplay) => {
    const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)

    assertOrderMatches(
      initialBuyOrder,
      {
        marketSymbol: MARKET_SYMBOL,
        side: "BUY",
        price: dogeTradingReplay.scenarioExpectations.buyPrice,
        quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
        orderType: "LIMIT",
      },
      "the first market-price trigger must submit one DOGE LIMIT BUY at the configured entry price and quantity",
    )

    const brokerOrderRequests = dogeTradingReplay.brokerOrderPlacementRequests.map(
      ({ params }) => ({
        marketSymbol: params.symbol,
        side: params.side,
        price: params.price,
        quantity: params.quantity,
        orderType: params.type,
      }),
    )
    assert.deepEqual(
      brokerOrderRequests,
      [{
        marketSymbol: MARKET_SYMBOL,
        side: "BUY",
        price: dogeTradingReplay.scenarioExpectations.buyPrice,
        quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
        orderType: "LIMIT",
      }],
      "the initial strategy evaluation must send exactly one matching BUY request to the broker",
    )

    const receivedMarketPrices = dogeTradingReplay.receivedMarketPriceEvents.map(
      ({ symbol, price }) => ({ marketSymbol: symbol,
price }),
    )
    assert.deepEqual(
      receivedMarketPrices,
      [{
        marketSymbol: MARKET_SYMBOL,
        price: dogeTradingReplay.scenarioExpectations.initialPrice,
      }],
      "the replay must deliver the configured initial market price before submitting the first BUY",
    )
  })

function assertRecoveryOrders({ dogeTradingReplay, recoverySellOrder, nextStandingBuyOrder }) {
  assertOrderMatches(
    recoverySellOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "SELL",
      price: dogeTradingReplay.scenarioExpectations.sellPrice,
      quantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
      orderType: "LIMIT",
    },
    "The actual completed BUY fill must create the recovery SELL at the calculated price and sellable quantity.",
  );
  assertOrderMatches(
    nextStandingBuyOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      price: dogeTradingReplay.scenarioExpectations.nextBuyPrice,
      quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      orderType: "LIMIT",
    },
    "The completed BUY fill must create the next standing BUY one configured price step below the completed BUY price.",
  );
}

function assertBuyExecutionReport(dogeTradingReplay) {
  const receivedBuyExecutionReports = dogeTradingReplay.receivedExecutionReports.map(
    ({ executedOrder, fill }) => ({
      marketSymbol: executedOrder.symbol,
      side: executedOrder.side,
      orderPrice: executedOrder.price,
      executedQuantity: executedOrder.executedQuantity,
      fillPrice: fill.price,
      fillQuantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }),
  );
  assert.deepEqual(
    receivedBuyExecutionReports,
    [{
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      orderPrice: dogeTradingReplay.scenarioExpectations.buyPrice,
      executedQuantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      fillPrice: dogeTradingReplay.scenarioExpectations.buyPrice,
      fillQuantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      quoteQuantity: "28.628",
      commissionAmount: "0.4",
      commissionAsset: "DOGE",
    }],
    "The BUY execution report must preserve the exact order facts, executed quantity, quote notional, and DOGE commission.",
  );
}

function assertBrokerOrderRequestSequence(dogeTradingReplay) {
  const brokerOrderRequests = dogeTradingReplay.brokerOrderPlacementRequests.map(
    ({ params }) => ({
      marketSymbol: params.symbol,
      side: params.side,
      price: params.price,
      quantity: params.quantity,
      orderType: params.type,
    }),
  );
  assert.deepEqual(
    brokerOrderRequests,
    [
      {
        marketSymbol: MARKET_SYMBOL,
        side: "BUY",
        price: dogeTradingReplay.scenarioExpectations.buyPrice,
        quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
        orderType: "LIMIT",
      },
      {
        marketSymbol: MARKET_SYMBOL,
        side: "SELL",
        price: dogeTradingReplay.scenarioExpectations.sellPrice,
        quantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
        orderType: "LIMIT",
      },
      {
        marketSymbol: MARKET_SYMBOL,
        side: "BUY",
        price: dogeTradingReplay.scenarioExpectations.nextBuyPrice,
        quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
        orderType: "LIMIT",
      },
    ],
    "The broker must receive the recovery SELL request before the next standing BUY request.",
  );
}

runDogeTradingReplayTest("submits the recovery SELL before the next standing BUY after the actual BUY fill", async (dogeTradingReplay) => {
  const { recoverySellOrder, nextStandingBuyOrder } =
    await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay);
  assertRecoveryOrders({ dogeTradingReplay, recoverySellOrder, nextStandingBuyOrder });
  assertBuyExecutionReport(dogeTradingReplay);
  assertBrokerOrderRequestSequence(dogeTradingReplay);
});

async function completeFourBuyOrders(dogeTradingReplay) {
  let currentStandingBuyOrder = await submitInitialBuyOrder(dogeTradingReplay);
  const completedBuyOrders = [];
  let latestRecoverySellOrder;

  for (let buyFillNumber = 0; buyFillNumber < COMPLETED_BUY_COUNT; buyFillNumber += 1) {
    const nextRecoverySellSubmission = dogeTradingReplay.waitForSubmittedOrder("SELL", buyFillNumber + 1);
    const nextStandingBuySubmission = dogeTradingReplay.waitForSubmittedOrder("BUY", buyFillNumber + 2);
    await dogeTradingReplay.publishMarketPrice(currentStandingBuyOrder.price);
    await dogeTradingReplay.publishFullOrderFill({
      order: currentStandingBuyOrder,
      price: currentStandingBuyOrder.price,
      tradeId: String(FIRST_BUY_TRADE_ID + buyFillNumber),
    });
    const [submittedRecoverySellOrder, submittedNextStandingBuyOrder] = await Promise.all([
      nextRecoverySellSubmission,
      nextStandingBuySubmission,
    ]);
    completedBuyOrders.push(currentStandingBuyOrder);
    latestRecoverySellOrder = submittedRecoverySellOrder;
    currentStandingBuyOrder = submittedNextStandingBuyOrder;
  }

  return { completedBuyOrders,
latestRecoverySellOrder };
}

function assertFourBuyExecutionHistory({ dogeTradingReplay, completedBuyOrders, latestRecoverySellOrder }) {
  assert.equal(completedBuyOrders.length, COMPLETED_BUY_COUNT, "Exactly four distinct BUY orders must complete.");
  const actualBuyFillReports = dogeTradingReplay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "BUY")
    .map(({ executedOrder, fill }) => ({
      orderPrice: executedOrder.price,
      executedQuantity: executedOrder.executedQuantity,
      fillPrice: fill.price,
      fillQuantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }));
  assert.deepEqual(actualBuyFillReports, expectedBuyFillReportsAfterFourBuys, "Every BUY fill must preserve its exact price, quantity, notional, and DOGE commission.");
  assert.equal(dogeTradingReplay.confirmedCanceledOrders.length, CANCELED_RECOVERY_SELL_COUNT, "The three superseded recovery SELL orders must be canceled.");
  assert.ok(
    dogeTradingReplay.confirmedCanceledOrders.every((order) => order.status === "CANCELED"),
    "Every superseded recovery SELL must have an authoritative CANCELED status.",
  );
  const completedBuyOrderSummaries = completedBuyOrders.map((order) => ({
    marketSymbol: order.market.symbol,
    side: order.side,
    orderType: order.type,
  }));
  assert.deepEqual(
    completedBuyOrderSummaries,
    Array.from({ length: COMPLETED_BUY_COUNT }, () => ({
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      orderType: "LIMIT",
    })),
    "All four completed strategy orders must be DOGEUSDT LIMIT BUY orders.",
  );
  const brokerOrderSides = dogeTradingReplay.brokerOrderPlacementRequests.map(({ params }) => params.side);
  assert.deepEqual(
    brokerOrderSides,
    ["BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY"],
    "Four completed BUY fills must produce the initial BUY, four recovery SELLs, and four subsequent BUYs in order.",
  );
  assertOrderMatches(
    latestRecoverySellOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "SELL",
      price: EXPECTED_RECOVERY_SELL_PRICE_AFTER_FOUR_BUYS,
      quantity: EXPECTED_RECOVERY_SELL_QUANTITY_AFTER_FOUR_BUYS,
      orderType: "LIMIT",
    },
    "The latest recovery SELL must combine the remaining sellable DOGE at the calculated price.",
  );
  assert.ok(
    Number(latestRecoverySellOrder.quantity) > dogeTradingReplay.marketConfiguration.keepQuantity,
    "The combined recovery SELL must preserve the configured retained inventory.",
  );
}

async function completeFinalRecoveryCycle({ dogeTradingReplay, latestRecoverySellOrder }) {
  const recoveryCycleCompletion = dogeTradingReplay.waitForRecoveryCycleCompletion();
  await dogeTradingReplay.publishMarketPrice(latestRecoverySellOrder.price);
  await dogeTradingReplay.publishFullOrderFill({
    order: latestRecoverySellOrder,
    price: latestRecoverySellOrder.price,
    tradeId: FINAL_RECOVERY_SELL_TRADE_ID,
  });
  return recoveryCycleCompletion;
}

function assertFinalRecoveryCycleResult({ dogeTradingReplay, recoveryCycleCompletion }) {
  assert.equal(recoveryCycleCompletion.freeQuantity, EXPECTED_RETAINED_DOGE_QUANTITY, "The completed cycle must retain exactly 3.4 DOGE.");
  assert.equal(recoveryCycleCompletion.realizedNetProfit, EXPECTED_REALIZED_PROFIT_AFTER_FOUR_BUYS, "The completed cycle must report exact realized net profit.");
  assert.ok(
    Number(recoveryCycleCompletion.realizedNetProfit) >= Number(MINIMUM_RECOVERY_PROFIT),
    "The recovery cycle must meet the minimum net-profit requirement.",
  );
  const actualRecoverySellFillReports = dogeTradingReplay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "SELL")
    .map(({ executedOrder, fill }) => ({
      orderPrice: executedOrder.price,
      executedQuantity: executedOrder.executedQuantity,
      fillPrice: fill.price,
      fillQuantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }));
  assert.deepEqual(
    actualRecoverySellFillReports,
    [{
      orderPrice: EXPECTED_RECOVERY_SELL_PRICE_AFTER_FOUR_BUYS,
      executedQuantity: EXPECTED_RECOVERY_SELL_QUANTITY_AFTER_FOUR_BUYS,
      fillPrice: EXPECTED_RECOVERY_SELL_PRICE_AFTER_FOUR_BUYS,
      fillQuantity: EXPECTED_RECOVERY_SELL_QUANTITY_AFTER_FOUR_BUYS,
      quoteQuantity: "114.5529",
      commissionAmount: "0.1145529",
      commissionAsset: "USDT",
    }],
    "The final recovery SELL must reconcile exact proceeds and quote-asset commission.",
  );
  const finalStrategyPosition = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  assert.equal(finalStrategyPosition.baseQuantity.amount, "0", "A completed recovery cycle must leave no active DOGE position.");
  assert.equal(finalStrategyPosition.freeBaseQuantity.amount, EXPECTED_RETAINED_DOGE_QUANTITY, "A completed recovery cycle must retain exactly 3.4 DOGE.");
  assert.ok(
    Number(finalStrategyPosition.freeBaseQuantity.amount) >= dogeTradingReplay.marketConfiguration.keepQuantity,
    "The retained free DOGE inventory must meet the configured keepQuantity.",
  );
  const buyExecutionReportCount = dogeTradingReplay.receivedExecutionReports.filter(({ executedOrder }) => executedOrder.side === "BUY").length;
  const sellExecutionReportCount = dogeTradingReplay.receivedExecutionReports.filter(({ executedOrder }) => executedOrder.side === "SELL").length;
  assert.equal(buyExecutionReportCount, COMPLETED_BUY_COUNT, "The completed cycle must account for each BUY execution exactly once.");
  assert.equal(sellExecutionReportCount, 1, "The completed cycle must account for the final recovery SELL exactly once.");
}

runDogeTradingReplayTest("combines four completed BUY fills into one profitable recovery SELL and retains the configured inventory", async (dogeTradingReplay) => {
  const { completedBuyOrders, latestRecoverySellOrder } = await completeFourBuyOrders(dogeTradingReplay);
  assertFourBuyExecutionHistory({
    dogeTradingReplay,
    completedBuyOrders,
    latestRecoverySellOrder,
  });
  const recoveryCycleCompletion = await completeFinalRecoveryCycle({
    dogeTradingReplay,
    latestRecoverySellOrder,
  });
  assertFinalRecoveryCycleResult({
    dogeTradingReplay,
    recoveryCycleCompletion,
  });
});

runDogeTradingReplayTest("completes the recovery cycle only after the SELL fill report is received and reconciled", async (dogeTradingReplay) => {
    const { recoverySellOrder } =
      await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay)
    const recoveryCycleCompletion = dogeTradingReplay.waitForRecoveryCycleCompletion()

    await dogeTradingReplay.publishMarketPrice(
      dogeTradingReplay.scenarioExpectations.sellFillPrice,
    )
    await dogeTradingReplay.publishFullOrderFill({
      order: recoverySellOrder,
      price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
      tradeId: SINGLE_CYCLE_RECOVERY_SELL_TRADE_ID,
    })

    const recoveryCycleResult = await recoveryCycleCompletion
    assert.equal(
      recoveryCycleResult.freeQuantity,
      dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
      "the recovery completion event must report the exact retained free DOGE quantity after the SELL fill",
    )
    assert.equal(
      recoveryCycleResult.realizedNetProfit,
      dogeTradingReplay.scenarioExpectations.expectedProfit,
      "the recovery completion event must report the exact realized net profit from the confirmed SELL fill",
    )

    const finalStrategyPosition = dogeTradingReplay.runtime.portfolio.getPosition({
      symbol: MARKET_SYMBOL,
    })
    assert.equal(
      finalStrategyPosition.baseQuantity.amount,
      "0",
      "the fully reconciled SELL fill must leave zero active DOGE position quantity",
    )
    assert.equal(
      finalStrategyPosition.freeBaseQuantity.amount,
      dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
      "the completed recovery cycle must preserve the exact configured free DOGE inventory",
    )

    const actualExecutionReports = dogeTradingReplay.receivedExecutionReports.map(
      ({ executedOrder, fill }) => ({
        marketSymbol: executedOrder.symbol,
        side: executedOrder.side,
        orderPrice: executedOrder.price,
        executedQuantity: executedOrder.executedQuantity,
        fillPrice: fill.price,
        fillQuantity: fill.quantity,
        quoteQuantity: fill.quoteQuantity,
        commissionAmount: fill.commissionAmount,
        commissionAsset: fill.commissionAsset,
      }),
    )
    assert.deepEqual(
      actualExecutionReports,
      [
        {
          marketSymbol: MARKET_SYMBOL,
          side: "BUY",
          orderPrice: dogeTradingReplay.scenarioExpectations.buyPrice,
          executedQuantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
          fillPrice: dogeTradingReplay.scenarioExpectations.buyPrice,
          fillQuantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
          quoteQuantity: "28.628",
          commissionAmount: "0.4",
          commissionAsset: "DOGE",
        },
        {
          marketSymbol: MARKET_SYMBOL,
          side: "SELL",
          orderPrice: dogeTradingReplay.scenarioExpectations.sellPrice,
          executedQuantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
          fillPrice: dogeTradingReplay.scenarioExpectations.sellFillPrice,
          fillQuantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
          quoteQuantity: "28.67192",
          commissionAmount: "0.02867192",
          commissionAsset: "USDT",
        },
      ],
      "the completed recovery cycle must reconcile the BUY and SELL reports with their actual quantities, proceeds, and commission assets",
    )
  })

async function submitInitialBuyOrder(dogeTradingReplay) {
  const initialBuyOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY")
  await dogeTradingReplay.publishMarketPrice(
    dogeTradingReplay.scenarioExpectations.initialPrice,
  )
  return initialBuyOrderSubmitted
}

async function submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay) {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
  const recoverySellOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL")
  const nextStandingBuyOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder(
    "BUY",
    2,
  )

  await dogeTradingReplay.publishMarketPrice(
    dogeTradingReplay.scenarioExpectations.buyPrice,
  )
  await dogeTradingReplay.publishFullOrderFill({
    order: initialBuyOrder,
    price: dogeTradingReplay.scenarioExpectations.buyPrice,
    tradeId: String(FIRST_BUY_TRADE_ID),
  })

  try {
    const [recoverySellOrder, nextStandingBuyOrder] = await Promise.all([
      recoverySellOrderSubmitted,
      nextStandingBuyOrderSubmitted,
    ])
    return { initialBuyOrder,
recoverySellOrder,
nextStandingBuyOrder }
  } catch (error) {
    const runtimeErrorDetails = dogeTradingReplay.harvesterRuntimeErrors.map(
      (runtimeError) => ({
        message: runtimeError.message,
        symbol: runtimeError.symbol,
        side: runtimeError.side,
        orderStatus: runtimeError.orderStatus,
        errors: runtimeError.errors?.map(
          (underlyingError) => underlyingError.message ?? String(underlyingError),
        ),
      }),
    )
    error.message += `\nHarvester runtime errors: ${  JSON.stringify(runtimeErrorDetails)}`
    throw error
  }
}

function assertOrderMatches(...orderArguments) {
  const [actualOrder, expectedOrder, failureMessage] = orderArguments;
  assert.deepEqual(
    {
      marketSymbol: actualOrder.market.symbol,
      side: actualOrder.side,
      price: actualOrder.price,
      quantity: actualOrder.quantity,
      orderType: actualOrder.type,
    },
    expectedOrder,
    failureMessage,
  )
}
