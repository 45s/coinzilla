import { defaultLogger, EM } from "@coinzilla/utils"

/**
 * Create the default implementation for an unsupported broker operation.
 *
 * @param {string} methodName - Public operation name included in the error.
 * @returns {(...args: unknown[]) => never}
 */
const foo = (methodName) => () => {
  throw new Error(EM.methodShouldBeImplemented(methodName))
}

/**
 * Exchange-neutral base class for broker adapters.
 * Concrete brokers override the operations they support.
 */
export class CoreBroker {
  /**
   * @param {{logger?: import("@coinzilla/utils").Logger}} [input]
   */
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
CoreBroker.prototype.getOrder = foo("getOrder")
CoreBroker.prototype.getPrice = foo("getPrice")
CoreBroker.prototype.createOrder = foo("createOrder")
CoreBroker.prototype.subscribeForPrices = foo("subscribeForPrices")

CoreBroker.prototype.getSymbolFilters = foo("getSymbolFilters")
CoreBroker.prototype.getExchangeMarkets = foo("getExchangeMarkets")
CoreBroker.prototype.getMyTrades = foo("getMyTrades")
CoreBroker.prototype.getBalances = foo("getBalances")
CoreBroker.prototype.getOrderHistory = foo("getOrderHistory")
CoreBroker.prototype.getCanonicalOrderHistory = foo("getCanonicalOrderHistory")
CoreBroker.prototype.getCanonicalOrder = foo("getCanonicalOrder")
CoreBroker.prototype.getAccountSnapshot = foo("getAccountSnapshot")
CoreBroker.prototype.getServerTime = foo("getServerTime")
CoreBroker.prototype.getFills = foo("getFills")
