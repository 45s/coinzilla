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
  flush: async () => ({ ok: true, durable: true }),
})
const startHarvesterForTest = (input = {}) => {
  const eventPublisher = input.eventPublisher
    ? input.env?.NODE_ENV === "development" && typeof input.eventPublisher.flush !== "function"
      ? { ...input.eventPublisher, flush: testEventPublisher.flush }
      : input.eventPublisher
    : testEventPublisher
  return startHarvester({ ...input, eventPublisher })
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
    strategies: { CG_coinGrabber: { enabled: true, settings: { conservative: { enabled: true }, aggressive: { enabled: false } }, pairs: { ZROUSDT: { enabled: true } } } },
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
  assert.equal(context.appConfig, appConfig);
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


test('ordinary TRADE fills update owned accounting after the startup account audit', async () => {
  const baseAsset = new Asset({ id: 'asset-zro', code: 'ZRO' });
  const quoteAsset = new Asset({ id: 'asset-usdt', code: 'USDT' });
  const market = new Market({
    venue: 'binance',
    symbol: 'ZROUSDT',
    baseAsset,
    quoteAsset,
  });
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: 'PRICE_INCREMENT', status: 'SUPPORTED', value: new Money({ amount: '0.001', asset: quoteAsset }) },
      { type: 'QUANTITY_INCREMENT', status: 'SUPPORTED', value: new Quantity({ amount: '0.01', asset: baseAsset }) },
      { type: 'MIN_QUANTITY', status: 'SUPPORTED', value: new Quantity({ amount: '0.01', asset: baseAsset }) },
      { type: 'MIN_NOTIONAL', status: 'SUPPORTED', value: new Money({ amount: '1', asset: quoteAsset }) },
    ],
  });
  const marketMetadata = {
    market,
    tradingRules,
    supportedOrderTypes: ['LIMIT_MAKER'],
    unvalidatedConstraints: [],
  };
  const balances = [
    new Balance({
      free: new Quantity({ amount: '25', asset: baseAsset }),
      locked: new Quantity({ amount: '2', asset: baseAsset }),
    }),
    new Balance({
      free: new Quantity({ amount: '1000', asset: quoteAsset }),
      locked: new Quantity({ amount: '0', asset: quoteAsset }),
    }),
  ];
  const appConfig = {
    strategies: { CG_coinGrabber: { enabled: true, settings: { conservative: { enabled: true }, aggressive: { enabled: false } }, pairs: {
      ZROUSDT: {
        enabled: true,
        priceStepPercent: 0.5,
        orderQuantity: 10,
        keepQuantity: 1,
        minProfit: 0.01,
        makerPercent: 0,
        takerPercent: 0,
        investment: 1000,
      },
    } } },
  };
  let accountSnapshotCalls = 0;
  let openOrderSnapshotCalls = 0;
  const userDataErrors = [];
  let orderSequence = 0;
  let lastOrder;
  const canonicalOrders = new Map();
  const fillsByOrderId = new Map();
  let onPrice;
  let onUserDataEvent;
  let observedTrade;
  const tradeObserved = new Promise((resolve) => { observedTrade = resolve; });
  const broker = {
    connect: async () => {},
    disconnect: async () => {},
    placeOrder: async ({ order } = {}) => {
      lastOrder = order;
      const submitted = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
        executedQuantity: new Quantity({ amount: '0', asset: baseAsset }),
        status: 'OPEN',
      });
      canonicalOrders.set(submitted.brokerOrderId, submitted);
      return toResult({ data: submitted });
    },
    get lastOrder() { return lastOrder; },
    cancelOrder: async () => toResult({ error: new Error('Unexpected cancellation') }),
    getOpenOrders: async () => {
      openOrderSnapshotCalls += 1;
      return toResult({
        data: [...canonicalOrders.values()]
          .filter((order) => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status))
          .map((order) => createOpenOrderSnapshot({ order })),
      });
    },
    getFills: async ({ orderId } = {}) => toResult({ data: fillsByOrderId.get(String(orderId)) ?? [] }),
    getCanonicalOrderHistory: async ({ orderId, symbol } = {}) => toResult({
      data: [...canonicalOrders.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => toResult({ error: new Error("order not found") }),
    getAccountSnapshot: async () => {
      accountSnapshotCalls += 1;
      return toResult({ data: { balances, sourceTime: accountSnapshotCalls } });
    },
    getSymbolFilters: async () => toResult({ data: marketMetadata }),
    getExchangeMarkets: async () => toResult({ data: [market] }),
    getPrices: async () => toResult({ data: { symbol: 'ZROUSDT', price: '1' } }),
    subscribeForPrices: async ({ onPrice: callback } = {}) => {
      onPrice = callback;
      return toResult({ data: { unsubscribe: async () => {} } });
    },
    subscribeForBookTicker: async ({ onBookTicker } = {}) => {
      await onBookTicker({
        symbol: 'ZROUSDT',
        bestBidPrice: '0.9',
        bestBidQuantity: '1',
        bestAskPrice: '1.1',
        bestAskQuantity: '1',
        timestamp: 10,
      });
      return toResult({ data: { unsubscribe: async () => {} } });
    },
    subscribeForUserData: async ({ onEvent: callback } = {}) => {
      onUserDataEvent = (message) => {
        const event = message?.event;
        if (event?.executionType === 'TRADE' && event.executedOrder?.brokerOrderId) {
          const orderId = String(event.executedOrder.brokerOrderId);
          canonicalOrders.set(orderId, event.executedOrder);
          fillsByOrderId.set(orderId, [event.fill]);
        }
        return callback(message);
      };
      return toResult({ data: { disconnect: async () => {} } });
    },
  };
  const context = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    brokerAdapterFactory: () => broker,
    env: {
      NODE_ENV: 'development',
      TRADING_MODE: 'testnet',
      BINANCE_API_KEY: 'test-key',
      BINANCE_API_SECRET_KEY: 'test-secret',
    },
    now: () => 10,
    logger: { debug() {}, info() {}, error(...args) { userDataErrors.push(args) } },
    onUserDataEvent: async ({ event } = {}) => {
      if (event?.executionType === 'TRADE') observedTrade();
    },
  });

  assert.equal(context.userDataReady, true);
  assert.ok(broker.lastOrder, 'the initial ticker snapshot should submit the first Conservative BUY');
  assert.equal(accountSnapshotCalls, 1);
  assert.equal(openOrderSnapshotCalls, 1);
  assert.equal(typeof onPrice, 'function');
  assert.equal(typeof onUserDataEvent, 'function');

  await onPrice({ symbol: 'ZROUSDT', price: '1', timestamp: 10 });
  const buyIntent = broker.lastOrder;
  assert.ok(buyIntent);
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
  });
  const fill = new Fill({
    tradeId: 'trade-1',
    brokerOrderId: submittedOrder.brokerOrderId,
    clientOrderId: submittedOrder.clientOrderId,
    market,
    side: 'BUY',
    price: submittedOrder.limitPrice,
    quantity: new Quantity({ amount: '10', asset: baseAsset }),
    quoteQuantity: new Money({ amount: String(Number(buyIntent.price) * Number(buyIntent.quantity)), asset: quoteAsset }),
    liquidityRole: 'MAKER',
    commissionStatus: 'COMPLETE',
    executedAt: 11,
  });
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
  });

  onUserDataEvent({
    event: {
      eventType: 'executionReport',
      executionType: 'TRADE',
      executedOrder: filledOrder,
      fill,
    },
  });
  await waitForTestSignal(
    tradeObserved,
    'trade execution observer',
    () => ({
      userDataReady: context.userDataReady,
      userDataStatus: context.userDataStatus,
      accountedBaseQuantity: context.portfolio.getPosition({ marketId: market.id })?.baseQuantity.amount ?? '0',
      errors: userDataErrors.map(([entry]) => entry?.message ?? String(entry)),
    }),
    2000,
  );
  await context.stop();

  assert.equal(accountSnapshotCalls, 2, "the ordinary TRADE scenario must capture the PREFLIGHT and final CLOSING account snapshots; this test's TRADE does not trigger stream recovery");
  assert.equal(openOrderSnapshotCalls, 3, "the ordinary TRADE scenario must audit open orders at startup, reconcile owned orders before shutdown BUY cancellation, and reconcile them again after cancellation; neither reconciliation is a stream-recovery snapshot");
  assert.equal(context.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, '10');
});


