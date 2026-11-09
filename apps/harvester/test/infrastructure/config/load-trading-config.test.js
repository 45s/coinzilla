import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTradingConfig } from '../../../src/infrastructure/config/load-trading-config.js';

function assertTradingConfigStructure(config) {
  assert.ok(config && typeof config === 'object' && !Array.isArray(config));
  assert.ok(config.strategies && typeof config.strategies === 'object');
  assert.ok(config.strategies.CG_coinGrabber, 'the config contains the CG_coinGrabber strategy');

  const strategy = config.strategies.CG_coinGrabber;
  assert.equal(typeof strategy.enabled, 'boolean');
  assert.ok(strategy.settings && typeof strategy.settings === 'object');
  assert.ok(strategy.pairs && typeof strategy.pairs === 'object' && !Array.isArray(strategy.pairs));
  assert.ok(Object.keys(strategy.pairs).length > 0, 'the strategy contains at least one pair');

  for (const pair of Object.values(strategy.pairs)) {
    assert.ok(pair && typeof pair === 'object' && !Array.isArray(pair));
    assert.equal(typeof pair.enabled, 'boolean');
    for (const key of [
      'investment',
      'orderQuantity',
      'keepQuantity',
      'priceStepPercent',
      'pricePrecision',
      'quantityPrecision',
      'makerPercent',
      'takerPercent',
    ]) {
      assert.ok(Object.hasOwn(pair, key), `each pair contains the system field ${key}`);
    }
  }
}

test('loads and validates the default trading config structure', async () => {
  const config = await loadTradingConfig();

  assertTradingConfigStructure(config);
});

test('loads a config from a supplied path', async () => {
  const config = await loadTradingConfig(new URL('../../../trading-config.json', import.meta.url));

  assertTradingConfigStructure(config);
});

test('reports the source path when JSON is malformed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'harvester-config-'));
  const path = join(directory, 'invalid.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, '{ invalid json');

  await assert.rejects(
    loadTradingConfig(path),
    (error) => error instanceof SyntaxError
      && error.message.includes(path)
      && error.cause instanceof SyntaxError,
  );
});

test('reports a useful error when the file does not exist', async () => {
  await assert.rejects(
    loadTradingConfig('/path/that/does/not/exist.json'),
    /Unable to read trading config/,
  );
});

test('rejects structurally invalid JSON after parsing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'harvester-config-'));
  const path = join(directory, 'invalid-shape.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({ strategies: { CG_coinGrabber: { enabled: true, settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } }, pairs: {} } } }));

  await assert.rejects(loadTradingConfig(path), /at least one pair/);
});
