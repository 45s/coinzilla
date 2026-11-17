import { createMarketPrice } from "../../domain/market-price.js"
import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function logMarketPriceEvaluation({ logger, symbol, priceEvent, processed }) {
  if (!processed?.ok) {
    return
  }
  const { decision } = processed.data ?? {}
  const action = decision?.action ??
    (decision?.actions?.length
      ? decision.actions.map(({ side }) => side).join("+")
      : "NO_ACTION")
  logger.debug?.({
    message: "Market price evaluated",
    symbol,
    price: priceEvent?.price,
    action,
  })
}

function createMarketPriceErrorReporter({ logger, onMarketPriceError }) {
  return (details) => {
    const [rejection] = Array.isArray(details?.errors) ? details.errors : [details?.errors?.[0]]
    const expectedPostOnlyRejection = details?.errors?.length === 1 &&
      rejection?.code === "POST_ONLY_WOULD_TAKE"
    if (expectedPostOnlyRejection) {
      logger.warn?.({
        message: "Binance rejected a post-only LIMIT_MAKER order",
        symbol: details.symbol,
        orderType: "LIMIT_MAKER",
        reason: "WOULD_IMMEDIATELY_MATCH",
        brokerMessage: rejection.message,
      })
      return
    }
    try {
      onMarketPriceError(details)
    } catch (error) {
      logger.error?.({
        message: "market price error handler failed",
        error,
      })
    }
  }
}

function createBookTickerHandler({ symbol, isStopped, processMarketBook, logger, intakeState }) {
  return (bookTicker) => {
    if (isStopped()) {
      return toResult({ data: { skipped: true,
reason: "STOPPING" } })
    }
    intakeState.latestWebSocketBookTask = Promise.resolve()
      .then(() => processMarketBook({ symbol,
bookTicker }))
      .then((processed) => {
        if (!processed.ok) {
          logger.error?.({
            message: "market book processing failed",
            symbol,
            errors: processed.errors,
          })
        }
        return processed
      })
      .catch((error) => {
        logger.error?.({
          message: "market book processing failed",
          symbol,
          error,
        })
        return toResult({ error })
      })
    return intakeState.latestWebSocketBookTask
  }
}

function createMarketPriceHandler({
  symbol,
  pairConfig,
  settings,
  isStopped,
  isMarketPriceFresh,
  processMarketPrice,
  reportPriceError,
  logger,
  intakeState,
}) {
  return (priceEvent) => {
    if (isStopped()) {
      return toResult({ data: { skipped: true,
reason: "STOPPING" } })
    }
    try {
      if (isMarketPriceFresh(createMarketPrice({ priceEvent }))) {
        intakeState.hasFreshWebSocketPrice = true
      }
    } catch {
      // The trading engine reports malformed events through its normal result.
    }
    intakeState.latestWebSocketPriceTask = Promise.resolve()
      .then(() => processMarketPrice({
        symbol,
        priceEvent,
        pairConfig,
        settings,
      }))
      .then((processed) => {
        if (!processed.ok) {
          reportPriceError({ symbol,
errors: processed.errors })
        } else {
          logMarketPriceEvaluation({ logger,
symbol,
priceEvent,
processed })
        }
        return processed
      })
      .catch((error) => {
        reportPriceError({ symbol,
error })
        return { ok: false,
errors: [error] }
      })
    return intakeState.latestWebSocketPriceTask
  }
}

function publishSubscriptionFailure({ eventPublisher, brokerName, symbol, error }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    dataResult: mapBrokerSubscriptionFailedData({
      broker: brokerName,
      stream: "market-price",
      market: symbol,
      error,
    }),
  })
}

function getSubscriptionFailure({ result, symbol, streamLabel }) {
  const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
  return new Error(
    `Unable to subscribe to ${streamLabel} for ${symbol}${details ? `: ${details}` : ""}`,
  )
}

