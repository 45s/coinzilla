import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Order,
  Quantity,
  TradingRules,
} from '@coinzilla/entities';
import { toResult } from '@coinzilla/utils';
import { startHarvester } from '../../src/bootstrap/start-harvester.js';
import { resolveHarvesterOptions } from '../../src/bootstrap/config/resolve-harvester-options.js';
import { loadAppConfig } from '../../src/infrastructure/config/load-app-config.js';

const createOpenOrderSnapshot = ({ order }) => {
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
  openOrder.status = order.status === 'OPEN' ? 'NEW' : 'PARTIALLY_FILLED';
  return openOrder;
};

const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({
    ok: true,
    durable: true
  }),
})

const createTestCandle = ({
  symbol,
  openTime,
  isClosed = true
} = {}) => ({
  symbol,
  interval: "1m",
  openTime,
  closeTime: openTime + 59_999,
  open: "1",
  high: "1.1",
  low: "0.9",
  close: "1",
  volume: "1",
  isClosed,
})
const startHarvesterForTest = (input = {}) => {
  let eventPublisher = input.eventPublisher
  if (!eventPublisher) {
    eventPublisher = testEventPublisher
  } else if (input.env?.NODE_ENV === "development" && typeof eventPublisher.flush !== "function") {
    eventPublisher = {
      ...eventPublisher,
      flush: testEventPublisher.flush
    }
  }
  return startHarvester({
    ...input,
    eventPublisher
  })
}

function waitForTestSignal(promise, label, getDiagnostics, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      let diagnostics
      try { diagnostics = getDiagnostics?.() } catch (error) { diagnostics = String(error) }
      reject(new Error(
        "Timed out waiting for " + label + (diagnostics === undefined ? "" : ": " + JSON.stringify(diagnostics)),
      ))
    }, timeoutMs)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (error) => { clearTimeout(timeout); reject(error) },
    )
  })
}


test('loads configuration before returning the startup context', async () => {
  const appConfig = {
    strategies: { CG_coinGrabber: {
      enabled: true,
      settings: {
      conservative: { enabled: true },
      aggressive: { enabled: false }
    },
      pairs: { ZROUSDT: {
      enabled: true,
      tradingEnvironment: "both",
      enableVolatilityProtection: true
    } }
    } },
  };
  const configSource = '/etc/harvester/config.json';
  const calls = [];

  const context = await resolveHarvesterOptions({
    configSource,
    env: { TRADING_MODE: 'testnet' },
    loadConfig: async (source) => {
      calls.push(source);
      return appConfig;
    },
  });

  assert.deepEqual(calls, [configSource]);
  assert.notEqual(context.appConfig, appConfig, "Runtime resolution must build a separate effective config rather than mutating the loaded source config.");
  assert.equal(Object.hasOwn(context.appConfig.strategies.CG_coinGrabber.pairs.ZROUSDT, "tradingEnvironment"), false, "The effective runtime pair must not expose its source selector.");
  assert.equal(Object.hasOwn(appConfig.strategies.CG_coinGrabber.pairs.ZROUSDT, "tradingEnvironment"), true, "The loaded source config must retain the selector for validation.");
  assert.equal(Object.isFrozen(context), true);
});

test('fails startup when configuration loading or validation fails', async () => {
  const startupError = new TypeError('Invalid app config');

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => {
        throw startupError;
      },
    }),
    (error) => error === startupError,
  );
});

test('loads the default validated strategy and pair configuration', async () => {
  const config = await loadAppConfig();
  assert.ok(config.strategies.CG_coinGrabber.pairs.ZROFDUSD);
  assert.equal(Object.hasOwn(config, 'runtime'), false);
});


