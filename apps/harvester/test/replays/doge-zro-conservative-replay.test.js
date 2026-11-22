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
  assertRecoveryOrders({
    dogeTradingReplay,
    recoverySellOrder,
    nextStandingBuyOrder,
  });
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

function assertSingleCycleCompletionResult({ dogeTradingReplay, recoveryCycleResult }) {
  assert.equal(
    recoveryCycleResult.freeQuantity,
    dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
    "the recovery completion event must report the exact retained free DOGE quantity after the SELL fill",
  );
  assert.equal(
    recoveryCycleResult.realizedNetProfit,
    dogeTradingReplay.scenarioExpectations.expectedProfit,
    "the recovery completion event must report the exact realized net profit from the confirmed SELL fill",
  );
}

function assertSingleCyclePosition(dogeTradingReplay) {
  const position = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  assert.equal(position.baseQuantity.amount, "0");
  assert.equal(
    position.freeBaseQuantity.amount,
    dogeTradingReplay.scenarioExpectations.expectedFreeQuantity,
    "the completed recovery cycle must preserve the exact configured free DOGE inventory",
  );
}

function assertSingleCycleExecutionReports(dogeTradingReplay) {
  const reports = dogeTradingReplay.receivedExecutionReports.map(({ executedOrder, fill }) => ({
    marketSymbol: executedOrder.symbol,
    side: executedOrder.side,
    orderPrice: executedOrder.price,
    executedQuantity: executedOrder.executedQuantity,
    fillPrice: fill.price,
    fillQuantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    commissionAmount: fill.commissionAmount,
    commissionAsset: fill.commissionAsset,
  }));
  assert.deepEqual(reports, [
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
  ], "the completed recovery cycle must reconcile actual BUY and SELL execution facts");
}

async function assertSingleCycleDuplicateFillIsIdempotent({ dogeTradingReplay, recoverySellOrder, timestamp }) {
  assert.equal(
    dogeTradingReplay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length,
    1,
    "the reconciled SELL must publish exactly one completed-cycle outcome",
  );
  const before = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  await dogeTradingReplay.publishFullOrderFill({
    order: recoverySellOrder,
    price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
    tradeId: SINGLE_CYCLE_RECOVERY_SELL_TRADE_ID,
    timestamp,
  });
  const after = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  assert.equal(
    dogeTradingReplay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length,
    1,
    "replaying the same SELL execution must not publish a second completed-cycle outcome",
  );
  assert.equal(after.baseQuantity.amount, before.baseQuantity.amount);
  assert.equal(after.freeBaseQuantity.amount, before.freeBaseQuantity.amount);
}

runDogeTradingReplayTest("completes the recovery cycle only after the SELL fill report is received and reconciled", async (dogeTradingReplay) => {
  const { recoverySellOrder } = await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay);
  const executionTimestamp = Math.max(Date.now(), recoverySellOrder.createdAt + 1);
  const completion = dogeTradingReplay.waitForRecoveryCycleCompletion();
  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.sellFillPrice);
  await dogeTradingReplay.publishFullOrderFill({
    order: recoverySellOrder,
    price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
    tradeId: SINGLE_CYCLE_RECOVERY_SELL_TRADE_ID,
    timestamp: executionTimestamp,
  });
  const recoveryCycleResult = await completion;
  assertSingleCycleCompletionResult({
    dogeTradingReplay,
    recoveryCycleResult,
  });
  assertSingleCyclePosition(dogeTradingReplay);
  assertSingleCycleExecutionReports(dogeTradingReplay);
  await assertSingleCycleDuplicateFillIsIdempotent({
    dogeTradingReplay,
    recoverySellOrder,
    timestamp: executionTimestamp,
  });
});

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

