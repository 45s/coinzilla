import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from '@coinzilla/entities';
import { toResult } from '@coinzilla/utils';
import { startHarvester } from '../../src/bootstrap/start-harvester.js';

test('loads configuration before returning the startup context', async () => {
  const tradingConfig = {
    settings: { minProfit: 0.01 },
    strategies: { conservative: { enabled: true }, aggressive: { enabled: false } },
    pairs: { ZROUSDT: { enabled: true } },
  };
  const configSource = '/etc/harvester/trading-config.json';
  const calls = [];

  const context = await startHarvester({
    configSource,
    loadConfig: async (source) => {
      calls.push(source);
      return tradingConfig;
    },
  });

  assert.deepEqual(calls, [configSource]);
  assert.equal(context.tradingConfig, tradingConfig);
  assert.equal(Object.isFrozen(context), true);
});

test('fails startup when configuration loading or validation fails', async () => {
  const startupError = new TypeError('Invalid trading config');

  await assert.rejects(
    startHarvester({
      loadConfig: async () => {
        throw startupError;
      },
    }),
    (error) => error === startupError,
  );
});

test('loads the default validated trading configuration', async () => {
  const context = await startHarvester();

  assert.ok(context.tradingConfig.pairs.ZROUSDT);
});


test('ordinary TRADE fills update owned accounting without another account snapshot or adopting external inventory/orders', async () => {
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
  const tradingConfig = {
    settings: { minProfit: '0.01' },
    strategies: { conservative: { enabled: true }, aggressive: { enabled: false } },
    pairs: {
      ZROUSDT: {
        enabled: true,
        priceStepPercent: 0.5,
        orderQuantity: 10,
        keepQuantity: 1,
        makerPercent: 0,
        takerPercent: 0,
        investment: 1000,
      },
    },
  };
  let accountSnapshotCalls = 0;
  let openOrderSnapshotCalls = 0;
  let orderSequence = 0;
  let lastOrder;
  let onPrice;
  let onUserDataEvent;
  let observedTrade;
  const tradeObserved = new Promise((resolve) => { observedTrade = resolve; });
  const broker = {
    connect: async () => {},
    disconnect: async () => {},
    placeOrder: async ({ order } = {}) => {
      lastOrder = order;
      return toResult({
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
        executedQuantity: new Quantity({ amount: '0', asset: baseAsset }),
        status: 'OPEN',
      }),
      });
    },
    get lastOrder() { return lastOrder; },
    cancelOrder: async () => toResult({ error: new Error('Unexpected cancellation') }),
    getOpenOrders: async () => {
      openOrderSnapshotCalls += 1;
      return toResult({ data: [{ orderId: 'external-order' }] });
    },
    getFills: async () => toResult({ data: [] }),
    getCanonicalOrderHistory: async () => toResult({ data: [] }),
    getAccountSnapshot: async () => {
      accountSnapshotCalls += 1;
      return toResult({ data: { balances, sourceTime: accountSnapshotCalls } });
    },
    getSymbolFilters: async () => toResult({ data: marketMetadata }),
    getPrices: async () => toResult({ data: [] }),
    subscribeForPrices: async ({ onPrice: callback } = {}) => {
      onPrice = callback;
      return toResult({ data: { unsubscribe: async () => {} } });
    },
    subscribeForUserData: async ({ onEvent: callback } = {}) => {
      onUserDataEvent = callback;
      return toResult({ data: { disconnect: async () => {} } });
    },
  };
  const context = await startHarvester({
    loadConfig: async () => tradingConfig,
    brokerAdapterFactory: () => broker,
    env: {
      HARVESTER_BROKER: 'binance',
      HARVESTER_ENABLE_TRADING: 'true',
      HARVESTER_TRADING_MODE: 'testnet',
      NODE_ENV: 'test',
      BINANCE_API_KEY: 'test-key',
      BINANCE_API_SECRET_KEY: 'test-secret',
    },
    logger: { debug() {}, info() {}, error() {} },
    onUserDataEvent: async ({ event } = {}) => {
      if (event?.executionType === 'TRADE') observedTrade();
    },
  });

  assert.equal(context.userDataReady, true);
  assert.equal(accountSnapshotCalls, 1);
  assert.equal(openOrderSnapshotCalls, 0);
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
  await tradeObserved;
  await context.stop();

  assert.equal(accountSnapshotCalls, 1);
  assert.equal(openOrderSnapshotCalls, 0);
  assert.equal(context.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, '10');
});
