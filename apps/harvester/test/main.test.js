import test from 'node:test';
import assert from 'node:assert/strict';
import { main as startMain } from '../src/index.js';

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: 'disabled', enabled: false },
  flush: async () => ({ ok: true, durable: true }),
  close: async () => ({ ok: true, closed: true, disabled: true }),
});

const runMain = (options = {}) => {
  const { env = {}, ...rest } = options;
  return startMain({ acquireProcessLock: async () => ({ ok: true, release: async () => ({ ok: true }) }), ...rest, env: { TRADING_MODE: 'testnet', ...env } });
};

test('reports successful Binance TESTNET startup without claiming a workflow ran', async () => {
  const messages = [];
  const logger = {
    info: (message) => messages.push(['info', message]),
    error: (...args) => messages.push(['error', ...args]),
    system() {},
  };

  await runMain({ createJournalService: disabledJournalService, start: async () => ({ connected: true, brokerName: 'binance', tradingEnabled: true, strategyMode: 'conservative', subscriptions: [] }), logger });

  assert.deepEqual(messages, [[
    'info',
    'Connected; subscribed to 0 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.',
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
  await runMain({
    createJournalService: disabledJournalService,
    start: async () => {
      throw startupError;
    },
    logger,
  });

  assert.equal(process.exitCode, 1);
  const startupLog = messages.find(([, entry]) => entry?.message === 'startup failed.');
  assert.ok(startupLog);
  assert.equal(startupLog[0], 'error');
  assert.equal(startupLog[1].error, startupError);
  assert.equal(startupLog[1].errorDetails.name, 'Error');
  assert.equal(startupLog[1].errorDetails.message, 'Invalid trading config');
  assert.match(startupLog[1].errorDetails.stack, /Invalid trading config/);
});