async function subscribeToBookTicker({
  broker,
  providerInstanceId,
  symbol,
  logger,
  isStopped,
  processMarketBook,
  bookSubscriptions,
  marketPriceIntake,
}) {
  const intakeState = marketPriceIntake.get(symbol) ?? {}
  marketPriceIntake.set(symbol, intakeState)
  let result
  try {
    result = await broker.subscribeForBookTicker({
      symbol,
      onBookTicker: createBookTickerHandler({
        symbol,
        isStopped,
        processMarketBook,
        logger,
        intakeState,
      }),
    })
  } catch (error) {
    result = toResult({ error })
  }
  if (!result?.ok || typeof result.data?.unsubscribe !== "function") {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(`Unable to subscribe to book ticker for ${symbol}${details ? `: ${details}` : ""}`)
  }
  bookSubscriptions.push({
    ...(providerInstanceId ? { providerInstanceId } : {}),
    symbol,
    unsubscribe: result.data.unsubscribe,
  })
  logSystem({
    logger,
    message: "Book ticker subscribed",
    symbol,
    stream: result.data.stream ?? null,
  })
}

async function requestMarketPriceSubscription({ broker, symbol, handler, eventPublisher, brokerName }) {
  try {
    return await broker.subscribeForPrices({
      symbol,
      onPrice: handler,
    })
  } catch (error) {
    publishSubscriptionFailure({ eventPublisher,
      brokerName,
      symbol,
      error })
    throw error
  }
}

function validateMarketPriceSubscription({ result, eventPublisher, brokerName, symbol }) {
  if (result?.ok && typeof result.data?.unsubscribe === "function") {
    return result.data
  }
  const error = getSubscriptionFailure({
    result,
    symbol,
    streamLabel: "market prices",
  })
  publishSubscriptionFailure({ eventPublisher,
    brokerName,
    symbol,
    error })
  throw error
}

function registerMarketPriceSubscription({ data, logger, symbol, subscriptions }) {
  publishLifecycleEvent({
    eventPublisher: data.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    dataResult: mapBrokerSubscriptionEstablishedData({
      broker: data.brokerName,
      stream: "market-price",
      market: symbol,
    }),
  })
  subscriptions.push({
    ...(data.providerInstanceId ? { providerInstanceId: data.providerInstanceId } : {}),
    symbol,
    unsubscribe: data.unsubscribe,
  })
  logSystem({
    logger,
    message: "Market data subscribed",
    symbol,
    stream: data.stream ?? null,
  })
}

async function subscribeToMarketPrice({
  broker,
  brokerName,
  providerInstanceId,
  eventPublisher,
  logger,
  symbol,
  pairConfig,
  settings,
  processMarketPrice,
  isMarketPriceFresh,
  isStopped,
  reportPriceError,
  subscriptions,
  marketPriceIntake,
}) {
  const intakeState = marketPriceIntake.get(symbol) ?? {}
  intakeState.hasFreshWebSocketPrice = false
  intakeState.latestWebSocketPriceTask = null
  marketPriceIntake.set(symbol, intakeState)
  const handler = createMarketPriceHandler({
    symbol,
    pairConfig,
    settings,
    processMarketPrice,
    isMarketPriceFresh,
    isStopped,
    reportPriceError,
    logger,
    intakeState,
  })
  const result = await requestMarketPriceSubscription({
    broker,
    symbol,
    handler,
    eventPublisher,
    brokerName,
  })
  const data = validateMarketPriceSubscription({
    result,
    eventPublisher,
    brokerName,
    symbol,
  })
  registerMarketPriceSubscription({
    data: {
      ...data,
      eventPublisher,
      brokerName,
      providerInstanceId,
    },
    logger,
    symbol,
    subscriptions,
  })
}

async function subscribeToEnabledMarkets({ context, reportPriceError }) {
  const { pairs, tradingEnabled, broker, providerInstanceId, bookSubscriptions } = context
  for (const [symbol, pairConfig] of Object.entries(pairs)) {
    if (!pairConfig.enabled) {
      continue
    }
    if (tradingEnabled) {
      await subscribeToBookTicker({
        broker,
        providerInstanceId,
        symbol,
        logger: context.logger,
        isStopped: context.isStopped,
        processMarketBook: context.processMarketBook,
        bookSubscriptions,
        marketPriceIntake: context.marketPriceIntake,
      })
    }
    await subscribeToMarketPrice({
      ...context,
      symbol,
      pairConfig,
      reportPriceError,
    })
  }
}

