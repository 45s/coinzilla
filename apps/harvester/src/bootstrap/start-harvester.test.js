import test from 'node:test'
import assert from 'node:assert/strict'
import { startHarvester } from './start-harvester.js'

const tradingConfig = { strategies: {} }

const createBroker = (calls = []) => Object.fromEntries([
  ['connect', async () => calls.push('connect')],
  ['disconnect', async () => calls.push('disconnect')],
  ['placeOrder', async () => ({ ok: true })],
  ['cancelOrder', async () => ({ ok: true })],
  ['getOpenOrders', async () => ({ ok: true })],
  ['getFills', async () => ({ ok: true })],
  ['getAccountSnapshot', async () => ({ ok: true })],
  ['getSymbolFilters', async () => ({ ok: true })],
  ['getPrices', async () => ({ ok: true })],
  ['subscribeForPrices', async () => ({ ok: true })],
  ['subscribeForUserData', async () => ({ ok: true })],
])

test('does not connect a broker unless explicitly selected', async () => {
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {},
  })

  assert.equal(result.tradingConfig, tradingConfig)
  assert.equal(result.broker, undefined)
  assert.equal(result.connected, false)
  await result.stop()
})

test('connects the selected Binance broker and exposes idempotent shutdown', async () => {
  const calls = []
  let received
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {
      HARVESTER_BROKER: 'binance',
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET_KEY: 'secret',
    },
    brokerAdapterFactory: ({ config }) => {
      received = config
      return createBroker(calls)
    },
  })

  assert.deepEqual(received, { apiKey: 'key', apiSecret: 'secret' })
  assert.equal(result.connected, true)
  assert.ok(result.broker)
  assert.equal(typeof result.placeOrder, 'function')
  await result.stop()
  await result.stop()
  assert.deepEqual(calls, ['connect', 'disconnect'])
})

test('rejects an unsupported broker selection', async () => {
  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: { HARVESTER_BROKER: 'unknown' },
    }),
    /Unsupported HARVESTER_BROKER/,
  )
})

test('disconnects after a failed broker connection', async () => {
  const calls = []
  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: { HARVESTER_BROKER: 'binance' },
      brokerAdapterFactory: () => {
        const broker = createBroker(calls)
        broker.connect = async () => {
          calls.push('connect')
          throw new Error('connection failed')
        }
        return broker
      },
    }),
    /connection failed/,
  )
  assert.deepEqual(calls, ['connect', 'disconnect'])
})