function createOrdinaryTradeMarket() {
  const baseAsset = new Asset({ id: 'asset-zro', code: 'ZRO' })
  const quoteAsset = new Asset({ id: 'asset-usdt', code: 'USDT' })
  const market = new Market({
    venue: 'binance',
    symbol: 'ZROUSDT',
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      {
        type: 'PRICE_INCREMENT',
        status: 'SUPPORTED',
        value: new Money({ amount: '0.001', asset: quoteAsset }),
      },
      {
        type: 'QUANTITY_INCREMENT',
        status: 'SUPPORTED',
        value: new Quantity({ amount: '0.01', asset: baseAsset }),
      },
      {
        type: 'MIN_QUANTITY',
        status: 'SUPPORTED',
        value: new Quantity({ amount: '0.01', asset: baseAsset }),
      },
      {
        type: 'MIN_NOTIONAL',
        status: 'SUPPORTED',
        value: new Money({ amount: '1', asset: quoteAsset }),
      },
    ],
  })
  return {
    baseAsset,
    quoteAsset,
    market,
    marketMetadata: {
      market,
      tradingRules,
      supportedOrderTypes: ['LIMIT_MAKER'],
      unvalidatedConstraints: [],
    },
  }
}

function createOrdinaryTradeBalances({ baseAsset, quoteAsset } = {}) {
  return [
    new Balance({
      free: new Quantity({ amount: '25', asset: baseAsset }),
      locked: new Quantity({ amount: '2', asset: baseAsset }),
    }),
    new Balance({
      free: new Quantity({ amount: '1000', asset: quoteAsset }),
      locked: new Quantity({ amount: '0', asset: quoteAsset }),
    }),
  ]
}

function createOrdinaryTradeConfig() {
  return {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {
          ZROUSDT: {
            enabled: true,
            tradingEnvironment: 'both',
            priceStepPercent: 0.5,
            orderQuantity: 10,
            keepQuantity: 1,
            minProfit: 0.01,
            makerPercent: 0,
            takerPercent: 0,
            investment: 1000,
          },
        },
      },
    },
  }
}

function createOrdinaryTradeState() {
  let resolveTradeObserved
  const tradeObserved = new Promise((resolve) => { resolveTradeObserved = resolve })
  return {
    accountSnapshotCalls: 0,
    openOrderSnapshotCalls: 0,
    userDataErrors: [],
    orderSequence: 0,
    lastOrder: undefined,
    canonicalOrders: new Map(),
    fillsByOrderId: new Map(),
    onPrice: undefined,
    onUserDataEvent: undefined,
    tradeObserved,
    resolveTradeObserved,
  }
}

