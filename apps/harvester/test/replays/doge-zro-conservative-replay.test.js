import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createDogeTradingReplay } from "./doge-zro-conservative-replay-harness.js"

const test = (...testArguments) => {
  const [name, ...options] = testArguments;
  return nodeTest(`[doge-zro-conservative-replay.test.js] ${name}`, ...options);
};

const MARKET_SYMBOL = "DOGEUSDT"
const FIRST_BUY_TRADE_ID = 645
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

function assertRecoverySellOnly({ dogeTradingReplay, recoverySellOrder }) {
  assertOrderMatches(
    recoverySellOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "SELL",
      price: dogeTradingReplay.scenarioExpectations.sellPrice,
      quantity: dogeTradingReplay.scenarioExpectations.expectedSellQuantity,
      orderType: "LIMIT",
    },
    "The actual BUY fill must create the recovery SELL at the calculated price and sellable quantity.",
  )
  assert.equal(
    dogeTradingReplay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
    1,
    "No next standing BUY may be submitted while this recovery cycle remains active.",
  )
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
  )
  assert.deepEqual(
    brokerOrderRequests.map(({ side }) => side),
    ["BUY", "SELL"],
    "The broker must receive the recovery SELL but no next standing BUY while the cycle remains unresolved.",
  )
}
runDogeTradingReplayTest("submits only the recovery SELL while the recovery cycle remains active", async (dogeTradingReplay) => {
  const { recoverySellOrder } = await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay)
  assertRecoverySellOnly({
    dogeTradingReplay,
    recoverySellOrder,
  })
  assertBuyExecutionReport(dogeTradingReplay)
  assertBrokerOrderRequestSequence(dogeTradingReplay)
})
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
  const { recoverySellOrder } = await submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay)
  const nextStandingBuySubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY", 2)
  const executionTimestamp = Math.max(Date.now(), recoverySellOrder.createdAt + 1);
  const completion = dogeTradingReplay.waitForRecoveryCycleCompletion();
  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.sellFillPrice);
  await dogeTradingReplay.publishFullOrderFill({
    order: recoverySellOrder,
    price: dogeTradingReplay.scenarioExpectations.sellFillPrice,
    tradeId: SINGLE_CYCLE_RECOVERY_SELL_TRADE_ID,
    timestamp: executionTimestamp,
  });
  const recoveryCycleResult = await completion
  const nextStandingBuyOrder = await nextStandingBuySubmitted
  assertOrderMatches(
    nextStandingBuyOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      price: dogeTradingReplay.scenarioExpectations.nextBuyPrice,
      quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      orderType: "LIMIT",
    },
    "The next standing BUY becomes eligible only after full recovery-cycle completion and basis reset.",
  )
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

  await dogeTradingReplay.publishMarketPrice(
    dogeTradingReplay.scenarioExpectations.buyPrice,
  )
  await dogeTradingReplay.publishFullOrderFill({
    order: initialBuyOrder,
    price: dogeTradingReplay.scenarioExpectations.buyPrice,
    tradeId: String(FIRST_BUY_TRADE_ID),
  })

  try {
    const recoverySellOrder = await recoverySellOrderSubmitted
    return {
      initialBuyOrder,
      recoverySellOrder,
    }
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
}) {
  await recoverySellSubmitted
  assert.equal(
    dogeTradingReplay.submittedCanonicalOrders.filter((order) => order.side === "BUY").length,
    1,
    "Completing the original BUY must not submit a next BUY while recovery is unresolved.",
  )
  const recoverySellOrder = dogeTradingReplay.submittedCanonicalOrders
    .filter((order) => order.side === "SELL")
    .at(-1)
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

runDogeTradingReplayTest("accounts streamed partial BUY executions before recovery SELL planning", async (dogeTradingReplay) => {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.buyPrice)
  const recoverySellSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL")
  await applyPartialBuyReports({
    dogeTradingReplay,
    initialBuyOrder,
    partialBuyReports: createPartialBuyReports({ initialBuyOrder }),
  })
  await assertPartialBuyRecoveryOrders({
    dogeTradingReplay,
    recoverySellSubmitted,
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
  assert.equal(dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "BUY").length, 1, "A partial recovery SELL must not create another standing BUY.");
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

async function completeOutOfOrderBuyCycle({ dogeTradingReplay, initialBuyOrder, firstExecutionTimestamp }) {
  const recoverySellSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL")
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
  })
  const recoverySellOrder = await recoverySellSubmitted
  assertRecoverySellOnly({
    dogeTradingReplay,
    recoverySellOrder,
  })
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
  const buyOrderUpdates = dogeTradingReplay.receivedLifecycleEvents
    .filter(({ name, data }) => name === "order.updated" && data.clientOrderId === initialBuyOrder.clientOrderId)
    .map(({ data }) => data.executedQuantity);
  assert.deepEqual(buyOrderUpdates, ["200"], "The identical duplicate order snapshot must not publish a second canonical order-state update.");
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

  await completeOutOfOrderBuyCycle({
    dogeTradingReplay,
    initialBuyOrder,
    firstExecutionTimestamp,
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

  assert.equal(
    dogeTradingReplay.submittedCanonicalOrders.filter(({ side }) => side === "BUY").length,
    1,
    "A partially filled recovery SELL must not reopen BUY admission.",
  )
  const recoveryCompletion = dogeTradingReplay.waitForRecoveryCycleCompletion()
  const nextStandingBuySubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY", 2)
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
  const recoveryCycleResult = await recoveryCompletion
  const nextStandingBuyOrder = await nextStandingBuySubmitted
  assertOrderMatches(
    nextStandingBuyOrder,
    {
      marketSymbol: MARKET_SYMBOL,
      side: "BUY",
      price: dogeTradingReplay.scenarioExpectations.nextBuyPrice,
      quantity: String(dogeTradingReplay.marketConfiguration.orderQuantity),
      orderType: "LIMIT",
    },
    "The next BUY may be submitted only after the partial recovery SELL becomes terminal and the cycle completes.",
  )
  assertSingleCycleCompletionResult({
    dogeTradingReplay,
    recoveryCycleResult,
  });
  assertSingleCyclePosition(dogeTradingReplay);
  assertPartialRecoverySellExecutionReports({ dogeTradingReplay });
  assert.equal(dogeTradingReplay.harvesterRuntimeErrors.length, 0, "A valid partial-to-terminal recovery SELL sequence must not produce runtime accounting or lifecycle errors.");
});
