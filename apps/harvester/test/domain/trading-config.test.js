import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTradingConfig } from '../../src/domain/trading-config.js';

const configUrl = new URL('../../trading-config.json', import.meta.url);
const validConfig = JSON.parse(await readFile(configUrl, 'utf8'));

test('accepts the initial Harvester trading configuration', () => {
  assert.equal(validateTradingConfig(validConfig), validConfig);
});

test('rejects a missing strategies object', () => {
  assert.throws(
    () => validateTradingConfig({}),
    /strategies.*expected an object/,
  );
});

test('rejects an empty strategies collection', () => {
  assert.throws(
    () => validateTradingConfig({ strategies: {} }),
    /strategies.*at least one strategy/,
  );
});

test('rejects invalid strategy flags and missing settings', () => {
  const config = structuredClone(validConfig);
  config.strategies['free-roll'].enabled = 'true';

  assert.throws(
    () => validateTradingConfig(config),
    /strategies\.free-roll\.enabled.*expected a boolean/,
  );
});

test('rejects non-positive order quantities', () => {
  const config = structuredClone(validConfig);
  config.strategies['free-roll'].pairs.DOGEUSDT.orderQuantity = 0;

  assert.throws(
    () => validateTradingConfig(config),
    /orderQuantity.*greater than 0/,
  );
});

test('rejects negative fees and invalid precision', () => {
  const negativeFee = structuredClone(validConfig);
  negativeFee.strategies['free-roll'].pairs.DOGEUSDT.makerPercent = -0.01;
  assert.throws(() => validateTradingConfig(negativeFee), /makerPercent/);

  const invalidPrecision = structuredClone(validConfig);
  invalidPrecision.strategies['free-roll'].pairs.DOGEUSDT.pricePrecision = 1.5;
  assert.throws(() => validateTradingConfig(invalidPrecision), /pricePrecision/);
});
