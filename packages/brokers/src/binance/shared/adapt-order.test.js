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
  it('adapts an unfilled Binance order including its client order ID', () => {
    const result = adaptOrder(mockedBinanceOrder)
    assert.equal(result.id, String(mockedBinanceOrder.orderId))
    assert.equal(result.clientOrderId, mockedBinanceOrder.clientOrderId)
    assert.equal(result.type, mockedBinanceOrder.type)
    assert.equal(result.side, mockedBinanceOrder.side)
    assert.equal(result.price, Number(mockedBinanceOrder.price))
    assert.equal(result.quantity, 1)
    assert.equal(result.symbol, mockedBinanceOrder.symbol)
  })

  it('leaves clientOrderId undefined when Binance omits it', () => {
    const { clientOrderId, ...orderWithoutClientId } = mockedBinanceOrder
    const result = adaptOrder(orderWithoutClientId)
    assert.equal(result.clientOrderId, undefined)
    assert.equal('clientOrderId' in result.value, false)
  })

  it('preserves exact original/executed quantities and order status', () => {
    const result = adaptOrder({
      ...mockedBinanceOrder,
      origQty: '0.30000000',
      executedQty: '0.10000000',
      status: 'PARTIALLY_FILLED',
    })

    assert.equal(result.originalQuantity, '0.30000000')
    assert.equal(result.executedQuantity, '0.10000000')
    assert.equal(result.status, 'PARTIALLY_FILLED')
  })

  it('subtracts executed quantity from original quantity for a partial fill', () => {
    const result = adaptOrder({
      ...mockedBinanceOrder,
      origQty: '1.00000000',
      executedQty: '0.37500000',
    })

    assert.equal(result.quantity, 0.625)
  })

  it('adapts a fully filled Binance order with zero remaining quantity', () => {
    const result = adaptOrder({
      ...mockedBinanceOrder,
      origQty: '1.00000000',
      executedQty: '1.00000000',
    })

    assert.equal(result.quantity, 0)
    assert.equal(result.id, String(mockedBinanceOrder.orderId))
  })

  it('rejects non-numeric exchange quantities', () => {
    assert.throws(() =>
      adaptOrder({ ...mockedBinanceOrder, origQty: 'not-a-number' }),
    )
    assert.throws(() =>
      adaptOrder({ ...mockedBinanceOrder, executedQty: 'not-a-number' }),
    )
  })
})

it("preserves a zero-valued Binance order ID", () => {
  const result = adaptOrder({
    ...mockedBinanceOrder,
    orderId: 0,
  })
  assert.equal(result.id, "0")
})
