import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHarvesterConfig } from '../../src/domain/harvester-config.js';
const configUrl = new URL('../../config.json', import.meta.url);
const validConfig = JSON.parse(await readFile(configUrl, 'utf8'));
const strategy = (config) => config.strategies.CG_coinGrabber;

test('accepts nested CG_coinGrabber config and preserves mode toggles', () => {
  assert.equal(validateHarvesterConfig(validConfig), validConfig);
  assert.equal(Object.hasOwn(validConfig, 'runtime'), false, 'exchange selection must not be stored in config.json');
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

test('requires at least 0.01 net quote profit', () => {
  for (const minProfit of [0, 0.009, -0.01]) {
    const config = structuredClone(validConfig);
    strategy(config).settings.minProfit = minProfit;
    assert.throws(() => validateHarvesterConfig(config), /minProfit.*greater than or equal to 0.01/);
  }
  const boundary = structuredClone(validConfig);
  strategy(boundary).settings.minProfit = 0.01;
  assert.equal(validateHarvesterConfig(boundary), boundary);
});

test('rejects enabling the deferred Aggressive mode', () => {
  const config = structuredClone(validConfig);
  strategy(config).settings.aggressive.enabled = true;
  assert.throws(() => validateHarvesterConfig(config), /settings.*aggressive.*enabled.*Aggressive strategy is deferred/);
});

test('requires enabled CG_coinGrabber and Conservative mode', () => {
  const strategyDisabled = structuredClone(validConfig);
  strategy(strategyDisabled).enabled = false;
  assert.throws(() => validateHarvesterConfig(strategyDisabled), /CG_coinGrabber.*enabled.*must remain enabled/);
  const conservativeDisabled = structuredClone(validConfig);
  strategy(conservativeDisabled).settings.conservative.enabled = false;
  assert.throws(() => validateHarvesterConfig(conservativeDisabled), /settings.*conservative.*enabled.*Conservative must remain enabled/);
});

test('rejects legacy flat settings/pairs and missing strategy-owned objects', () => {
  assert.throws(() => validateHarvesterConfig({ settings: { minProfit: 0.01 }, pairs: {} }), /strategies.*expected an object/);
  const noSettings = structuredClone(validConfig); delete strategy(noSettings).settings;
  assert.throws(() => validateHarvesterConfig(noSettings), /CG_coinGrabber.*settings.*expected an object/);
  const noPairs = structuredClone(validConfig); delete strategy(noPairs).pairs;
  assert.throws(() => validateHarvesterConfig(noPairs), /CG_coinGrabber.*pairs.*expected an object/);
});

test('rejects priceStepPercent values that make the calculated BUY price invalid', () => {
  for (const priceStepPercent of [100, 100.01, 150]) {
    const config = structuredClone(validConfig);
    strategy(config).pairs.DOGEUSDT.priceStepPercent = priceStepPercent;
    assert.throws(() => validateHarvesterConfig(config), /priceStepPercent.*less than 100/);
  }
  const boundary = structuredClone(validConfig);
  strategy(boundary).pairs.DOGEUSDT.priceStepPercent = 99.999;
  assert.equal(validateHarvesterConfig(boundary), boundary);
});

test('rejects empty pairs', () => {
  const config = structuredClone(validConfig); strategy(config).pairs = {};
  assert.throws(() => validateHarvesterConfig(config), /CG_coinGrabber.*pairs.*at least one pair/);
});

test('rejects invalid pair enabled flags, amounts, fees, and precision', () => {
  const invalidEnabled = structuredClone(validConfig); strategy(invalidEnabled).pairs.DOGEUSDT.enabled = 'true';
  assert.throws(() => validateHarvesterConfig(invalidEnabled), /pairs.*DOGEUSDT.*enabled.*expected a boolean/);
  const invalidInvestment = structuredClone(validConfig); strategy(invalidInvestment).pairs.DOGEUSDT.investment = 0;
  assert.throws(() => validateHarvesterConfig(invalidInvestment), /investment.*greater than 0/);
  const invalidOrderQuantity = structuredClone(validConfig); strategy(invalidOrderQuantity).pairs.DOGEUSDT.orderQuantity = 0;
  assert.throws(() => validateHarvesterConfig(invalidOrderQuantity), /orderQuantity.*greater than 0/);
  const negativeFee = structuredClone(validConfig); strategy(negativeFee).pairs.DOGEUSDT.makerPercent = -0.01;
  assert.throws(() => validateHarvesterConfig(negativeFee), /makerPercent/);
  const makerFeeAtUpperBound = structuredClone(validConfig); strategy(makerFeeAtUpperBound).pairs.DOGEUSDT.makerPercent = 100;
  assert.throws(() => validateHarvesterConfig(makerFeeAtUpperBound), /makerPercent.*less than 100/);
  const takerFeeAtUpperBound = structuredClone(validConfig); strategy(takerFeeAtUpperBound).pairs.DOGEUSDT.takerPercent = 100;
  assert.throws(() => validateHarvesterConfig(takerFeeAtUpperBound), /takerPercent.*less than 100/);
  const highestValidFees = structuredClone(validConfig);
  strategy(highestValidFees).pairs.DOGEUSDT.makerPercent = 99.999;
  strategy(highestValidFees).pairs.DOGEUSDT.takerPercent = 99.999;
  assert.equal(validateHarvesterConfig(highestValidFees), highestValidFees);
  const invalidPrecision = structuredClone(validConfig); strategy(invalidPrecision).pairs.DOGEUSDT.pricePrecision = 1.5;
  assert.throws(() => validateHarvesterConfig(invalidPrecision), /pricePrecision/);
});


test("the default Harvester config includes the trader Telegram profile without credentials", () => {
  assert.equal(
    validConfig.notifications.telegram.enabled,
    true,
    "Telegram policy must be enabled in the single config while transport credentials remain external.",
  )
  assert.equal(
    validConfig.notifications.telegram.profile,
    "trader",
    "The default Telegram profile must provide useful trading alerts without verbose event noise.",
  )
  assert.deepEqual(
    validConfig.notifications.telegram.markets,
    [],
    "An empty Telegram market list must mean all configured markets rather than silently suppressing alerts.",
  )
  assert.deepEqual(
    validConfig.notifications.telegram.events,
    {},
    "The default profile must not require custom overrides.",
  )
})
