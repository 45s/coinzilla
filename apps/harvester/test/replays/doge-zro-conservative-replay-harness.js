import assert from "node:assert/strict";
import {
  Asset,
  Balance,
  CanonicalOrder,
  Commission,
  Fill,
  Money,
  Order,
  Quantity,
} from "@coinzilla/entities";
import { BinanceWebSocketBroker } from "@coinzilla/brokers";
import { multiplyDecimal, percentageToRate } from "@coinzilla/utils";
import { createBinanceBrokerAdapter } from "../../src/infrastructure/brokers/binance-broker-adapter.js";
import { startHarvester } from "../../src/bootstrap/start-harvester.js";

function createOpenOrderSnapshot({ order }) {
  const openOrder = new Order({
    symbol: order.market.symbol,
    type: order.type,
    side: order.side,
    quantity: Number(order.originalQuantity.amount) - Number(order.executedQuantity.amount),
    price: Number(order.limitPrice.amount),
    id: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
  });
  openOrder.originalPrice = order.limitPrice.amount;
  openOrder.originalQuantity = order.originalQuantity.amount;
  openOrder.executedQuantity = order.executedQuantity.amount;
  openOrder.status = order.status === "OPEN" ? "NEW" : "PARTIALLY_FILLED";
  return openOrder;
}

function createExchangeMarketMetadata({ marketSymbol, appConfig, exchangeFilters = {} }) {
  const baseAsset = marketSymbol.slice(0, -4);
  const marketConfiguration = appConfig.strategies.CG_coinGrabber.pairs[marketSymbol];
  const {
    tickSize = marketConfiguration.pricePrecision === 5 ? "0.00001" : "0.001",
    minQty = marketConfiguration.quantityPrecision === 0 ? "1" : "0.01",
    stepSize = marketConfiguration.quantityPrecision === 0 ? "1" : "0.01",
    minNotional = "5",
  } = exchangeFilters;
  return {
    symbol: marketSymbol,
    baseAsset,
    quoteAsset: "USDT",
    orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
    filters: [
      {
        filterType: "PRICE_FILTER",
        minPrice: "0",
        maxPrice: "100000",
        tickSize,
      },
      {
        filterType: "LOT_SIZE",
        minQty,
        maxQty: "100000000",
        stepSize,
      },
      {
        filterType: "MIN_NOTIONAL",
        minNotional,
        applyToMarket: true,
        avgPriceMins: 5,
      },
    ],
  };
}

function createScenarioExpectations() {
  return {
    initialPrice: "0.07161000",
    buyPrice: "0.07157",
    nextBuyPrice: "0.07153",
    sellPrice: "0.07203",
    sellFillPrice: "0.07204",
    expectedSellQuantity: "398",
    expectedFreeQuantity: "1.6",
    expectedProfit: "0.01524808",
  };
}

function createDogeReplayState({ marketSymbol, appConfig, exchangeFilters, scenarioExpectations }) {
  return {
    marketSymbol,
    marketConfiguration: appConfig.strategies.CG_coinGrabber.pairs[marketSymbol],
    dogeExchangeInfo: createExchangeMarketMetadata({ marketSymbol,
appConfig,
exchangeFilters }),
    scenarioExpectations: scenarioExpectations ?? createScenarioExpectations(),
    submittedCanonicalOrders: [],
    brokerOrderPlacementRequests: [],
    receivedMarketPriceEvents: [],
    receivedExecutionReports: [],
    receivedLifecycleEvents: [],
    harvesterRuntimeErrors: [],
    marketPriceEventHandlers: new Map(),
    exchangeOpenOrders: new Map(),
    exchangeOrderHistory: new Map(),
    exchangeCanonicalFills: new Map(),
    confirmedCanceledOrders: [],
    submittedOrderWaiters: [],
    nextExchangeOrderId: 1,
    publishUserDataEvent: undefined,
    recoveryCycleCompletionResult: undefined,
    recoveryCycleCompletionWaiter: undefined,
  };
}

function notifyOrderWaiters(state) {
  for (let index = state.submittedOrderWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = state.submittedOrderWaiters[index];
    if (!waiter.isReady()) {
      continue;
    }
    state.submittedOrderWaiters.splice(index, 1);
    waiter.resolve();
  }
}