function assertAllMarketSubscriptions({ enabledSymbols, subscriptions }) {
  const subscribedSymbols = subscriptions.map(({ symbol }) => symbol)
  const missingSubscriptions = enabledSymbols.filter((symbol) => !subscribedSymbols.includes(symbol))
  if (missingSubscriptions.length > 0) {
    throw new Error(
      `Harvester startup did not establish market-price subscriptions for every enabled pair: ${missingSubscriptions.join(", ")}`,
    )
  }
  return subscribedSymbols
}

async function getInitialMarketPriceEvent({ broker, symbol, now }) {
  let result
  try {
    result = await broker.getPrices({ symbol })
  } catch (error) {
    result = toResult({ error })
  }
  if (!result?.ok || !result.data) {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(`Unable to load initial market price for ${symbol}${details ? `: ${details}` : ""}`)
  }
  const priceEvent = {
    symbol: result.data.symbol,
    price: result.data.price,
    timestamp: now(),
  }
  const marketPrice = createMarketPrice({ priceEvent })
  if (marketPrice.symbol !== symbol) {
    throw new Error(`Initial ticker price symbol does not match enabled market ${symbol}`)
  }
  return priceEvent
}

async function processInitialMarketPrice({ context, reportPriceError, symbol, pairConfig, priceEvent }) {
  const processed = await context.processMarketPrice({
    symbol,
    priceEvent,
    pairConfig,
    settings: context.settings,
  })
  if (!processed.ok) {
    reportPriceError({ symbol,
      errors: processed.errors })
    return
  }
  logMarketPriceEvaluation({
    logger: context.logger,
    symbol,
    priceEvent,
    processed,
  })
}

async function seedMissingInitialPrices({ context, reportPriceError }) {
  const { broker, pairs, marketPriceIntake, now } = context
  for (const [symbol, pairConfig] of Object.entries(pairs)) {
    if (!pairConfig.enabled) {
      continue
    }
    const intakeState = marketPriceIntake.get(symbol)
    if (!intakeState) {
      throw new Error(`Missing market-price intake state for enabled pair ${symbol}`)
    }
    if (intakeState.latestWebSocketPriceTask) {
      await intakeState.latestWebSocketPriceTask
    }
    if (intakeState.hasFreshWebSocketPrice) {
      continue
    }
    const priceEvent = await getInitialMarketPriceEvent({ broker,
      symbol,
      now })
    await processInitialMarketPrice({ context,
      reportPriceError,
      symbol,
      pairConfig,
      priceEvent })
  }
}

/**
 * Establish market/book subscriptions for every enabled pair, then seed missing
 * first prices only after all WebSocket streams are active.
 */
export async function subscribeToMarketData({
  broker,
  brokerName,
  providerInstanceId,
  eventPublisher,
  logger,
  tradingEnabled,
  pairs,
  settings,
  processMarketPrice,
  processMarketBook,
  isMarketPriceFresh,
  now,
  isStopped,
  onMarketPriceError,
  subscriptions,
  bookSubscriptions,
  marketPriceIntake,
} = {}) {
  const enabledSymbols = Object.entries(pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)
  const context = {
    broker,
    brokerName,
    providerInstanceId,
    eventPublisher,
    logger,
    tradingEnabled,
    pairs,
    settings,
    processMarketPrice,
    processMarketBook,
    isMarketPriceFresh,
    now,
    isStopped,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
  }
  const reportPriceError = createMarketPriceErrorReporter({ logger,
onMarketPriceError })

  // Establish every enabled market stream before requesting any missing
  // initial ticker snapshot through Binance WebSocket API `ticker.price`.
  // A slow first request must never prevent later markets receiving prices.
  await subscribeToEnabledMarkets({ context,
reportPriceError })
  const subscribedSymbols = assertAllMarketSubscriptions({ enabledSymbols,
subscriptions })
  logSystem({
    logger,
    message: "Market data subscriptions ready",
    enabledSymbols,
    subscribedSymbols,
  })

  // Only after all enabled symbols have active WebSocket Streams may startup
  // request missing ticker snapshots through WebSocket API `ticker.price`.
  if (tradingEnabled) {
    await seedMissingInitialPrices({ context,
reportPriceError })
  }
  return Object.freeze({
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
  })
}
