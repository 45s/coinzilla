export function createExchangeAccountReaders({ runtime } = {}) {
  const runtimes = Array.isArray(runtime?.accountRuntimes)
    ? runtime.accountRuntimes
    : [runtime]
  return Object.freeze(runtimes.flatMap((accountRuntime) => {
    if (
      typeof accountRuntime?.getExchangeAccountSnapshot !== "function" ||
      typeof accountRuntime?.getExchangeOpenOrders !== "function"
    ) {
      return []
    }
    return [Object.freeze({
      providerInstanceId: accountRuntime.providerInstanceId,
      providerType: accountRuntime.providerType,
      accountId: accountRuntime.accountId,
      environment: accountRuntime.tradingMode ?? accountRuntime.environment,
      connected: accountRuntime.connected === true,
      readAccountSnapshot: () => accountRuntime.getExchangeAccountSnapshot(),
      readOpenOrders: () => accountRuntime.getExchangeOpenOrders(),
    })]
  }))
}

export function createExchangeAccountUpdateSubscription({ runtime } = {}) {
  const runtimes = Array.isArray(runtime?.accountRuntimes)
    ? runtime.accountRuntimes
    : [runtime]
  return (listener) => {
    const unsubscribe = []
    try {
      for (const accountRuntime of runtimes) {
        if (typeof accountRuntime?.subscribeExchangeAccountUpdates === "function") {
          unsubscribe.push(accountRuntime.subscribeExchangeAccountUpdates(listener))
        }
      }
    } catch (error) {
      for (const dispose of unsubscribe.reverse()) {
        if (typeof dispose === "function") {
          dispose()
        }
      }
      throw error
    }
    return () => {
      for (const dispose of unsubscribe.reverse()) {
        if (typeof dispose === "function") {
          dispose()
        }
      }
    }
  }
}
