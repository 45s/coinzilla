import assert from 'node:assert'
import { describe, it } from 'node:test'
import { CoreBroker as Broker } from './broker.core.js'

describe(`${Broker.name}`, () => {
  const broker = new Broker()
  for (const methodName of [
    'getAssets',
    'createOrder',
    'cancelOrder',
    'getOpenOrders',
    'getPrice',
    'subscribeForPrices',
  ]) {
    it(`should has "${methodName}" method`, () => {
      assert(typeof broker[methodName] === 'function')
    })
  }
})
