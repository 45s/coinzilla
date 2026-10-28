import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adaptOrder } from './adapt-order.js'

const mockedBinanceOrder = {
  symbol: 'BTCUSDT',
  orderId: 7089252,
  orderListId: -1,
  clientOrderId: '9idpZAxnLfOJAslUiBUPK3',
  price: '50000.00000000',
  origQty: '1.00000000',
  executedQty: '0.00000000',
  cummulativeQuoteQty: '0.00000000',
  status: 'NEW',
  timeInForce: 'GTC',
  type: 'LIMIT',
  side: 'SELL',
  stopPrice: '0.00000000',
  icebergQty: '0.00000000',
  time: 1695215226295,
  updateTime: 1695215226295,
  isWorking: true,
  workingTime: 1695215226295,
  origQuoteOrderQty: '0.00000000',
  selfTradePreventionMode: 'NONE',
}

describe('adaptOrder', () => {
  it('adapts an unfilled Binance order', () => {
    const result = adaptOrder(mockedBinanceOrder)
    assert.equal(result.id, String(mockedBinanceOrder.orderId))
    assert.equal(result.type, mockedBinanceOrder.type)
    assert.equal(result.side, mockedBinanceOrder.side)
    assert.equal(result.price, Number(mockedBinanceOrder.price))
    assert.equal(result.quantity, 1)
    assert.equal(result.symbol, mockedBinanceOrder.symbol)
  })

  it('subtracts executed quantity from original quantity for a partial fill', () => {
    const result = adaptOrder({
      ...mockedBinanceOrder,
      origQty: '1.00000000',
      executedQty: '0.37500000',
    })

    assert.equal(result.quantity, 0.625)
  })

  it('rejects an order whose remaining quantity is zero', () => {
    assert.throws(
      () => adaptOrder({
        ...mockedBinanceOrder,
        origQty: '1.00000000',
        executedQty: '1.00000000',
      }),
      /quantity =\+origQty - \+executedQty === 0/,
    )
  })
})