function createPartialBuyReports({ initialBuyOrder } = {}) {
  const firstExecutionTimestamp = Math.max(Date.now(), initialBuyOrder.createdAt + 1)
  return [
    {
      tradeId: "6451",
      fillQuantity: "100",
      cumulativeExecutedQuantity: "100",
      quoteQuantity: "7.157",
      commissionAmount: "0.1",
      timestamp: firstExecutionTimestamp,
    },
    {
      tradeId: "6452",
      fillQuantity: "150",
      cumulativeExecutedQuantity: "250",
      quoteQuantity: "10.7355",
      commissionAmount: "0.15",
      timestamp: firstExecutionTimestamp + 1,
    },
    {
      tradeId: "6453",
      fillQuantity: "150",
      cumulativeExecutedQuantity: "400",
      quoteQuantity: "10.7355",
      commissionAmount: "0.15",
      timestamp: firstExecutionTimestamp + 2,
    },
  ]
}

async function applyPartialBuyReports({
  dogeTradingReplay,
  initialBuyOrder,
  partialBuyReports,
}) {
  const expectedProgress = [
    {
      baseQuantity: "99.9",
      spent: "7.157",
      buyCost: "7.157",
      completed: false,
    },
    {
      baseQuantity: "249.75",
      spent: "17.8925",
      buyCost: "17.8925",
      completed: false,
    },
    {
      baseQuantity: "399.6",
      spent: "28.628",
      buyCost: "28.628",
      completed: true,
    },
  ]
  for (let index = 0; index < partialBuyReports.length; index += 1) {
    const report = partialBuyReports[index]
    const fillApplied = dogeTradingReplay.waitForLifecycleEvent({
      eventName: "execution.fill_applied",
      occurrence: index + 1,
    })
    await dogeTradingReplay.publishOrderFill({
      order: initialBuyOrder,
      price: dogeTradingReplay.scenarioExpectations.buyPrice,
      ...report,
      commissionAsset: "DOGE",
    })
    await fillApplied
    const position = dogeTradingReplay.runtime.portfolio.getPosition({
      symbol: MARKET_SYMBOL,
    })
    const recoveryLedger = dogeTradingReplay.runtime.getRecoveryLedger({
      marketId: position.market.id,
    })
    const expected = expectedProgress[index]

    assert.equal(position.baseQuantity.amount, expected.baseQuantity, `Partial BUY execution ${index + 1} must apply gross base less its actual DOGE commission.`)
    assert.equal(position.spent.amount, expected.spent, `Partial BUY execution ${index + 1} must add its exact quote notional once.`)
    assert.equal(recoveryLedger.buyCost, expected.buyCost, `Partial BUY execution ${index + 1} must keep RecoveryLedger cost aligned with Portfolio spent.`)
    assert.equal(recoveryLedger.netSellProceeds, "0", "BUY-only replay evidence must not invent recovery SELL proceeds.")
    if (!expected.completed) {
      assert.equal(
        dogeTradingReplay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
        1,
        "The next standing BUY must not be submitted while the original BUY remains partially filled.",
      )
    }
  }
}