function createOrdinaryTradeOrderPorts({ market, baseAsset, quoteAsset, state } = {}) {
  return {
    placeOrder: async ({ order } = {}) => {
      state.lastOrder = order
      const submitted = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++state.orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
        executedQuantity: new Quantity({ amount: '0', asset: baseAsset }),
        status: 'OPEN',
      })
      state.canonicalOrders.set(submitted.brokerOrderId, submitted)
      return toResult({ data: submitted })
    },
    cancelOrder: async () => toResult({ error: new Error('Unexpected cancellation') }),
    getOpenOrders: async () => {
      state.openOrderSnapshotCalls += 1
      return toResult({
        data: [...state.canonicalOrders.values()]
          .filter((order) => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status))
          .map((order) => createOpenOrderSnapshot({ order })),
      })
    },
    getFills: async ({ orderId } = {}) =>
      toResult({ data: state.fillsByOrderId.get(String(orderId)) ?? [] }),
    getCanonicalOrderHistory: async ({ orderId, symbol } = {}) => toResult({
      data: [...state.canonicalOrders.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => toResult({ error: new Error('order not found') }),
  }
}

function createOrdinaryTradeAccountPorts({ market, marketMetadata, balances, state } = {}) {
  return {
    getAccountSnapshot: async () => {
      state.accountSnapshotCalls += 1
      return toResult({
        data: {
          balances,
          sourceTime: state.accountSnapshotCalls,
        },
      })
    },
    getSymbolFilters: async () => toResult({ data: marketMetadata }),
    getExchangeMarkets: async () => toResult({ data: [market] }),
    getPrices: async () => toResult({ data: { symbol: 'ZROUSDT', price: '1' } }),
  }
}

function createOrdinaryTradeMarketDataPorts({ state } = {}) {
  return {
    getCandles: async ({ symbol } = {}) => toResult({
      data: Array.from({ length: 100 }, (_, index) =>
        createTestCandle({ symbol, openTime: index * 60_000 })),
    }),
    subscribeForCandles: async ({ symbol, onCandle } = {}) => {
      for (const index of [100, 101, 102]) {
        await onCandle(createTestCandle({ symbol, openTime: index * 60_000 }))
      }
      return toResult({ data: { unsubscribe: async () => {} } })
    },
    subscribeForPrices: async ({ onPrice } = {}) => {
      state.onPrice = onPrice
      return toResult({ data: { unsubscribe: async () => {} } })
    },
    subscribeForBookTicker: async ({ onBookTicker } = {}) => {
      await onBookTicker({
        symbol: 'ZROUSDT',
        bestBidPrice: '0.9',
        bestBidQuantity: '1',
        bestAskPrice: '1.1',
        bestAskQuantity: '1',
        timestamp: 10,
      })
      return toResult({ data: { unsubscribe: async () => {} } })
    },
  }
}

function createOrdinaryTradeUserDataPort({ state } = {}) {
  return {
    subscribeForUserData: async ({ onEvent } = {}) => {
      state.onUserDataEvent = (message) => {
        const event = message?.event
        if (event?.executionType === 'TRADE' && event.executedOrder?.brokerOrderId) {
          const orderId = String(event.executedOrder.brokerOrderId)
          state.canonicalOrders.set(orderId, event.executedOrder)
          state.fillsByOrderId.set(orderId, [event.fill])
        }
        return onEvent(message)
      }
      return toResult({ data: { disconnect: async () => {} } })
    },
  }
}

function createOrdinaryTradeBroker({ market, baseAsset, quoteAsset, marketMetadata, balances, state } = {}) {
  return {
    connect: async () => {},
    disconnect: async () => {},
    ...createOrdinaryTradeOrderPorts({ market, baseAsset, quoteAsset, state }),
    ...createOrdinaryTradeAccountPorts({ market, marketMetadata, balances, state }),
    ...createOrdinaryTradeMarketDataPorts({ state }),
    ...createOrdinaryTradeUserDataPort({ state }),
    get lastOrder() {
      return state.lastOrder
    },
  }
}

function createOrdinaryTradeStartOptions({ appConfig, broker, state } = {}) {
  return {
    loadConfig: async () => appConfig,
    brokerAdapterFactory: () => broker,
    env: {
      NODE_ENV: 'development',
      TRADING_MODE: 'testnet',
      BINANCE_API_KEY: 'test-key',
      BINANCE_API_SECRET_KEY: 'test-secret',
    },
    now: () => 10,
    logger: {
      debug() {},
      info() {},
      warn(...args) { state.userDataErrors.push(args) },
      error(...args) { state.userDataErrors.push(args) },
    },
    onUserDataEvent: async ({ event } = {}) => {
      if (event?.executionType === 'TRADE') { state.resolveTradeObserved() }
    },
  }
}

function createOrdinaryTradeFill({ market, baseAsset, quoteAsset, buyIntent } = {}) {
  const submittedOrder = new CanonicalOrder({
    clientOrderId: buyIntent?.clientOrderId ?? 'unused',
    brokerOrderId: '1',
    market,
    side: 'BUY',
    type: 'LIMIT_MAKER',
    limitPrice: new Money({ amount: buyIntent.price, asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: buyIntent.quantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: '0', asset: baseAsset }),
    status: 'OPEN',
  })
  const fill = new Fill({
    tradeId: 'trade-1',
    brokerOrderId: submittedOrder.brokerOrderId,
    clientOrderId: submittedOrder.clientOrderId,
    market,
    side: 'BUY',
    price: submittedOrder.limitPrice,
    quantity: new Quantity({ amount: '10', asset: baseAsset }),
    quoteQuantity: new Money({
      amount: String(Number(buyIntent.price) * Number(buyIntent.quantity)),
      asset: quoteAsset,
    }),
    liquidityRole: 'MAKER',
    commissionStatus: 'COMPLETE',
    executedAt: 11,
  })
  const filledOrder = new CanonicalOrder({
    clientOrderId: submittedOrder.clientOrderId,
    brokerOrderId: submittedOrder.brokerOrderId,
    market,
    side: 'BUY',
    type: 'LIMIT_MAKER',
    limitPrice: submittedOrder.limitPrice,
    originalQuantity: submittedOrder.originalQuantity,
    executedQuantity: new Quantity({ amount: '10', asset: baseAsset }),
    status: 'FILLED',
  })
  return { fill, filledOrder }
}

function assertOrdinaryTradeStartup({ context, broker, state, market } = {}) {
  assert.equal(context.userDataReady, true)
  const volatility = context.getVolatilityData({ symbol: market.symbol })
  assert.equal(volatility.ok, true)
  assert.equal(volatility.data.status.isReady, true, JSON.stringify({
    status: volatility.data.status,
    logs: state.userDataErrors.map(([entry]) => ({
      ...entry,
      error: entry.error?.message,
      stack: entry.error?.stack,
    })),
  }))
  assert.ok(broker.lastOrder, 'the startup ticker seed should be evaluated after volatility history becomes ready')
  assert.equal(state.accountSnapshotCalls, 1)
  assert.equal(state.openOrderSnapshotCalls, 1)
  assert.equal(typeof state.onPrice, 'function')
  assert.equal(typeof state.onUserDataEvent, 'function')
}

function assertOrdinaryTradeShutdown({ context, state, market } = {}) {
  assert.equal(
    state.accountSnapshotCalls,
    2,
    "the ordinary TRADE scenario must capture the PREFLIGHT and final CLOSING account snapshots; this test's TRADE does not trigger stream recovery",
  )
  assert.equal(
    state.openOrderSnapshotCalls,
    4,
    "the ordinary TRADE scenario must audit open orders at startup, reconcile before BUY cancellation, reconcile after user-data draining, and verify after recovery SELL replanning",
  )
  assert.equal(context.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, '10')
}

test('ordinary TRADE fills update owned accounting after the startup account audit', async () => {
  const marketContext = createOrdinaryTradeMarket()
  const balances = createOrdinaryTradeBalances(marketContext)
  const state = createOrdinaryTradeState()
  const broker = createOrdinaryTradeBroker({
    ...marketContext,
    balances,
    state,
  })
  const context = await startHarvesterForTest(createOrdinaryTradeStartOptions({
    appConfig: createOrdinaryTradeConfig(),
    broker,
    state,
  }))
  assertOrdinaryTradeStartup({ context, broker, state, market: marketContext.market })
  const { fill, filledOrder } = createOrdinaryTradeFill({
    ...marketContext,
    buyIntent: broker.lastOrder,
  })
  state.onUserDataEvent({
    event: {
      eventType: 'executionReport',
      executionType: 'TRADE',
      executedOrder: filledOrder,
      fill,
    },
  })
  await waitForTestSignal(
    state.tradeObserved,
    'trade execution observer',
    () => ({
      userDataReady: context.userDataReady,
      userDataStatus: context.userDataStatus,
      accountedBaseQuantity: context.portfolio.getPosition({
        marketId: marketContext.market.id,
      })?.baseQuantity.amount ?? '0',
      errors: state.userDataErrors.map(([entry]) => entry?.message ?? String(entry)),
    }),
    2000,
  )
  await context.stop()
  assertOrdinaryTradeShutdown({ context, state, market: marketContext.market })
})

function createVolatilityTestMetadata({ symbol, baseCode } = {}) {
  const baseAsset = new Asset({
    id: "asset-" + baseCode.toLowerCase(),
    code: baseCode,
  })
  const quoteAsset = new Asset({
    id: "asset-usdt",
    code: "USDT",
  })
  const market = new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.001",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: "1",
          asset: quoteAsset,
        }),
      },
    ],
  })
  return {
    market,
    tradingRules,
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    unvalidatedConstraints: [],
  }
}

