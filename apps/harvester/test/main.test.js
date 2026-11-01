import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/index.js';

test('injects the logger into startup and reports successful configuration', async () => {
  const messages = [];
  const logger = {
    info: (record) => messages.push(['info', record]),
    error: (record) => messages.push(['error', record]),
  };
  let startupOptions;

  await main({
    start: async (options) => {
      startupOptions = options;
      return {};
    },
    logger,
  });

  assert.equal(startupOptions.logger, logger);
  assert.deepEqual(messages, [[
    'info',
    {
      message: 'Harvester configuration validated; broker connection and market data are disabled.',
    },
  ]]);
});

test('reports startup failure and sets a non-zero exit code', async (t) => {
  const originalExitCode = process.exitCode;
  const startupError = new Error('Invalid trading config');
  const messages = [];
  const logger = {
    info: (record) => messages.push(['info', record]),
    error: (record) => messages.push(['error', record]),
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
  assert.deepEqual(messages, [[
    'error',
    {
      message: 'Harvester startup failed.',
      error: {
        name: startupError.name,
        message: startupError.message,
        stack: startupError.stack,
      },
    },
  ]]);
});