async function assertPartialBuyRecoveryOrders({
  dogeTradingReplay,
  recoverySellSubmitted,
  nextStandingBuySubmitted,
}) {
  await recoverySellSubmitted
  const nextStandingBuyOrder = await nextStandingBuySubmitted
  assert.equal(
    dogeTradingReplay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
    2,
    "The completed BUY must advance to exactly one next standing BUY.",
  )
  const recoverySellOrders = dogeTradingReplay.submittedCanonicalOrders
    .filter((order) => order.side === "SELL")
  const recoverySellOrder = recoverySellOrders.at(-1)
  assert.ok(recoverySellOrder, "The fully reconciled BUY must create its required recovery SELL.")
  assertOrderMatches(
    recoverySellOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "SELL",
      price: dogeTradingReplay.scenarioExpectations.sellPrice,
      quantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
      orderType: "LIMIT",
    },
    "The recovery SELL must use the exact aggregate inventory after all partial BUY executions and actual base commissions.",
  )
  assertOrderMatches(
    nextStandingBuyOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      price: dogeTradingReplay.scenarioExpectations.nextBuyPrice,
      quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      orderType: "LIMIT",
    },
    "The next standing BUY must follow the acknowledged recovery SELL after the original BUY is fully reconciled.",
  )
  const recoverySellIndex = dogeTradingReplay.submittedCanonicalOrders.indexOf(recoverySellOrder)
  const nextStandingBuyIndex = dogeTradingReplay.submittedCanonicalOrders.findIndex(
    (order) => order.clientOrderId === nextStandingBuyOrder.clientOrderId,
  )
  assert.ok(
    recoverySellIndex < nextStandingBuyIndex,
    "The recovery SELL must be acknowledged before the next standing BUY is submitted.",
  )
  const supersededRecoverySellOrders = recoverySellOrders.slice(0, -1)
  assert.ok(
    supersededRecoverySellOrders.every((order) =>
      dogeTradingReplay.confirmedCanceledOrders.some(
        (canceledOrder) => canceledOrder.clientOrderId === order.clientOrderId,
      )),
    "Every recovery SELL superseded by later partial BUY executions must be authoritatively canceled before replacement.",
  )
}

function assertPartialBuyExecutionReports({ dogeTradingReplay } = {}) {
  assert.deepEqual(
    dogeTradingReplay.receivedExecutionReports.map(({ executedOrder, fill }) => ({
      cumulativeExecutedQuantity: executedOrder.executedQuantity,
      orderStatus: executedOrder.status,
      fillQuantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    })),
    [
      {
        cumulativeExecutedQuantity: "100",
        orderStatus: "PARTIALLY_FILLED",
        fillQuantity: "100",
        quoteQuantity: "7.157",
        commissionAmount: "0.1",
        commissionAsset: "DOGE",
      },
      {
        cumulativeExecutedQuantity: "250",
        orderStatus: "PARTIALLY_FILLED",
        fillQuantity: "150",
        quoteQuantity: "10.7355",
        commissionAmount: "0.15",
        commissionAsset: "DOGE",
      },
      {
        cumulativeExecutedQuantity: "400",
        orderStatus: "FILLED",
        fillQuantity: "150",
        quoteQuantity: "10.7355",
        commissionAmount: "0.15",
        commissionAsset: "DOGE",
      },
    ],
    "The runtime replay must preserve incremental fills separately from each cumulative canonical order snapshot.",
  )
  assert.equal(
    dogeTradingReplay.harvesterRuntimeErrors.length,
    0,
    "A valid sequence of partial BUY executions must not produce runtime accounting or order-transition errors.",
  )
}

runDogeTradingReplayTest("accounts streamed partial BUY executions before advancing the completed-BUY lifecycle", async (dogeTradingReplay) => {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.buyPrice)
  const recoverySellSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL")
  const nextStandingBuySubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY", 2)
  await applyPartialBuyReports({
    dogeTradingReplay,
    initialBuyOrder,
    partialBuyReports: createPartialBuyReports({ initialBuyOrder }),
  })
  await assertPartialBuyRecoveryOrders({
    dogeTradingReplay,
    recoverySellSubmitted,
    nextStandingBuySubmitted,
  })
  assertPartialBuyExecutionReports({ dogeTradingReplay })
})


async function publishRecoverySellExecution({ dogeTradingReplay, recoverySellOrder, execution }) {
  const { occurrence, ...fill } = execution;
  const fillApplied = dogeTradingReplay.waitForLifecycleEvent({
    eventName: "execution.fill_applied",
    occurrence,
  });
  await dogeTradingReplay.publishOrderFill({
    order: recoverySellOrder,
    price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
    ...fill,
    commissionAsset: "USDT",
  });
  await fillApplied;
}

