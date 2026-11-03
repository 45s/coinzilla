import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/index.js';

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: 'disabled', enabled: false },
  close: async () => ({ ok: true, closed: true, disabled: true }),
});

test('reports successful configuration startup without claiming a workflow ran', async () => {
  const messages = [];
  const logger = {
    info: (message) => messages.push(['info', message]),
    error: (...args) => messages.push(['error', ...args]),
  };

  await main({ createJournalService: disabledJournalService, start: async () => ({}), logger });

  assert.deepEqual(messages, [[
    'info',
    'Harvester configuration validated; broker connection and market data are disabled.',
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
    createJournalService: disabledJournalService,
    start: async () => {
      throw startupError;
    },
    logger,
  });

  assert.equal(process.exitCode, 1);
  const startupLog = messages.find(([, entry]) => entry?.message === 'Harvester startup failed.');
  assert.ok(startupLog);
  assert.equal(startupLog[0], 'error');
  assert.equal(startupLog[1].error, startupError);
  assert.equal(startupLog[1].errorDetails.name, 'Error');
  assert.equal(startupLog[1].errorDetails.message, 'Invalid trading config');
  assert.match(startupLog[1].errorDetails.stack, /Invalid trading config/);
});
