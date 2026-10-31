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
}

CoreBroker.prototype.getAssets = foo("getAssets")
CoreBroker.prototype.cancelOrder = foo("cancelOrder")
CoreBroker.prototype.getOpenOrders = foo("getOpenOrders")
CoreBroker.prototype.getPrice = foo("getPrice")
CoreBroker.prototype.createOrder = foo("createOrder")
CoreBroker.prototype.subscribeForPrices = foo("subscribeForPrices")

CoreBroker.prototype.getSymbolFilters = foo("getSymbolFilters")
CoreBroker.prototype.getMyTrades = foo("getMyTrades")
