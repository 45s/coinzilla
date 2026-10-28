import assert from 'node:assert'
import { describe, it } from 'node:test'
import { errMsgs, Coin } from './coin.js'

describe(`${Coin.name}`, () => {
  const ticker = 'btc'
  const quantity = 3

  it('should return a coin entity', () => {
    const c = new Coin({ ticker, quantity })
    assert(c.ticker, 'BTC')
    assert(c.quantity, quantity)
  })

  it('should throw an error with invalid ticker', () => {
    assert.throws(() => new Coin(), {
      message: errMsgs.ticker,
    })
  })

  it('should throw an error with invalid amount', () => {
    assert.throws(() => new Coin({ ticker }), {
      message: errMsgs.quantity,
    })
  })

  it("should throw an error with non-finite amount", () => {
    for (const quantity of [NaN, Infinity, -Infinity]) {
      assert.throws(() => new Coin({ ticker, quantity }), {
        message: errMsgs.quantity,
      })
    }
  })

})