function assertPartialRecoverySellAccounting({ dogeTradingReplay }) {
  const position = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  const recoveryLedger = dogeTradingReplay.runtime.getRecoveryLedger({ marketId: position.market.id });
  assert.equal(position.baseQuantity.amount, "199.6", "The first partial SELL must debit only its 200 DOGE execution from active inventory.");
  assert.equal(position.spent.amount, "28.628", "A partial recovery SELL must preserve the full accumulated BUY cost basis.");
  assert.equal(position.quoteNetCashFlow.amount, "-14.234408", "Portfolio quote cash flow must include only the first SELL's exact net proceeds.");
  assert.equal(recoveryLedger.buyCost, "28.628", "RecoveryLedger must preserve the full BUY cost while recovery remains incomplete.");
  assert.equal(recoveryLedger.netSellProceeds, "14.393592", "RecoveryLedger must add the first SELL's quote proceeds less its actual USDT commission.");
  assert.equal(dogeTradingReplay.receivedLifecycleEvents.filter(({ name }) => name === "recovery.cycle_completed").length, 0, "A PARTIALLY_FILLED recovery SELL must not publish recovery completion.");
  assert.equal(dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "SELL").length, 1, "A partial recovery SELL must remain the same exchange order without replacement.");
  assert.equal(dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "BUY").length, 2, "A partial recovery SELL must not create another standing BUY.");
}

function assertPartialRecoverySellExecutionReports({ dogeTradingReplay }) {
  const sellExecutionReports = dogeTradingReplay.receivedExecutionReports
    .filter(({ executedOrder }) => executedOrder.side === "SELL")
    .map(({ executedOrder, fill }) => ({
      cumulativeExecutedQuantity: executedOrder.executedQuantity,
      orderStatus: executedOrder.status,
      fillQuantity: fill.quantity,
      quoteQuantity: fill.quoteQuantity,
      commissionAmount: fill.commissionAmount,
      commissionAsset: fill.commissionAsset,
    }));
  assert.deepEqual(sellExecutionReports, [
    {
      cumulativeExecutedQuantity: "200",
      orderStatus: "PARTIALLY_FILLED",
      fillQuantity: "200",
      quoteQuantity: "14.408",
      commissionAmount: "0.014408",
      commissionAsset: "USDT",
    },
    {
      cumulativeExecutedQuantity: "398",
      orderStatus: "FILLED",
      fillQuantity: "198",
      quoteQuantity: "14.26392",
      commissionAmount: "0.01426392",
      commissionAsset: "USDT",
    },
  ], "The recovery SELL replay must preserve incremental fills, cumulative order quantities, and actual quote-asset commissions.");
}



async function publishBuyExecution({ dogeTradingReplay, initialBuyOrder, execution }) {
  const { occurrence, ...fill } = execution;
  const fillApplied = dogeTradingReplay.waitForLifecycleEvent({
    eventName: "execution.fill_applied",
    occurrence,
  });
  await dogeTradingReplay.publishOrderFill({
    order: initialBuyOrder,
    price: dogeTradingReplay.scenarioExpectations.buyPrice,
    ...fill,
    commissionAsset: "DOGE",
  });
  await fillApplied;
}

function assertPartialBuyAccountingAfterOutOfOrderExecutions({ dogeTradingReplay }) {
  const position = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  const recoveryLedger = dogeTradingReplay.runtime.getRecoveryLedger({ marketId: position.market.id });
  assert.equal(position.baseQuantity.amount, "299.7", "Both distinct BUY fills must be reflected immediately even though the earlier execution report carries a stale cumulative order snapshot.");
  assert.equal(position.spent.amount, "21.471", "Portfolio cost basis must include the exact quote notional from both distinct BUY executions.");
  assert.equal(position.quoteNetCashFlow.amount, "-21.471", "Portfolio quote cash flow must include both BUY executions without treating a stale order snapshot as a reversal.");
  assert.equal(recoveryLedger.buyCost, "21.471", "RecoveryLedger must include both distinct BUY executions while the exchange order remains partially filled.");
  assert.equal(recoveryLedger.netSellProceeds, "0", "Out-of-order BUY execution delivery must not invent SELL proceeds before a recovery SELL exists.");
  assert.equal(dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "SELL").length, 0, "A partial BUY order must not create a recovery SELL before its terminal execution is reconciled.");
  assert.equal(dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "BUY").length, 1, "A partial BUY order must not advance the strategy or submit a second standing BUY.");
  const buyOrderUpdates = dogeTradingReplay.receivedLifecycleEvents
    .filter(({ name, data }) => name === "order.updated" && data.clientOrderId === dogeTradingReplay.receivedExecutionReports[0].executedOrder.clientOrderId)
    .map(({ data }) => data.executedQuantity);
  assert.deepEqual(buyOrderUpdates, ["300"], "The stale earlier order snapshot must not publish or install a backwards canonical executed quantity.");
}

