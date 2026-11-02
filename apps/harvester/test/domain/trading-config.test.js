import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTradingConfig } from '../../src/domain/trading-config.js';

const configUrl = new URL('../../trading-config.json', import.meta.url);
const validConfig = JSON.parse(await readFile(configUrl, 'utf8'));

test('accepts the flat Harvester trading configuration', () => {
  assert.equal(validateTradingConfig(validConfig), validConfig);
  assert.equal('strategies' in validConfig, false);
  assert.equal('free-roll' in validConfig, false);
});

test('rejects missing settings or pairs objects', () => {
  assert.throws(() => validateTradingConfig({ pairs: {} }), /settings.*expected an object/);
  assert.throws(
    () => validateTradingConfig({ settings: { minProfit: 0.01 } }),
    /pairs.*expected an object/,
  );
});

test('rejects an empty pairs collection', () => {
  assert.throws(
    () => validateTradingConfig({ settings: { minProfit: 0.01 }, pairs: {} }),
    /pairs.*at least one pair/,
  );
});

test('rejects invalid pair enabled flags', () => {
  const config = structuredClone(validConfig);
  config.pairs.DOGEUSDT.enabled = 'true';

  assert.throws(
    () => validateTradingConfig(config),
    /pairs\.DOGEUSDT\.enabled.*expected a boolean/,
  );
});

test('rejects non-positive investment and order quantities', () => {
  const invalidInvestment = structuredClone(validConfig);
  invalidInvestment.pairs.DOGEUSDT.investment = 0;
  assert.throws(() => validateTradingConfig(invalidInvestment), /investment.*greater than 0/);

  const invalidOrderQuantity = structuredClone(validConfig);
  invalidOrderQuantity.pairs.DOGEUSDT.orderQuantity = 0;
  assert.throws(() => validateTradingConfig(invalidOrderQuantity), /orderQuantity.*greater than 0/);
});

test('rejects negative fees and invalid precision', () => {
  const negativeFee = structuredClone(validConfig);
  negativeFee.pairs.DOGEUSDT.makerPercent = -0.01;
  assert.throws(() => validateTradingConfig(negativeFee), /makerPercent/);

  const invalidPrecision = structuredClone(validConfig);
  invalidPrecision.pairs.DOGEUSDT.pricePrecision = 1.5;
  assert.throws(() => validateTradingConfig(invalidPrecision), /pricePrecision/);
});
