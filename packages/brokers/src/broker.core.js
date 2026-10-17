import { defaultLogger, EM } from "@coinzilla/utils"

const foo = (methodName) => () => {
  throw new Error(EM.methodShouldBeImplemented(methodName))
}

export class CoreBroker {
  constructor(input = {}) {
    this.logger = input.logger || defaultLogger
    this.openOrders = new Map()
    this.prices = new Map()
    this.priceSubscriptions = new Map()
  }

  getAssets = foo("getAssets")
  cancelOrder = foo("cancelOrder")
  getOpenOrders = foo("getOpenOrders")
  getPrice = foo("getPrice")
  createOrder = foo("createOrder")
  subscribeForPrices = foo("subscribeForPrices")
}
