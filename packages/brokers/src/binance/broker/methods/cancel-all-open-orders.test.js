import assert from 'node:assert'
import { describe, it } from 'node:test'
import { EM } from '../../../../_utils/index.js'
import { cancelAllOpenOrders } from './cancel-all-open-orders.js'

describe('BinanceBroker/cancelAllOpenOrders', () => {
  it('should validate input', () => {
    assert.rejects(async () => await cancelAllOpenOrders({ ticket: undefined }, { msgs: [EM.required()] }))
  })

  it.skip('should cancel open orders', async () => {
    const r = await cancelAllOpenOrders({ ticket: 'BTCUSDT' })
    assert(Array.isArray(r))
  })
})
