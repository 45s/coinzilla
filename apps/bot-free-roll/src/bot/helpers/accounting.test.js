import test from "node:test"
import assert from "node:assert/strict"

import { estimateBuyAccounting, estimateSellAccounting, getFeeRate, getFeeRateExact, estimateBuyAccountingExact, estimateSellAccountingExact, getOrderType, getConfiguredSellFeeRateExact, calculateFillAccountingExact, calculateCommissionRateExact } from "./accounting.js"

test("getFeeRate converts pair commission percentages to a conservative decimal rate", () => {
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0 }), 0)
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.04 }), 0.00075)
})

test("getFeeRate rejects missing or invalid commission percentages", () => {
  for (const value of [undefined, null, -0.01, 100, Number.NaN, Infinity]) {
    assert.throws(() => getFeeRate({ makerPercent: value, takerPercent: 0 }))
    assert.throws(() => getFeeRate({ makerPercent: 0, takerPercent: value }))
  }
})

test("buy and sell quote accounting return exact decimal strings", () => {
  const buy = estimateBuyAccounting({
    quantity: 100,
    price: 0.1,
    feeRate: 0.001,
  });
  const sell = estimateSellAccounting({
    quantity: 100,
    price: 0.1,
    feeRate: 0.001,
  });

  assert.equal(buy.estimatedCost, "10.01");
  assert.equal(sell.estimatedProceeds, "9.99");
});

test("exact fee and fill accounting preserve decimal strings", () => {
  const feeRate = getFeeRateExact({ makerPercent: 0.075, takerPercent: 0.075 });
  assert.equal(feeRate, "0.00075");

  assert.deepEqual(
    estimateBuyAccountingExact({ quantity: "100", price: "0.1", feeRate }),
    { netQuantity: "99.925", estimatedCost: "10.0075" },
  );
  assert.deepEqual(
    estimateSellAccountingExact({ quantity: "100", price: "0.1", feeRate }),
    { estimatedProceeds: "9.9925", estimatedBaseDeduction: "100.075" },
  );
});

test("zero maker commission selects post-only orders and zero SELL fee reserve", () => {
  assert.equal(getOrderType({ makerPercent: 0 }), "LIMIT_MAKER");
  assert.equal(getConfiguredSellFeeRateExact({ makerPercent: 0, takerPercent: 0.075 }), "0");
  assert.equal(getOrderType({ makerPercent: 0.075 }), "LIMIT");
  assert.equal(getConfiguredSellFeeRateExact({ makerPercent: 0.075, takerPercent: 0.1 }), "0.001");
  assert.throws(() => getConfiguredSellFeeRateExact({ makerPercent: 0, takerPercent: -0.1 }));
  assert.throws(() => getOrderType({ makerPercent: -0.1 }));
});

test("actual BUY commissions are applied in the asset Binance charged", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0.075",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "99.925",
    quoteQuantity: "10",
  });

  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0.01",
    commissionAsset: "FDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "100",
    quoteQuantity: "10.01",
  });
});

test("actual SELL commissions are applied in the asset Binance charged", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "SELL",
    quantity: "50",
    quoteQuantity: "5",
    commissionAmount: "0.0375",
    commissionAsset: "FDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "50",
    quoteQuantity: "4.9625",
  });

  assert.deepEqual(calculateFillAccountingExact({
    side: "SELL",
    quantity: "50",
    quoteQuantity: "5",
    commissionAmount: "0.01",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "50.01",
    quoteQuantity: "5",
  });
});

test("zero commissions do not require an inferred commission asset", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "10",
    quoteQuantity: "2",
    commissionAmount: "0",
    commissionAsset: null,
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "10",
    quoteQuantity: "2",
  });
});

test("third-asset and incomplete commissions fail closed", () => {
  const base = {
    side: "BUY",
    quantity: "10",
    quoteQuantity: "2",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  };

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    commissionAmount: "0.01",
    commissionAsset: "BNB",
  }), /Unsupported commission asset/);

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    commissionAmount: "0.01",
    commissionAsset: null,
  }), /must include its asset/);
});

test("calculates effective commission rate from the actual commission asset", () => {
  assert.equal(calculateCommissionRateExact({
    price: "0.1",
    quoteQuantity: "10",
    commissionAmount: "0.075",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }), "0.00075");

  assert.equal(calculateCommissionRateExact({
    price: "0.1",
    quoteQuantity: "10",
    commissionAmount: "0.0075",
    commissionAsset: "USDT",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }), "0.00075");

  assert.equal(calculateCommissionRateExact({
    price: "0.1",
    quoteQuantity: "10",
    commissionAmount: "0",
    commissionAsset: null,
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }), "0");

  assert.throws(() => calculateCommissionRateExact({
    price: "0.1",
    quoteQuantity: "10",
    commissionAmount: "0.001",
    commissionAsset: "BNB",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }), /Unsupported commission asset/);
});
