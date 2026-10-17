import assert from 'node:assert'
import { describe, it } from 'node:test'
import { adaptOrder as adapt, adaptOrder } from './adapt-order.js'

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

describe(`brokers/binance/helpers/${adapt.name}`, () => {
  it('should adapt an order', () => {
    const r = adaptOrder(mockedBinanceOrder)
    assert.strictEqual(r.id, mockedBinanceOrder.orderId.toString())
    assert.strictEqual(r.type, mockedBinanceOrder.type)
    assert.strictEqual(r.side, mockedBinanceOrder.side)
    assert.strictEqual(r.price, +mockedBinanceOrder.price)
    assert.strictEqual(r.quantity, +mockedBinanceOrder.origQty)
    assert.strictEqual(r.symbol, mockedBinanceOrder.symbol)
  })
})
