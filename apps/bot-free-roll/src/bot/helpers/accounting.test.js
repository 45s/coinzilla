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


test("legacy accounting rejects invalid quantities, prices, and fee rates", () => {
  for (const value of [0, -1, Number.NaN, Infinity, undefined]) {
    assert.throws(() => estimateBuyAccounting({ quantity: value, price: 1, feeRate: 0 }))
    assert.throws(() => estimateBuyAccounting({ quantity: 1, price: value, feeRate: 0 }))
    assert.throws(() => estimateSellAccounting({ quantity: value, price: 1, feeRate: 0 }))
    assert.throws(() => estimateSellAccounting({ quantity: 1, price: value, feeRate: 0 }))
  }

  for (const feeRate of [-0.001, 1, Number.NaN, Infinity, undefined]) {
    assert.throws(() => estimateBuyAccounting({ quantity: 1, price: 1, feeRate }))
    assert.throws(() => estimateSellAccounting({ quantity: 1, price: 1, feeRate }))
  }
})

test("exact accounting rejects malformed decimal strings and invalid ranges", () => {
  for (const value of [undefined, null, "", "1e-3", "not-a-number"]) {
    assert.throws(() => estimateBuyAccountingExact({ quantity: value, price: "1", feeRate: "0" }))
    assert.throws(() => estimateBuyAccountingExact({ quantity: "1", price: value, feeRate: "0" }))
    assert.throws(() => estimateBuyAccountingExact({ quantity: value, price: "1", feeRate: "0" }))
    assert.throws(() => estimateSellAccountingExact({ quantity: "1", price: value, feeRate: "0" }))
  }

  for (const [quantity, price, feeRate] of [
    ["0", "1", "0"],
    ["-1", "1", "0"],
    ["1", "0", "0"],
    ["1", "-1", "0"],
    ["1", "1", "-0.01"],
    ["1", "1", "1"],
  ]) {
    assert.throws(() => estimateBuyAccountingExact({ quantity, price, feeRate }))
  }

  for (const [quantity, price, feeRate] of [
    ["-0.01", "1", "0"],
    ["1", "0", "0"],
    ["1", "-1", "0"],
    ["1", "1", "-0.01"],
    ["1", "1", "1"],
  ]) {
    assert.throws(() => estimateSellAccountingExact({ quantity, price, feeRate }))
  }
})

test("exact fill accounting rejects invalid trade facts and commissions exceeding fills", () => {
  const base = {
    side: "BUY",
    quantity: "10",
    quoteQuantity: "20",
    commissionAmount: "0",
    commissionAsset: null,
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }

  for (const side of ["", "HOLD", null]) {
    assert.throws(() => calculateFillAccountingExact({ ...base, side }), /side must be BUY or SELL/)
  }

  for (const [baseAsset, quoteAsset] of [
    ["", "USDT"],
    ["DOGE", ""],
    ["DOGE", "DOGE"],
    [null, "USDT"],
  ]) {
    assert.throws(() => calculateFillAccountingExact({ ...base, baseAsset, quoteAsset }))
  }

  for (const [quantity, quoteQuantity, commissionAmount] of [
    ["0", "20", "0"],
    ["-1", "20", "0"],
    ["10", "0", "0"],
    ["10", "-1", "0"],
    ["10", "20", "-0.01"],
    ["10", "20", "not-a-number"],
  ]) {
    assert.throws(() => calculateFillAccountingExact({
      ...base, quantity, quoteQuantity, commissionAmount,
    }))
  }

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    commissionAmount: "10",
    commissionAsset: "DOGE",
  }), /Commission exceeds/)

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    side: "SELL",
    commissionAmount: "20.01",
    commissionAsset: "USDT",
  }), /Commission exceeds/)
})

test("exact commission-rate calculation validates inputs and asset identity", () => {
  const base = {
    price: "2",
    quoteQuantity: "20",
    commissionAmount: "0.1",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }

  for (const value of [undefined, null, "", "1e-3", "invalid"]) {
    assert.throws(() => calculateCommissionRateExact({ ...base, price: value }))
    assert.throws(() => calculateCommissionRateExact({ ...base, quoteQuantity: value }))
    assert.throws(() => calculateCommissionRateExact({ ...base, commissionAmount: value }))
  }

  for (const [price, quoteQuantity, commissionAmount] of [
    ["0", "20", "0"],
    ["-1", "20", "0"],
    ["2", "0", "0"],
    ["2", "-1", "0"],
    ["2", "20", "-0.1"],
  ]) {
    assert.throws(() => calculateCommissionRateExact({
      ...base, price, quoteQuantity, commissionAmount,
    }))
  }

  assert.throws(() => calculateCommissionRateExact({
    ...base,
    baseAsset: "DOGE",
    quoteAsset: "DOGE",
  }), /distinct non-empty strings/)

  assert.throws(() => calculateCommissionRateExact({
    ...base,
    commissionAsset: "BNB",
  }), /Unsupported commission asset/)
})

test("exact commission-rate calculation accepts zero fee without an asset", () => {
  assert.equal(calculateCommissionRateExact({
    price: "2",
    quoteQuantity: "20",
    commissionAmount: "0",
    commissionAsset: null,
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  }), "0")
})
