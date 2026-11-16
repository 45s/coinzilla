function validateSimulationInput({ broker, strategy, maxCandles }) {
  if (!broker || typeof broker.connect !== "function" || typeof broker.subscribeForPrices !== "function") {
    throw new TypeError("A CoreBroker-compatible broker is required")
  }
  if (!strategy || typeof strategy.onPrice !== "function") {
    throw new TypeError("strategy.onPrice(event, { broker }) is required")
  }
  if (!(maxCandles === Infinity || (Number.isSafeInteger(maxCandles) && maxCandles > 0))) {
    throw new RangeError("maxCandles must be a positive integer or Infinity")
  }
}

async function subscribeForStrategy({ broker, symbol, strategy, maxCandles }) {
  const playback = {
    subscription: null,
    stopRequested: false,
    candleCount: 0,
    strategyQueue: Promise.resolve(),
  }
  const result = await broker.subscribeForPrices({
    symbol,
    onPrice: (event) => {
      playback.candleCount += 1
      playback.strategyQueue = playback.strategyQueue.then(() => strategy.onPrice(event, { broker }))
      if (playback.candleCount >= maxCandles) {
        playback.stopRequested = true
        void playback.subscription?.data?.unsubscribe()
      }
    },
  })
  if (!result?.ok) {
    throw result?.errors?.[0] ?? new Error("Unable to subscribe to simulated market data")
  }
  playback.subscription = result

  if (playback.stopRequested) {
    await playback.subscription.data.unsubscribe()
  }
  return playback
}

async function createSimulationReport({ broker, symbol, candleCount }) {
  const [balances, orders, fills] = await Promise.all([
    broker.getBalances?.() ?? Promise.resolve({
      ok: true,
      data: [],
    }),
    broker.getOrderHistory?.({ symbol }) ?? Promise.resolve({
      ok: true,
      data: [],
    }),
    broker.getFills?.({ symbol }) ?? Promise.resolve({
      ok: true,
      data: [],
    }),
  ])
  return {
    symbol,
    candlesProcessed: candleCount,
    balances: balances.data ?? [],
    orders: orders.data ?? [],
    fills: fills.data ?? [],
  }
}

/** Run a strategy against a broker without coupling the strategy to data storage or clocks. */
export async function runStrategySimulation({
  broker,
  symbol,
  strategy,
  maxCandles = Infinity,
}) {
  validateSimulationInput({
    broker,
    strategy,
    maxCandles,
  })

  const connectedHere = !broker.connected
  let playback

  try {
    if (connectedHere) {
      await broker.connect()
    }
    await strategy.onStart?.({
      broker,
      symbol,
    })

    playback = await subscribeForStrategy({
      broker,
      symbol,
      strategy,
      maxCandles,
    })
    await playback.subscription.data.done
    await playback.strategyQueue
    await strategy.onStop?.({
      broker,
      symbol,
    })

    return await createSimulationReport({
      broker,
      symbol,
      candleCount: playback.candleCount,
    })
  } finally {
    if (playback?.subscription?.data?.unsubscribe) {
      await playback.subscription.data.unsubscribe()
    }
    if (connectedHere) {
      await broker.disconnect()
    }
  }
}
