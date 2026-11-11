import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHarvesterConfig } from '../../../src/infrastructure/config/load-harvester-config.js';

function assertTradingConfigStructure(config) {
  assert.ok(config && typeof config === 'object' && !Array.isArray(config), 'The Harvester configuration must be a JSON object.');
  assert.ok(config.strategies && typeof config.strategies === 'object', 'The Harvester configuration must contain strategy-owned settings.');
  assert.ok(config.strategies.CG_coinGrabber, 'The config contains the CG_coinGrabber strategy');
  assert.equal(Object.hasOwn(config, 'runtime'), false, 'Exchange-mode profiles must not be stored in config.json.');

  const strategy = config.strategies.CG_coinGrabber;
  assert.equal(typeof strategy.enabled, 'boolean', 'The strategy must expose its enabled state.');
  assert.ok(strategy.settings && typeof strategy.settings === 'object', 'The strategy must contain its settings.');
  assert.ok(strategy.pairs && typeof strategy.pairs === 'object' && !Array.isArray(strategy.pairs), 'The strategy must contain a pair map.');
  assert.ok(Object.keys(strategy.pairs).length > 0, 'The strategy contains at least one pair');

  for (const pair of Object.values(strategy.pairs)) {
    assert.ok(pair && typeof pair === 'object' && !Array.isArray(pair), 'Each market pair must be an object.');
    assert.equal(typeof pair.enabled, 'boolean', 'Each pair must expose its enabled state.');
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
      assert.ok(Object.hasOwn(pair, key), 'Each pair contains the system field ' + key);
    }
  }
}

test('loads and validates the default Harvester config structure', async () => {
  const config = await loadHarvesterConfig();
  assertTradingConfigStructure(config);
});

test('loads a config from a supplied path', async () => {
  const config = await loadHarvesterConfig(new URL('../../../config.json', import.meta.url));
  assertTradingConfigStructure(config);
});

test('reports the source path when JSON is malformed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'harvester-config-'));
  const path = join(directory, 'invalid.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, '{ invalid json');

  await assert.rejects(
    loadHarvesterConfig(path),
    (error) => error instanceof SyntaxError
      && error.message.includes(path)
      && error.cause instanceof SyntaxError,
    'Malformed JSON must identify the source path and preserve the parser cause.',
  );
});

test('reports a useful error when the file does not exist', async () => {
  await assert.rejects(
    loadHarvesterConfig('/path/that/does/not/exist.json'),
    /Unable to read Harvester config/,
    'A missing config file must produce a path-specific load error.',
  );
});

test('rejects structurally invalid JSON after parsing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'harvester-config-'));
  const path = join(directory, 'invalid-shape.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({ strategies: { CG_coinGrabber: { enabled: true, settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } }, pairs: {} } } }));

  await assert.rejects(
    loadHarvesterConfig(path),
    /at least one pair/,
    'A structurally incomplete strategy must fail configuration validation.',
  );
});
