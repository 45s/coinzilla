import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarvester } from '../../src/bootstrap/start-harvester.js';

test('loads configuration before returning the startup context', async () => {
  const tradingConfig = { strategies: {} };
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