function assertFinalOutOfOrderBuyAccounting({ dogeTradingReplay }) {
  const position = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  const recoveryLedger = dogeTradingReplay.runtime.getRecoveryLedger({ marketId: position.market.id });
  assert.equal(position.baseQuantity.amount, "399.6", "Terminal reconciliation must retain all three distinct BUY fills less their actual DOGE commissions.");
  assert.equal(position.spent.amount, "28.628", "Final Portfolio cost basis must equal the sum of all three actual BUY quote notionals.");
  assert.equal(recoveryLedger.buyCost, "28.628", "Final RecoveryLedger cost basis must match Portfolio after the out-of-order executions are reconciled.");
  assert.equal(dogeTradingReplay.receivedLifecycleEvents.filter(({ name }) => name === "execution.fill_applied").length, 3, "Each of the three distinct BUY execution identities must publish exactly one applied-fill event.");
  assert.equal(dogeTradingReplay.harvesterRuntimeErrors.length, 0, "A valid out-of-order execution sequence must not produce a Harvester accounting or lifecycle error.");
}

runDogeTradingReplayTest("accounts an identical duplicate partial BUY execution only once", async (dogeTradingReplay) => {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay);
  const firstExecutionTimestamp = Math.max(Date.now(), initialBuyOrder.createdAt + 1);
  const duplicateExecution = {
    occurrence: 1,
    tradeId: "6521",
    fillQuantity: "200",
    cumulativeExecutedQuantity: "200",
    quoteQuantity: "14.314",
    commissionAmount: "0.2",
    timestamp: firstExecutionTimestamp,
  };
  await publishBuyExecution({
    dogeTradingReplay,
    initialBuyOrder,
    execution: duplicateExecution,
  });
  await dogeTradingReplay.publishOrderFill({
    order: initialBuyOrder,
    price: dogeTradingReplay.scenarioExpectations.buyPrice,
    ...duplicateExecution,
    commissionAsset: "DOGE",
  });

  const position = dogeTradingReplay.runtime.portfolio.getPosition({ symbol: MARKET_SYMBOL });
  const recoveryLedger = dogeTradingReplay.runtime.getRecoveryLedger({ marketId: position.market.id });
  assert.equal(position.baseQuantity.amount, "199.8", "Delivering the same DOGE execution report twice must debit its 0.2 DOGE commission and gross fill only once.");
  assert.equal(position.spent.amount, "14.314", "The duplicate partial BUY report must not double the Portfolio quote cost.");
  assert.equal(recoveryLedger.buyCost, "14.314", "The duplicate partial BUY report must not double the RecoveryLedger cost basis.");
  assert.equal(dogeTradingReplay.receivedLifecycleEvents.filter(({ name }) => name === "execution.fill_applied").length, 1, "An identical duplicate stream execution must publish exactly one applied-fill event.");
  assert.equal(dogeTradingReplay.receivedExecutionReports.length, 2, "The runtime replay must prove the same raw execution report was delivered twice.");
  assert.equal(dogeTradingReplay.harvesterRuntimeErrors.length, 0, "An identical duplicate execution report must be ignored without a runtime accounting error.");
});