function waitForSubmittedOrder({ state, side, occurrence = 1 }) {
  const matches = (order) => order.market.symbol === state.marketSymbol && order.side === side;
  const getOrders = () => state.submittedCanonicalOrders.filter(matches);
  const existing = getOrders();
  if (existing.length >= occurrence) {
    return Promise.resolve(existing[occurrence - 1]);
  }
  return new Promise((...settlers) => {
    const [resolve, reject] = settlers;
    const timeoutRef = { current: undefined };
    const waiter = {
      matches,
      isReady: () => getOrders().length >= occurrence,
      resolve: () => {
        clearTimeout(timeoutRef.current);
        resolve(getOrders()[occurrence - 1]);
      },
    };
    timeoutRef.current = setTimeout(() => {
      const index = state.submittedOrderWaiters.indexOf(waiter);
      if (index >= 0) {
        state.submittedOrderWaiters.splice(index, 1);
      }
      reject(new Error(
        `Timed out waiting for ${state.marketSymbol} ${side} order #${occurrence}; observed ${getOrders().length} matching orders`,
      ));
    }, 5000);
    state.submittedOrderWaiters.push(waiter);
  });
}

function waitForRecoveryCycleCompletion(state) {
  if (state.recoveryCycleCompletionResult) {
    return Promise.resolve(state.recoveryCycleCompletionResult);
  }
  return new Promise((...settlers) => {
    const [resolve, reject] = settlers;
    const timeoutRef = { current: undefined };
    const resolveCycle = (data) => {
      clearTimeout(timeoutRef.current);
      resolve(data);
    };
    timeoutRef.current = setTimeout(() => {
      if (state.recoveryCycleCompletionWaiter === resolveCycle) {
        state.recoveryCycleCompletionWaiter = undefined;
      }
      reject(new Error(`Timed out waiting for recovery.cycle_completed for ${state.marketSymbol}`));
    }, 5000);
    state.recoveryCycleCompletionWaiter = resolveCycle;
  });
}

function createDogeReplayTradingRequest(state) {
  return async (...requestArguments) => {
    const [method, params = {}] = requestArguments;
    if (method === "order.place") {
      state.brokerOrderPlacementRequests.push({ method,
params: { ...params } });
    }
    if (method === "exchangeInfo") {
      return { data: { symbols: [state.dogeExchangeInfo] } };
    }
    if (method === "myFilters") {
      return { data: { symbolFilters: [],
exchangeFilters: [],
assetFilters: [] } };
    }
    if (method === "ticker.price") {
      return { data: { symbol: state.marketSymbol,
price: state.scenarioExpectations.initialPrice } };
    }
    if (method === "order.place") {
      const timestamp = Date.now();
      return {
        data: {
          symbol: params.symbol,
          orderId: state.nextExchangeOrderId++,
          clientOrderId: params.newClientOrderId,
          price: params.price,
          origQty: params.quantity,
          executedQty: "0",
          status: "NEW",
          type: params.type,
          side: params.side,
          time: timestamp,
          updateTime: timestamp,
        },
      };
    }
    throw new Error(`Unexpected simulated Binance RPC method: ${method}`);
  };
}

function createDogeReplayCanonicalOrderCreator({ state, broker }) {
  const createCanonicalOrder = broker.createCanonicalOrder.bind(broker);
  return async (order) => {
    const result = await createCanonicalOrder(order);
    if (result?.ok) {
      const canonicalOrder = result.data;
      state.submittedCanonicalOrders.push({
        clientOrderId: canonicalOrder.clientOrderId,
        brokerOrderId: canonicalOrder.brokerOrderId,
        market: canonicalOrder.market,
        side: canonicalOrder.side,
        type: canonicalOrder.type,
        limitPrice: canonicalOrder.limitPrice,
        originalQuantity: canonicalOrder.originalQuantity,
        executedQuantity: canonicalOrder.executedQuantity,
        status: canonicalOrder.status,
        createdAt: canonicalOrder.createdAt,
        acknowledgedAt: canonicalOrder.acknowledgedAt,
        updatedAt: canonicalOrder.updatedAt,
        completedAt: canonicalOrder.completedAt,
        price: canonicalOrder.limitPrice.amount,
        quantity: canonicalOrder.originalQuantity.amount,
      });
      state.exchangeOpenOrders.set(canonicalOrder.clientOrderId, canonicalOrder);
      state.exchangeOrderHistory.set(canonicalOrder.brokerOrderId, canonicalOrder);
      notifyOrderWaiters(state);
    }
    return result;
  };
}

