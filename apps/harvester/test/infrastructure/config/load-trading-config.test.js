import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTradingConfig } from '../../../src/infrastructure/config/load-trading-config.js';

test('loads and validates the default trading config', async () => {
  const config = await loadTradingConfig();

  assert.equal(config.strategies['free-roll'].pairs.ZROUSDT.enabled, true);
});

test('loads a config from a supplied path', async () => {
  const config = await loadTradingConfig(new URL('../../../trading-config.json', import.meta.url));

  assert.ok(config.strategies['free-roll']);
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
  await writeFile(path, JSON.stringify({ strategies: {} }));

  await assert.rejects(loadTradingConfig(path), /at least one strategy/);
});
