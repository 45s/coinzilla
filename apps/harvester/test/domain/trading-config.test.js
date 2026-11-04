import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTradingConfig } from '../../src/domain/trading-config.js';
const configUrl = new URL('../../trading-config.json', import.meta.url);
const validConfig = JSON.parse(await readFile(configUrl, 'utf8'));
const strategy = (config) => config.strategies.CG_coinGrabber;

test('accepts nested CG_coinGrabber config and preserves mode toggles', () => {
  assert.equal(validateTradingConfig(validConfig), validConfig);
  assert.equal(strategy(validConfig).enabled, true);
  assert.equal(strategy(validConfig).settings.minProfit, 0.01);
  assert.equal(strategy(validConfig).settings.conservative.enabled, true);
  assert.equal(strategy(validConfig).settings.aggressive.enabled, false);
  assert.ok(strategy(validConfig).pairs.ZROUSDT);
  assert.equal(strategy(validConfig).pairs.ZROUSDT.makerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.ZROUSDT.takerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.SOLFDUSD.makerPercent, 0);
  assert.equal(strategy(validConfig).pairs.SOLFDUSD.takerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.ZROFDUSD.makerPercent, 0);
  assert.equal(strategy(validConfig).pairs.ZROFDUSD.takerPercent, 0.1);
  assert.equal('settings' in validConfig, false);
  assert.equal('pairs' in validConfig, false);
});

test('rejects enabling the deferred Aggressive mode', () => {
  const config = structuredClone(validConfig);
  strategy(config).settings.aggressive.enabled = true;
  assert.throws(() => validateTradingConfig(config), /settings.*aggressive.*enabled.*Aggressive strategy is deferred/);
});

test('requires enabled CG_coinGrabber and Conservative mode', () => {
  const strategyDisabled = structuredClone(validConfig);
  strategy(strategyDisabled).enabled = false;
  assert.throws(() => validateTradingConfig(strategyDisabled), /CG_coinGrabber.*enabled.*must remain enabled/);
  const conservativeDisabled = structuredClone(validConfig);
  strategy(conservativeDisabled).settings.conservative.enabled = false;
  assert.throws(() => validateTradingConfig(conservativeDisabled), /settings.*conservative.*enabled.*Conservative must remain enabled/);
});

test('rejects legacy flat settings/pairs and missing strategy-owned objects', () => {
  assert.throws(() => validateTradingConfig({ settings: { minProfit: 0.01 }, pairs: {} }), /strategies.*expected an object/);
  const noSettings = structuredClone(validConfig); delete strategy(noSettings).settings;
  assert.throws(() => validateTradingConfig(noSettings), /CG_coinGrabber.*settings.*expected an object/);
  const noPairs = structuredClone(validConfig); delete strategy(noPairs).pairs;
  assert.throws(() => validateTradingConfig(noPairs), /CG_coinGrabber.*pairs.*expected an object/);
});

test('rejects empty pairs', () => {
  const config = structuredClone(validConfig); strategy(config).pairs = {};
  assert.throws(() => validateTradingConfig(config), /CG_coinGrabber.*pairs.*at least one pair/);
});

test('rejects invalid pair enabled flags, amounts, fees, and precision', () => {
  const invalidEnabled = structuredClone(validConfig); strategy(invalidEnabled).pairs.DOGEUSDT.enabled = 'true';
  assert.throws(() => validateTradingConfig(invalidEnabled), /pairs.*DOGEUSDT.*enabled.*expected a boolean/);
  const invalidInvestment = structuredClone(validConfig); strategy(invalidInvestment).pairs.DOGEUSDT.investment = 0;
  assert.throws(() => validateTradingConfig(invalidInvestment), /investment.*greater than 0/);
  const invalidOrderQuantity = structuredClone(validConfig); strategy(invalidOrderQuantity).pairs.DOGEUSDT.orderQuantity = 0;
  assert.throws(() => validateTradingConfig(invalidOrderQuantity), /orderQuantity.*greater than 0/);
  const negativeFee = structuredClone(validConfig); strategy(negativeFee).pairs.DOGEUSDT.makerPercent = -0.01;
  assert.throws(() => validateTradingConfig(negativeFee), /makerPercent/);
  const makerFeeAtUpperBound = structuredClone(validConfig); strategy(makerFeeAtUpperBound).pairs.DOGEUSDT.makerPercent = 100;
  assert.throws(() => validateTradingConfig(makerFeeAtUpperBound), /makerPercent.*less than 100/);
  const takerFeeAtUpperBound = structuredClone(validConfig); strategy(takerFeeAtUpperBound).pairs.DOGEUSDT.takerPercent = 100;
  assert.throws(() => validateTradingConfig(takerFeeAtUpperBound), /takerPercent.*less than 100/);
  const highestValidFees = structuredClone(validConfig);
  strategy(highestValidFees).pairs.DOGEUSDT.makerPercent = 99.999;
  strategy(highestValidFees).pairs.DOGEUSDT.takerPercent = 99.999;
  assert.equal(validateTradingConfig(highestValidFees), highestValidFees);
  const invalidPrecision = structuredClone(validConfig); strategy(invalidPrecision).pairs.DOGEUSDT.pricePrecision = 1.5;
  assert.throws(() => validateTradingConfig(invalidPrecision), /pricePrecision/);
});
