import assert from 'node:assert'
import { describe, it } from 'node:test'
import { adaptMsg as adapt } from './adapt-msg.js'

const mockedExecutionReport = {
  e: 'executionReport',
  E: 1728174911074,
  s: 'ZKFDUSD',
  c: 'and_a2c05f9d6e234891951e60c4341c5101',
  S: 'BUY',
  o: 'LIMIT',
  f: 'GTC',
  q: '415.00000000',
  p: '0.11600000',
  P: '0.00000000',
  F: '0.00000000',
  g: -1,
  C: 'and_56c250ef42d2430bb924e3e56db443c8',
  x: 'CANCELED',
  X: 'CANCELED',
  r: 'NONE',
  i: 15895182,
  l: '0.00000000',
  z: '0.00000000',
  L: '0.00000000',
  n: '0',
  N: null,
  T: 1728174911074,
  t: -1,
  I: 32143036,
  w: false,
  m: false,
  M: false,
  O: 1728148308978,
  Z: '0.00000000',
  Y: '0.00000000',
  Q: '0.00000000',
  W: 1728148308978,
  V: 'EXPIRE_MAKER',
}

const mockedOutboundAccountPosition = {
  e: 'outboundAccountPosition',
  E: 1728174911074,
  u: 1728174911074,
  B: [
    { a: 'BNB', f: '0.00000000', l: '0.00000000' },
    { a: 'FDUSD', f: '48.14000000', l: '397.20000000' },
    { a: 'ZK', f: '0.00000000', l: '0.00000000' },
  ],
}

describe(`binance/websocket/${adapt.name}`, () => {
  it('should adapt "executionReport"', () => {
    const r = adapt(mockedExecutionReport)
    assert.deepStrictEqual(r, {
      eventType: 'executionReport',
      executedOrder: {
        id: '15895182',
        price: 0.116,
        quantity: 415,
        side: 'BUY',
        symbol: 'ZKFDUSD',
        type: 'LIMIT',
        status: 'CANCELED',
        commission: 0,
        commissionAsset: null,
      },
    })
  })

  it('should adapt "outboundAccountPosition"', () => {
    const r = adapt(mockedOutboundAccountPosition)
    assert.deepStrictEqual(r, {
      balances: [
        { asset: 'BNB', free: '0.00000000', locked: '0.00000000' },
        { asset: 'FDUSD', free: '48.14000000', locked: '397.20000000' },
        { asset: 'ZK', free: '0.00000000', locked: '0.00000000' },
      ],
      eventTime: 1728174911074,
      eventType: 'outboundAccountPosition',
      lastAccountUpdate: 1728174911074,
    })
  })
})
