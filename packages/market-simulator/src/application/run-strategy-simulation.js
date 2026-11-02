/** Run a strategy against a broker without coupling the strategy to data storage or clocks. */
export async function runStrategySimulation({
  broker,
  symbol,
  strategy,
  maxCandles = Infinity,
}) {
  if (!broker || typeof broker.connect !== "function" || typeof broker.subscribeForPrices !== "function") {
    throw new TypeError("A CoreBroker-compatible broker is required")
  }
  if (!strategy || typeof strategy.onPrice !== "function") {
    throw new TypeError("strategy.onPrice(event, { broker }) is required")
  }
  if (!(maxCandles === Infinity || Number.isSafeInteger(maxCandles) && maxCandles > 0)) {
    throw new RangeError("maxCandles must be a positive integer or Infinity")
  }

  const connectedHere = !broker.connected
  let subscription
  let stopRequested = false
  let candleCount = 0
  let strategyQueue = Promise.resolve()

  try {
    if (connectedHere) await broker.connect()
    await strategy.onStart?.({ broker, symbol })

    const result = await broker.subscribeForPrices({
      symbol,
      onPrice: (event) => {
        candleCount += 1
        strategyQueue = strategyQueue.then(() => strategy.onPrice(event, { broker }))
        if (candleCount >= maxCandles) {
          stopRequested = true
          void subscription?.data?.unsubscribe()
        }
      },
    })
    if (!result?.ok) throw result?.errors?.[0] ?? new Error("Unable to subscribe to simulated market data")
    subscription = result

    if (stopRequested) await subscription.data.unsubscribe()
    await subscription.data.done
    await strategyQueue
    await strategy.onStop?.({ broker, symbol })

    const [balances, orders, fills] = await Promise.all([
      broker.getBalances?.() ?? Promise.resolve({ ok: true, data: [] }),
      broker.getOrderHistory?.({ symbol }) ?? Promise.resolve({ ok: true, data: [] }),
      broker.getFills?.({ symbol }) ?? Promise.resolve({ ok: true, data: [] }),
    ])
    return {
      symbol,
      candlesProcessed: candleCount,
      balances: balances.data ?? [],
      orders: orders.data ?? [],
      fills: fills.data ?? [],
    }
  } finally {
    if (subscription?.data?.unsubscribe) await subscription.data.unsubscribe()
    if (connectedHere) await broker.disconnect()
  }
}