runDogeTradingReplayTest("accounts distinct partial BUY fills when their cumulative order reports arrive out of order", async (dogeTradingReplay) => {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay);
  const firstExecutionTimestamp = Math.max(Date.now(), initialBuyOrder.createdAt + 1);
  await publishBuyExecution({
    dogeTradingReplay,
    initialBuyOrder,
    execution: {
      occurrence: 1,
      tradeId: "6523",
      fillQuantity: "100",
      cumulativeExecutedQuantity: "300",
      quoteQuantity: "7.157",
      commissionAmount: "0.1",
      timestamp: firstExecutionTimestamp + 1,
    },
  });
  await publishBuyExecution({
    dogeTradingReplay,
    initialBuyOrder,
    execution: {
      occurrence: 2,
      tradeId: "6522",
      fillQuantity: "200",
      cumulativeExecutedQuantity: "200",
      quoteQuantity: "14.314",
      commissionAmount: "0.2",
      timestamp: firstExecutionTimestamp,
    },
  });
  assertPartialBuyAccountingAfterOutOfOrderExecutions({ dogeTradingReplay });

  const recoverySellSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL");
  const nextStandingBuySubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY", 2);
  await publishBuyExecution({
    dogeTradingReplay,
    initialBuyOrder,
    execution: {
      occurrence: 3,
      tradeId: "6524",
      fillQuantity: "100",
      cumulativeExecutedQuantity: "400",
      quoteQuantity: "7.157",
      commissionAmount: "0.1",
      timestamp: firstExecutionTimestamp + 2,
    },
  });
  const [recoverySellOrder, nextStandingBuyOrder] = await Promise.all([
    recoverySellSubmitted,
    nextStandingBuySubmitted,
  ]);
  assertRecoveryOrders({
    dogeTradingReplay,
    recoverySellOrder,
    nextStandingBuyOrder,
  });
  assertFinalOutOfOrderBuyAccounting({ dogeTradingReplay });
  assert.deepEqual(
    dogeTradingReplay.receivedExecutionReports.map(({ executedOrder }) => executedOrder.executedQuantity),
    ["300", "200", "400"],
    "The stream must deliver the later cumulative snapshot before the earlier one, then the final terminal snapshot.",
  );
});

runDogeTradingReplayTest("accounts partial recovery SELL executions and completes only after the terminal fill", async (dogeTradingReplay) => {
  const { recoverySellOrder } = await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay);
  const firstExecutionTimestamp = Math.max(Date.now(), recoverySellOrder.createdAt + 1);
  await publishRecoverySellExecution({
    dogeTradingReplay,
    recoverySellOrder,
    execution: {
      occurrence: 2,
      tradeId: "6511",
      fillQuantity: "200",
      cumulativeExecutedQuantity: "200",
      quoteQuantity: "14.408",
      commissionAmount: "0.014408",
      timestamp: firstExecutionTimestamp,
    },
  });
  assertPartialRecoverySellAccounting({ dogeTradingReplay });

  const recoveryCompletion = dogeTradingReplay.waitForRecoveryCycleCompletion();
  await publishRecoverySellExecution({
    dogeTradingReplay,
    recoverySellOrder,
    execution: {
      occurrence: 3,
      tradeId: "6512",
      fillQuantity: "198",
      cumulativeExecutedQuantity: "398",
      quoteQuantity: "14.26392",
      commissionAmount: "0.01426392",
      timestamp: firstExecutionTimestamp + 1,
    },
  });
  const recoveryCycleResult = await recoveryCompletion;
  assertSingleCycleCompletionResult({
    dogeTradingReplay,
    recoveryCycleResult,
  });
  assertSingleCyclePosition(dogeTradingReplay);
  assertPartialRecoverySellExecutionReports({ dogeTradingReplay });
  assert.equal(dogeTradingReplay.harvesterRuntimeErrors.length, 0, "A valid partial-to-terminal recovery SELL sequence must not produce runtime accounting or lifecycle errors.");
});