function createDogeReplayUserDataSubscription(state) {
  return async ({ onEvent }) => {
    state.publishUserDataEvent = (message) => {
      state.receivedExecutionReports.push(message.event);
      const executionFill = message.event?.fill;
      const fillOrderId = executionFill?.brokerOrderId ?? executionFill?.orderId;
      if (executionFill && fillOrderId !== undefined && fillOrderId !== null) {
        const brokerOrderId = String(fillOrderId);
        const order = state.exchangeOrderHistory.get(brokerOrderId);
        if (order) {
          const commissionAsset = executionFill.commissionAsset === order.market.baseAsset.code
            ? order.market.baseAsset
            : order.market.quoteAsset;
          const commissions = executionFill.commissionAmount && executionFill.commissionAmount !== "0"
            ? [new Commission({
              amount: new Money({ amount: executionFill.commissionAmount,
asset: commissionAsset }),
            })]
            : [];
          const canonicalFill = new Fill({
            tradeId: String(executionFill.tradeId ?? executionFill.id),
            brokerOrderId,
            market: order.market,
            side: executionFill.side,
            price: new Money({ amount: executionFill.price,
asset: order.market.quoteAsset }),
            quantity: new Quantity({ amount: executionFill.quantity,
asset: order.market.baseAsset }),
            quoteQuantity: new Money({ amount: executionFill.quoteQuantity,
asset: order.market.quoteAsset }),
            liquidityRole: executionFill.isMaker ? "MAKER" : "TAKER",
            executedAt: executionFill.time,
            commissions,
            commissionStatus: "COMPLETE",
          });
          const canonicalFills = state.exchangeCanonicalFills.get(brokerOrderId) ?? [];
          canonicalFills.push(canonicalFill);
          state.exchangeCanonicalFills.set(brokerOrderId, canonicalFills);
        }
      }
      return onEvent(message);
    };
    return { data: { disconnect: async () => {} } };
  };
}

function createDogeReplayCandleHistory(state) {
  return async ({ symbol: requestedSymbol, interval, limit = 101 } = {}) => {
    if (requestedSymbol !== state.marketSymbol || interval !== "1m") {
      throw new Error(`Unexpected simulated candle request: ${requestedSymbol} ${interval}`);
    }
    return {
      ok: true,
      data: Array.from({ length: Math.min(limit, 101) }, (...values) => {
        const [, index] = values;
        return {
          symbol: requestedSymbol,
          interval,
          openTime: index * 60_000,
          closeTime: index * 60_000 + 59_999,
          open: "1",
          high: "1.1",
          low: "0.9",
          close: "1",
          volume: "1",
          isClosed: index < Math.min(limit, 101) - 1,
        };
      }),
    };
  };
}

function createDogeReplayCandleSubscription() {
  return async ({ symbol: requestedSymbol, interval, onCandle } = {}) => {
    for (const index of [100, 101, 102]) {
      await onCandle({
        symbol: requestedSymbol,
        interval,
        openTime: index * 60_000,
        closeTime: index * 60_000 + 59_999,
        open: "1",
        high: "1.1",
        low: "0.9",
        close: "1",
        volume: "1",
        isClosed: true,
      });
    }
    return {
      ok: true,
      data: {
        stream: `${requestedSymbol.toLowerCase()}@kline_${interval}`,
        unsubscribe: async () => {},
      },
    };
  };
}

function createDogeReplayPriceSubscription(state) {
  return async ({ subscribedSymbol, symbol: requestedSymbol, onPrice }) => {
    const targetMarketSymbol = requestedSymbol ?? subscribedSymbol ?? state.marketSymbol;
    state.marketPriceEventHandlers.set(targetMarketSymbol, (event) => {
      state.receivedMarketPriceEvents.push(event);
      return onPrice(event);
    });
    return { ok: true,
data: { unsubscribe: async () => {} } };
  };
}