test("subscribes and submits initial BUYs independently for every enabled Conservative market", async () => {
  const createMetadata = ({ symbol, baseCode } = {}) => {
    const baseAsset = new Asset({ id: "asset-" + baseCode.toLowerCase(), code: baseCode })
    const quoteAsset = new Asset({ id: "asset-usdt", code: "USDT" })
    const market = new Market({ venue: "binance", symbol, baseAsset, quoteAsset })
    const tradingRules = new TradingRules({
      market,
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "1", asset: quoteAsset }) },
      ],
    })
    return { market, tradingRules, supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"], unvalidatedConstraints: [] }
  }
  const metadataBySymbol = new Map([
    ["DOGEUSDT", createMetadata({ symbol: "DOGEUSDT", baseCode: "DOGE" })],
    ["ZROUSDT", createMetadata({ symbol: "ZROUSDT", baseCode: "ZRO" })],
  ])
  const markets = [...metadataBySymbol.values()].map(({ market }) => market)
  const quoteAsset = markets[0].quoteAsset
  const balances = [
    ...markets.map((market) => new Balance({
      free: new Quantity({ amount: "100", asset: market.baseAsset }),
      locked: new Quantity({ amount: "0", asset: market.baseAsset }),
    })),
    new Balance({
      free: new Quantity({ amount: "1000", asset: quoteAsset }),
      locked: new Quantity({ amount: "0", asset: quoteAsset }),
    }),
  ]
  const appConfig = {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: { conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {
          DOGEUSDT: {
            enabled: true, investment: 100, orderQuantity: 100, keepQuantity: 1,
            minProfit: 0.01,
            priceStepPercent: 0.05, pricePrecision: 3, quantityPrecision: 2,
            makerPercent: 0.1, takerPercent: 0.1,
          },
          ZROUSDT: {
            enabled: true, investment: 100, orderQuantity: 10, keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.05, pricePrecision: 3, quantityPrecision: 2,
            makerPercent: 0.1, takerPercent: 0.1,
          },
        },
      },
    },
  }
  const priceSubscriptions = new Map()
  const bookSubscriptions = []
  const submittedSymbols = []
  const diagnosticLogs = []
  let orderSequence = 0
  let snapshotSequence = 0
  const canonicalOrders = new Map()
  const broker = {
    connect: async () => {},
    disconnect: async () => {},
    placeOrder: async ({ order } = {}) => {
      const market = metadataBySymbol.get(order.symbol).market
      submittedSymbols.push(order.symbol)
      const submitted = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: market.quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: market.baseAsset }),
        executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
        status: "OPEN",
        createdAt: 10,
        acknowledgedAt: 10,
        updatedAt: 10,
      })
      canonicalOrders.set(submitted.brokerOrderId, submitted)
      return toResult({ data: submitted })
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
      canonicalOrders.set(canceled.brokerOrderId, canceled)
      return toResult({ data: canceled })
    },
    getOpenOrders: async ({ symbol } = {}) => toResult({
      data: [...canonicalOrders.values()]
        .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
        .filter((order) => !symbol || order.market.symbol === symbol)
        .map((order) => createOpenOrderSnapshot({ order })),
    }),
    getFills: async () => toResult({ data: [] }),
    getCanonicalOrderHistory: async ({ orderId, symbol } = {}) => toResult({
      data: [...canonicalOrders.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => toResult({ data: null }),
    getAccountSnapshot: async () => toResult({ data: { balances, sourceTime: ++snapshotSequence } }),
    getSymbolFilters: async ({ symbol } = {}) => toResult({ data: metadataBySymbol.get(symbol) }),
    getExchangeMarkets: async () => toResult({ data: markets }),
    getPrices: async ({ symbol } = {}) => toResult({
      data: { symbol, price: symbol === "DOGEUSDT" ? "0.1" : "1" },
    }),
    subscribeForPrices: async ({ symbol, onPrice } = {}) => {
      priceSubscriptions.set(symbol, onPrice)
      return toResult({ data: { unsubscribe: async () => {} } })
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker } = {}) => {
      bookSubscriptions.push(symbol)
      const price = symbol === "DOGEUSDT" ? "0.1" : "1"
      await onBookTicker({
        symbol,
        bestBidPrice: String(Number(price) * 0.99),
        bestBidQuantity: "100",
        bestAskPrice: String(Number(price) * 1.01),
        bestAskQuantity: "100",
        timestamp: 10,
      })
      return toResult({ data: { unsubscribe: async () => {} } })
    },
    subscribeForUserData: async () => toResult({ data: { disconnect: async () => {} } }),
  }

  const context = await startHarvesterForTest({
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
      debug(entry) { diagnosticLogs.push(entry) },
      info(entry) { diagnosticLogs.push(entry) },
      error(entry) { diagnosticLogs.push(entry) },
    },
  })

  assert.equal(context.userDataReady, true)
  assert.deepEqual([...priceSubscriptions.keys()], ["DOGEUSDT", "ZROUSDT"])
  assert.deepEqual(bookSubscriptions, ["DOGEUSDT", "ZROUSDT"])
  assert.deepEqual(submittedSymbols, ["DOGEUSDT", "ZROUSDT"], JSON.stringify(diagnosticLogs))
  assert.equal(typeof priceSubscriptions.get("DOGEUSDT"), "function")
  assert.equal(typeof priceSubscriptions.get("ZROUSDT"), "function")

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
      JSON.stringify(diagnosticLogs.filter(({ message }) =>
        message === "Shutdown order reconciliation failed" ||
        message === "paused a trading pair")),
  )
})