function createVolatilityTestMarkets() {
  const metadataBySymbol = new Map([
    ["DOGEUSDT", createVolatilityTestMetadata({
      symbol: "DOGEUSDT",
      baseCode: "DOGE",
    })],
    ["ZROUSDT", createVolatilityTestMetadata({
      symbol: "ZROUSDT",
      baseCode: "ZRO",
    })],
  ])
  const markets = [...metadataBySymbol.values()].map(({ market }) => market)
  const quoteAsset = markets[0].quoteAsset
  const balances = [
    ...markets.map((market) => new Balance({
      free: new Quantity({
        amount: "100",
        asset: market.baseAsset,
      }),
      locked: new Quantity({
        amount: "0",
        asset: market.baseAsset,
      }),
    })),
    new Balance({
      free: new Quantity({
        amount: "1000",
        asset: quoteAsset,
      }),
      locked: new Quantity({
        amount: "0",
        asset: quoteAsset,
      }),
    }),
  ]
  return {
    metadataBySymbol,
    markets,
    balances,
  }
}

function createVolatilityTestConfig() {
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
          DOGEUSDT: {
            enabled: true,
            tradingEnvironment: "both",
            investment: 100,
            orderQuantity: 100,
            keepQuantity: 1,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 3,
            quantityPrecision: 2,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
          ZROUSDT: {
            enabled: true,
            tradingEnvironment: "both",
            investment: 100,
            orderQuantity: 10,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 3,
            quantityPrecision: 2,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

function createVolatilityTestState() {
  return {
    priceSubscriptions: new Map(),
    candleSubscriptions: new Map(),
    candleHistoryRequests: [],
    candleUnsubscriptions: [],
    bookSubscriptions: [],
    submittedSymbols: [],
    diagnosticLogs: [],
    orderSequence: 0,
    snapshotSequence: 0,
    canonicalOrders: new Map(),
  }
}

function createVolatilityOrderLifecycleBroker({ metadataBySymbol, state }) {
  return {
    connect: async () => {},
    disconnect: async () => {},
    placeOrder: async ({ order } = {}) => {
      const { market } = metadataBySymbol.get(order.symbol)
      state.submittedSymbols.push(order.symbol)
      const submitted = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++state.orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({
          amount: order.price,
          asset: market.quoteAsset,
        }),
        originalQuantity: new Quantity({
          amount: order.quantity,
          asset: market.baseAsset,
        }),
        executedQuantity: new Quantity({
          amount: "0",
          asset: market.baseAsset,
        }),
        status: "OPEN",
        createdAt: 10,
        acknowledgedAt: 10,
        updatedAt: 10,
      })
      state.canonicalOrders.set(submitted.brokerOrderId, submitted)
      return toResult({
        data: submitted,
      })
    },
    cancelOrder: async ({ order } = {}) => {
      const canceled = new CanonicalOrder({
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
        updatedAt: 11,
        completedAt: 11,
      })
      state.canonicalOrders.set(canceled.brokerOrderId, canceled)
      return toResult({
        data: canceled,
      })
    },
    getOpenOrders: async ({ symbol } = {}) => toResult({
      data: [...state.canonicalOrders.values()]
        .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
        .filter((order) => !symbol || order.market.symbol === symbol)
        .map((order) => createOpenOrderSnapshot({
          order,
        })),
    }),
    getFills: async () => toResult({
      data: [],
    }),
    getCanonicalOrderHistory: async ({ orderId, symbol } = {}) => toResult({
      data: [...state.canonicalOrders.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => toResult({
      data: null,
    }),
  }
}

function createVolatilityAccountBroker({ metadataBySymbol, markets, balances, state }) {
  return {
    getAccountSnapshot: async () => toResult({
      data: {
        balances,
        sourceTime: ++state.snapshotSequence,
      },
    }),
    getSymbolFilters: async ({ symbol } = {}) => toResult({
      data: metadataBySymbol.get(symbol),
    }),
    getExchangeMarkets: async () => toResult({
      data: markets,
    }),
    getPrices: async ({ symbol } = {}) => toResult({
      data: {
        symbol,
        price: symbol === "DOGEUSDT" ? "0.1" : "1",
      },
    }),
  }
}

function createVolatilityMarketDataBroker({ state }) {
  return {
    getCandles: async ({ symbol, interval, limit } = {}) => {
      state.candleHistoryRequests.push({
        symbol,
        interval,
        limit,
      })
      return toResult({
        data: [],
      })
    },
    subscribeForCandles: async ({ symbol, interval, onCandle } = {}) => {
      state.candleSubscriptions.set(symbol, {
        interval,
        onCandle,
      })
      return toResult({
        data: {
          unsubscribe: async () => state.candleUnsubscriptions.push(symbol),
        },
      })
    },
    subscribeForPrices: async ({ symbol, onPrice } = {}) => {
      state.priceSubscriptions.set(symbol, onPrice)
      return toResult({
        data: {
          unsubscribe: async () => {},
        },
      })
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker } = {}) => {
      state.bookSubscriptions.push(symbol)
      const price = symbol === "DOGEUSDT" ? "0.1" : "1"
      await onBookTicker({
        symbol,
        bestBidPrice: String(Number(price) * 0.99),
        bestBidQuantity: "100",
        bestAskPrice: String(Number(price) * 1.01),
        bestAskQuantity: "100",
        timestamp: 10,
      })
      return toResult({
        data: {
          unsubscribe: async () => {},
        },
      })
    },
    subscribeForUserData: async () => toResult({
      data: {
        disconnect: async () => {},
      },
    }),
  }
}

async function startVolatilityTestHarvester({ appConfig, broker, state }) {
  return startHarvesterForTest({
    loadConfig: async () => appConfig,
    brokerAdapterFactory: () => broker,
    env: {
      NODE_ENV: "development",
      TRADING_MODE: "testnet",
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET_KEY: "test-secret",
    },
    now: () => 10,
    logger: {
      debug(entry) {
        state.diagnosticLogs.push(entry)
      },
      info(entry) {
        state.diagnosticLogs.push(entry)
      },
      error(entry) {
        state.diagnosticLogs.push(entry)
      },
    },
  })
}

function assertVolatilityTestStartup({ context, state }) {
  assert.equal(context.userDataReady, true)
  assert.deepEqual([...state.priceSubscriptions.keys()], ["DOGEUSDT", "ZROUSDT"])
  assert.deepEqual(
    [...state.candleSubscriptions.keys()],
    ["DOGEUSDT", "ZROUSDT"],
    "The candle service must subscribe every enabled pair independently.",
  )
  assert.deepEqual(state.candleHistoryRequests, [
    {
      symbol: "DOGEUSDT",
      interval: "1m",
      limit: 101,
    },
    {
      symbol: "ZROUSDT",
      interval: "1m",
      limit: 101,
    },
  ], "Startup must request one-minute history for each enabled market after candle subscriptions are established.")
  assert.deepEqual(
    context.subscriptions,
    ["DOGEUSDT", "ZROUSDT"],
    "Adding candle streams must not duplicate market symbols in the existing runtime subscription summary.",
  )
  const volatility = context.getVolatilityData({
    symbol: "DOGEUSDT",
  })
  assert.equal(volatility.ok, true)
  assert.equal(
    volatility.data.status.reason,
    "INSUFFICIENT_HISTORY",
    "Missing candle history must remain explicitly unavailable for the later fail-closed gate.",
  )
  assert.deepEqual(state.bookSubscriptions, ["DOGEUSDT", "ZROUSDT"])
  assert.deepEqual(state.submittedSymbols, [], "Neither market may submit a BUY while its own candle history is insufficient.")
  assert.equal(typeof state.priceSubscriptions.get("DOGEUSDT"), "function")
  assert.equal(typeof state.priceSubscriptions.get("ZROUSDT"), "function")
}

async function assertVolatilityTestShutdown({ context, state }) {
  let shutdownError
  try {
    await context.stop()
  } catch (error) {
    shutdownError = error
  }
  assert.equal(
    shutdownError,
    undefined,
    "multi-market shutdown must reconcile both canceled BUY orders successfully; diagnostic logs: " +
      JSON.stringify(state.diagnosticLogs.filter(({ message }) =>
        message === "Shutdown order reconciliation failed" ||
        message === "paused a trading pair")),
  )
  assert.deepEqual(
    state.candleUnsubscriptions.sort(),
    ["DOGEUSDT", "ZROUSDT"],
    "Harvester shutdown must unsubscribe each live candle stream as part of market-data cleanup.",
  )
}


test("subscribes every enabled market and fail-closes BUYs until its volatility history is ready", async () => {
  const marketData = createVolatilityTestMarkets()
  const state = createVolatilityTestState()
  const appConfig = createVolatilityTestConfig()
  const broker = {
    ...createVolatilityOrderLifecycleBroker({
      metadataBySymbol: marketData.metadataBySymbol,
      state,
    }),
    ...createVolatilityAccountBroker({
      metadataBySymbol: marketData.metadataBySymbol,
      markets: marketData.markets,
      balances: marketData.balances,
      state,
    }),
    ...createVolatilityMarketDataBroker({
      state,
    }),
  }
  const context = await startVolatilityTestHarvester({
    appConfig,
    broker,
    state,
  })

  assertVolatilityTestStartup({
    context,
    state,
  })
  await assertVolatilityTestShutdown({
    context,
    state,
  })
})