function createDogeReplayCancelOrder(state) {
  return async ({ orderId } = {}) => {
    const brokerOrderId = String(orderId);
    const order = state.exchangeOrderHistory.get(brokerOrderId);
    if (!order) {
      return { ok: false,
errors: [new Error("simulated exchange order not found")] };
    }
    const timestamp = Date.now();
    const canceledCanonicalOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: order.executedQuantity,
      status: "CANCELED",
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: timestamp,
      completedAt: timestamp,
    });
    state.exchangeOpenOrders.delete(order.clientOrderId);
    state.exchangeOrderHistory.set(brokerOrderId, canceledCanonicalOrder);
    state.confirmedCanceledOrders.push(canceledCanonicalOrder);
    return { ok: true,
data: canceledCanonicalOrder };
  };
}

function createDogeReplayBrokerFactory(state) {
  return ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      tradingMode: brokerConfig.tradingMode,
      logger,
    });
    broker.connect = async () => { broker.connected = true; };
    broker.disconnect = async () => { broker.connected = false; };
    broker.tradingConnection.request = createDogeReplayTradingRequest(state);
    broker.createCanonicalOrder = createDogeReplayCanonicalOrderCreator({
      state,
      broker,
    });
    broker.getOpenOrders = async ({ symbol: requestedSymbol } = {}) => ({
      ok: true,
      data: [...state.exchangeOpenOrders.values()]
        .filter((order) => !requestedSymbol || order.market.symbol === requestedSymbol)
        .map((order) => createOpenOrderSnapshot({ order })),
    });
    broker.getFills = async ({ orderId } = {}) => ({
      ok: true,
      data: state.exchangeCanonicalFills.get(String(orderId)) ?? [],
    });
    broker.getCanonicalOrderHistory = async ({ orderId, symbol: requestedSymbol } = {}) => ({
      ok: true,
      data: [...state.exchangeOrderHistory.values()].filter(
        (order) =>
          (!orderId || order.brokerOrderId === String(orderId)) &&
          (!requestedSymbol || order.market.symbol === requestedSymbol),
      ),
    });
    broker.getCanonicalOrder = async () => ({ ok: false,
errors: [new Error("not found")] });
    broker.getAccountSnapshot = async () => ({
      ok: true,
      data: {
        sourceTime: Date.now(),
        balances: [state.marketSymbol.slice(0, -4), "USDT"].map((code) => {
          const asset = new Asset({ id: code.toLowerCase(),
code });
          return new Balance({
            free: new Quantity({ amount: code === "USDT" ? "1000" : "0",
asset }),
            locked: new Quantity({ amount: "0",
asset }),
          });
        }),
      },
    });
    broker.userDataSession.subscribe = createDogeReplayUserDataSubscription(state);
    broker.getCandles = createDogeReplayCandleHistory(state);
    broker.subscribeForCandles = createDogeReplayCandleSubscription();
    broker.subscribeForPrices = createDogeReplayPriceSubscription(state);
    broker.subscribeForBookTicker = async () => ({
      ok: true,
      data: { unsubscribe: async () => {} },
    });
    broker.cancelOrder = createDogeReplayCancelOrder(state);
    return broker;
  };
}

async function startDogeReplayRuntime({ state, appConfig, brokerFactory }) {
  const runtime = await startHarvester({
    loadConfig: async () => appConfig,
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
      NODE_ENV: "development",
      TRADING_MODE: "testnet",
    },
    brokerAdapterFactory: ({ config, logger }) => createBinanceBrokerAdapter({
      config,
      logger,
      brokerFactory,
    }),
    eventPublisher: {
      publish: (event) => {
        state.receivedLifecycleEvents.push(event);
        if (event.name === "recovery.cycle_completed") {
          state.recoveryCycleCompletionResult = event.data;
          state.recoveryCycleCompletionWaiter?.(event.data);
          state.recoveryCycleCompletionWaiter = undefined;
        }
        return { ok: true };
      },
      flush: async () => ({ ok: true,
durable: true }),
    },
    logger: {
      info() {},
      debug() {},
      error: (entry) => state.harvesterRuntimeErrors.push(entry),
    },
  });
  assert.equal(runtime.userDataReady, true, "The replay must finish user-data reconciliation before accepting simulated market events.");
  return runtime;
}

