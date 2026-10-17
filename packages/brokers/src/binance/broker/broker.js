import { CoreBroker } from '../../broker.core.js'
import {
  getAssets,
  getOpenOrders,
  createOrder,
  cancelOrder,
  subscribeForPrices,
  getOrder,
  getPrices,
  cancelAllOpenOrders,
} from './methods/index.js'

export class BinanceBroker extends CoreBroker {
  constructor(input = {}) {
    super({ logger: input.logger })
    this.wsClient = input.wsClient
  }

  getAssets = getAssets
  getPrices = getPrices

  getOrder = getOrder
  getOpenOrders = getOpenOrders
  cancelAllOpenOrders = cancelAllOpenOrders
  createOrder = createOrder
  cancelOrder = cancelOrder

  subscribeForPrices = subscribeForPrices
}
