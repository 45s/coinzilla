import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/index.js';

test('reports successful configuration startup without claiming a workflow ran', async () => {
  const messages = [];
  const logger = {
    info: (message) => messages.push(['info', message]),
    error: (...args) => messages.push(['error', ...args]),
  };

  await main({ start: async () => ({}), logger });

  assert.deepEqual(messages, [[
    'info',
    'Harvester configuration validated; broker connection and trading are disabled.',
  ]]);
});

test('reports startup failure and sets a non-zero exit code', async (t) => {
  const originalExitCode = process.exitCode;
  const startupError = new Error('Invalid trading config');
  const messages = [];
  const logger = {
    info: (message) => messages.push(['info', message]),
    error: (...args) => messages.push(['error', ...args]),
  };

  t.after(() => {
    process.exitCode = originalExitCode;
  });

  process.exitCode = 0;
  await main({
    start: async () => {
      throw startupError;
    },
    logger,
  });

  assert.equal(process.exitCode, 1);
  assert.deepEqual(messages, [['error', 'Harvester startup failed.', startupError]]);
});