async function publishDogeReplayMarketPrice({ state, price }) {
  const marketPriceHandler = state.marketPriceEventHandlers.get(state.marketSymbol);
  assert.equal(
    typeof marketPriceHandler,
    "function",
    `${state.marketSymbol} must have an active market-price subscription before a price event is published.`,
  );
  await marketPriceHandler({
    eventType: "aggTrade",
    eventTime: Date.now(),
    timestamp: Date.now(),
    symbol: state.marketSymbol,
    price,
    quantity: "100",
    isBuyerMaker: false,
    wasBestPrice: true,
    aggId: Date.now(),
    firstId: Date.now(),
    lastId: Date.now(),
  });
}

async function publishDogeReplayFullOrderFill({ state, order, price, tradeId, commissionAmount, commissionAsset, timestamp = Date.now() }) {
  const executedBaseQuantity = order.originalQuantity.amount;
  const executedQuoteQuantity = multiplyDecimal({ left: price,
right: executedBaseQuantity });
  const executionCommissionRate = percentageToRate({
    percent: String(
      order.type === "LIMIT_MAKER"
        ? state.marketConfiguration.makerPercent
        : state.marketConfiguration.takerPercent,
    ),
  });
  const executionCommissionAsset = order.side === "BUY" ? order.market.baseAsset : order.market.quoteAsset;
  const commissionCalculationBasis = order.side === "BUY" ? executedBaseQuantity : executedQuoteQuantity;
  const executionCommissionAmount = multiplyDecimal({
    left: commissionCalculationBasis,
    right: executionCommissionRate,
  });
  const fullyFilledCanonicalOrder = new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({ amount: executedBaseQuantity,
asset: order.market.baseAsset }),
    status: "FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
  state.exchangeOpenOrders.delete(order.clientOrderId);
  state.exchangeOrderHistory.set(order.brokerOrderId, fullyFilledCanonicalOrder);
  return state.publishUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        symbol: state.marketSymbol,
        id: order.brokerOrderId,
        clientOrderId: order.clientOrderId,
        type: order.type,
        side: order.side,
        quantity: executedBaseQuantity,
        executedQuantity: executedBaseQuantity,
        price: order.limitPrice.amount,
        status: "FILLED",
        createdAt: order.createdAt,
        updatedAt: timestamp,
      },
      fill: {
        symbol: state.marketSymbol,
        id: tradeId,
        orderId: order.brokerOrderId,
        side: order.side,
        commissionAmount: commissionAmount ?? executionCommissionAmount,
        commissionAsset: commissionAsset ?? executionCommissionAsset.code,
        isMaker: order.type === "LIMIT_MAKER",
        price,
        quantity: executedBaseQuantity,
        quoteQuantity: executedQuoteQuantity,
        time: timestamp,
      },
    },
  });
}

export async function createDogeTradingReplay({ marketSymbol, appConfig, exchangeFilters, scenarioExpectations }) {
  const state = createDogeReplayState({ marketSymbol,
appConfig,
exchangeFilters,
scenarioExpectations });
  const brokerFactory = createDogeReplayBrokerFactory(state);
  const runtime = await startDogeReplayRuntime({ state,
appConfig,
brokerFactory });
  return {
    runtime,
    symbol: marketSymbol,
    marketConfiguration: state.marketConfiguration,
    scenarioExpectations: state.scenarioExpectations,
    submittedCanonicalOrders: state.submittedCanonicalOrders,
    confirmedCanceledOrders: state.confirmedCanceledOrders,
    brokerOrderPlacementRequests: state.brokerOrderPlacementRequests,
    receivedMarketPriceEvents: state.receivedMarketPriceEvents,
    receivedExecutionReports: state.receivedExecutionReports,
    receivedLifecycleEvents: state.receivedLifecycleEvents,
    harvesterRuntimeErrors: state.harvesterRuntimeErrors,
    waitForSubmittedOrder: (...orderArguments) => {
      const [side, occurrence = 1] = orderArguments;
      return waitForSubmittedOrder({ state,
side,
occurrence });
    },
    waitForRecoveryCycleCompletion: () => waitForRecoveryCycleCompletion(state),
    publishMarketPrice: (price) => publishDogeReplayMarketPrice({
      state,
      price,
    }),
    publishFullOrderFill: (fillOptions) => publishDogeReplayFullOrderFill({
      state,
      ...fillOptions,
    }),
  };
}
