import { createMarketPrice } from "../../domain/market-price.js"
import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"

function logSystem({ logger,
  ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function resolveMarketDataSourceIdentity({
  broker,
  expectedProviderInstanceId,
  expectedProviderType,
  expectedAccountId,
  expectedEnvironment,
}) {
  const providerInstanceId = broker.providerInstanceId ?? expectedProviderInstanceId
  const providerType = broker.providerType ?? expectedProviderType
  const accountId = broker.accountId ?? expectedAccountId ?? null
  const environment = broker.environment ?? expectedEnvironment
  const hasExpectedIdentity = Boolean(
    expectedProviderInstanceId &&
    expectedProviderType &&
    expectedEnvironment,
  )
  const hasBrokerIdentity = Boolean(
    broker.providerInstanceId &&
    broker.providerType &&
    broker.environment,
  )
  const hasIdentity = hasExpectedIdentity || hasBrokerIdentity
  if (!hasIdentity) {
    return undefined
  }
  if (typeof providerInstanceId !== "string" || !providerInstanceId.trim()) {
    throw new TypeError("Market-data broker must expose a providerInstanceId")
  }
  if (typeof providerType !== "string" || !providerType.trim()) {
    throw new TypeError("Market-data broker must expose a providerType")
  }
  if (environment !== "live" && environment !== "testnet") {
    throw new TypeError("Market-data broker must expose a LIVE or TESTNET environment")
  }
  if (expectedProviderInstanceId && providerInstanceId !== expectedProviderInstanceId) {
    throw new Error(`Market-data route expected provider instance ${expectedProviderInstanceId}, received ${providerInstanceId}`)
  }
  if (expectedProviderType && providerType !== expectedProviderType) {
    throw new Error(`Market-data route expected provider type ${expectedProviderType}, received ${providerType}`)
  }
  if (expectedEnvironment && environment !== expectedEnvironment) {
    throw new Error(`Market-data route expected environment ${expectedEnvironment}, received ${environment}`)
  }
  return Object.freeze({
    providerInstanceId,
    providerType,
    accountId,
    environment,
  })
}

function attachMarketDataSourceIdentity(event, sourceIdentity) {
  if (!sourceIdentity) {
    return event
  }
  for (const field of ["providerInstanceId", "providerType", "accountId", "environment"]) {
    if (event[field] !== undefined && event[field] !== sourceIdentity[field]) {
      throw new Error(`Market-data event ${field} does not match its subscribed provider source`)
    }
  }
  return Object.freeze({
    ...event,
    ...sourceIdentity,
  })
}

function logMarketPriceEvaluation({ logger,
  symbol,
  priceEvent,
  processed }) {
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

function createMarketPriceErrorReporter({ logger,
  onMarketPriceError }) {
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

function createBookTickerHandler({ symbol,
  sourceIdentity,
  isStopped,
  processMarketBook,
  logger,
  intakeState }) {
  return (bookTicker) => {
    if (isStopped()) {
      return toResult({ data: { skipped: true,
reason: "STOPPING" } })
    }
    intakeState.latestWebSocketBookTask = Promise.resolve()
      .then(() => processMarketBook({
        symbol,
        bookTicker: attachMarketDataSourceIdentity(bookTicker, sourceIdentity),
      }))
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
  sourceIdentity,
}) {
  return (priceEvent) => {
    if (isStopped()) {
      return toResult({ data: { skipped: true,
reason: "STOPPING" } })
    }
    const sourcedPriceEvent = attachMarketDataSourceIdentity(priceEvent, sourceIdentity)
    try {
      if (isMarketPriceFresh(createMarketPrice({ priceEvent: sourcedPriceEvent }))) {
        intakeState.hasFreshWebSocketPrice = true
      }
    } catch {
      // The trading engine reports malformed events through its normal result.
    }
    intakeState.latestWebSocketPriceTask = Promise.resolve()
      .then(() => processMarketPrice({
        symbol,
        priceEvent: sourcedPriceEvent,
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
priceEvent: sourcedPriceEvent,
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

function publishSubscriptionFailure({ eventPublisher,
  brokerName,
  symbol,
  error }) {
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

function getSubscriptionFailure({ result,
  symbol,
  streamLabel }) {
  const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
  return new Error(
    `Unable to subscribe to ${streamLabel} for ${symbol}${details ? `: ${details}` : ""}`,
  )
}

async function subscribeToBookTicker({
  broker,
  providerInstanceId,
  sourceIdentity,
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
        sourceIdentity,
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
    symbol,
    unsubscribe: result.data.unsubscribe,
  })
  logSystem({
    logger,
    message: "Book ticker subscribed",
    providerInstanceId: providerInstanceId ?? null,
    symbol,
    stream: result.data.stream ?? null,
  })
}

async function requestMarketPriceSubscription({ broker,
  symbol,
  handler,
  eventPublisher,
  brokerName }) {
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

function validateMarketPriceSubscription({ result,
  eventPublisher,
  brokerName,
  symbol }) {
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

function registerMarketPriceSubscription({ data,
  logger,
  symbol,
  subscriptions,
  intakeState }) {
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
    symbol,
    unsubscribe: data.unsubscribe,
  })
  intakeState.marketPriceSubscriptionReady = true
  logSystem({
    logger,
    message: "Market data subscribed",
    providerInstanceId: data.providerInstanceId ?? null,
    symbol,
    stream: data.stream ?? null,
  })
}

async function subscribeToMarketPrice({
  broker,
  providerInstanceId,
  sourceIdentity,
  brokerName,
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
    sourceIdentity,
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
    intakeState,
  })
}

function resolveMarketDataBroker({ context,
  symbol }) {
  const broker = typeof context.getMarketDataBroker === "function"
    ? context.getMarketDataBroker({ symbol })
    : context.broker
  if (!broker || typeof broker !== "object") {
    throw new TypeError(`No market-data broker is available for ${symbol}`)
  }
  const configuredIdentity = context.marketDataProviderIdentities?.[symbol]
  const sourceIdentity = resolveMarketDataSourceIdentity({
    broker,
    expectedProviderInstanceId: configuredIdentity?.providerInstanceId
      ?? context.marketDataSources?.[symbol]
      ?? context.providerInstanceId,
    expectedProviderType: configuredIdentity?.providerType
      ?? context.marketDataProviderTypes?.[symbol]
      ?? context.brokerName,
    expectedAccountId: configuredIdentity?.accountId,
    expectedEnvironment: configuredIdentity?.environment ?? context.marketDataEnvironment,
  })
  if (configuredIdentity && (
    sourceIdentity?.accountId !== configuredIdentity.accountId ||
    sourceIdentity?.environment !== configuredIdentity.environment
  )) {
    throw new Error(`Market-data source identity for ${symbol} does not match its configured account/environment`)
  }
  return { broker,
  sourceIdentity }
}

async function subscribeToEnabledMarkets({ context,
  reportPriceError }) {
  const { pairs, tradingEnabled, bookSubscriptions } = context
  const failedSymbols = []
  for (const [symbol, pairConfig] of Object.entries(pairs)) {
    if (!pairConfig.enabled) {
      continue
    }
    const intakeState = context.marketPriceIntake.get(symbol) ?? {}
    intakeState.marketPriceSubscriptionReady = false
    context.marketPriceIntake.set(symbol, intakeState)
    let marketDataBroker
    let sourceIdentity
    let symbolError
    try {
      const resolvedSource = resolveMarketDataBroker({ context,
  symbol })
      marketDataBroker = resolvedSource.broker
      sourceIdentity = resolvedSource.sourceIdentity
    } catch (error) {
      symbolError = error
    }
    const providerInstanceId = sourceIdentity?.providerInstanceId
      ?? context.marketDataSources?.[symbol]
      ?? context.providerInstanceId
    const brokerName = sourceIdentity?.providerType
      ?? context.marketDataProviderTypes?.[symbol]
      ?? context.brokerName
    if (marketDataBroker && tradingEnabled) {
      try {
        await subscribeToBookTicker({
          broker: marketDataBroker,
          providerInstanceId,
          sourceIdentity,
          symbol,
          logger: context.logger,
          isStopped: context.isStopped,
          processMarketBook: context.processMarketBook,
          bookSubscriptions,
          marketPriceIntake: context.marketPriceIntake,
        })
      } catch (error) {
        symbolError ??= error
      }
    }
    if (marketDataBroker) {
      try {
        await subscribeToMarketPrice({
          ...context,
          broker: marketDataBroker,
          providerInstanceId,
          sourceIdentity,
          brokerName,
          symbol,
          pairConfig,
          reportPriceError,
        })
      } catch (error) {
        symbolError ??= error
      }
    }
    if (symbolError) {
      failedSymbols.push(symbol)
      context.logger.error?.({
        message: "Market-data source subscription failed; execution route remains blocked",
        symbol,
        providerInstanceId: providerInstanceId ?? null,
        broker: brokerName ?? null,
        error: symbolError,
      })
      if (!context.allowPartialMarketData) {
        throw symbolError
      }
    }
  }
  return failedSymbols
}

function assertAllMarketSubscriptions({ enabledSymbols,
  subscriptions,
  allowPartialMarketData }) {
  const subscribedSymbols = subscriptions.map(({ symbol }) => symbol)
  const missingSubscriptions = enabledSymbols.filter((symbol) => !subscribedSymbols.includes(symbol))
  if (missingSubscriptions.length > 0 && !allowPartialMarketData) {
    throw new Error(
      `Harvester startup did not establish market-price subscriptions for every enabled pair: ${missingSubscriptions.join(", ")}`,
    )
  }
  return { subscribedSymbols,
  missingSubscriptions }
}

async function getInitialMarketPriceEvent({ broker,
  sourceIdentity,
  symbol,
  now }) {
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
  const priceEvent = attachMarketDataSourceIdentity({
    symbol: result.data.symbol,
    price: result.data.price,
    timestamp: now(),
  }, sourceIdentity)
  const marketPrice = createMarketPrice({ priceEvent })
  if (marketPrice.symbol !== symbol) {
    throw new Error(`Initial ticker price symbol does not match enabled market ${symbol}`)
  }
  return priceEvent
}

async function processInitialMarketPrice({ context,
  reportPriceError,
  symbol,
  pairConfig,
  priceEvent }) {
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

async function seedMissingInitialPrices({ context,
  reportPriceError }) {
  const { pairs, marketPriceIntake, now } = context
  const failedSymbols = []
  for (const [symbol, pairConfig] of Object.entries(pairs)) {
    if (!pairConfig.enabled) {
      continue
    }
    const intakeState = marketPriceIntake.get(symbol)
    if (!intakeState) {
      throw new Error(`Missing market-price intake state for enabled pair ${symbol}`)
    }
    if (!intakeState.marketPriceSubscriptionReady) {
      failedSymbols.push(symbol)
      continue
    }
    if (intakeState.latestWebSocketPriceTask) {
      await intakeState.latestWebSocketPriceTask
    }
    if (intakeState.hasFreshWebSocketPrice) {
      continue
    }
    try {
      const { broker, sourceIdentity } = resolveMarketDataBroker({ context,
  symbol })
      const priceEvent = await getInitialMarketPriceEvent({
        broker,
        sourceIdentity,
        symbol,
        now,
      })
      await processInitialMarketPrice({ context,
  reportPriceError,
  symbol,
  pairConfig,
  priceEvent })
    } catch (error) {
      failedSymbols.push(symbol)
      context.logger.error?.({
        message: "Initial market-price seed failed; execution route remains blocked",
        symbol,
        providerInstanceId: context.marketDataSources?.[symbol] ?? context.providerInstanceId ?? null,
        error,
      })
      if (!context.allowPartialMarketData) {
        throw error
      }
    }
  }
  return failedSymbols
}

function createMarketDataSubscriptionContext(options) {
  const {
    broker,
    providerInstanceId,
    brokerName,
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
    getMarketDataBroker,
    marketDataSources,
    marketDataProviderTypes,
    marketDataProviderIdentities,
    marketDataEnvironment,
    allowPartialMarketData = false,
  } = options
  return {
    broker,
    getMarketDataBroker,
    marketDataSources,
    marketDataProviderTypes,
    marketDataProviderIdentities,
    marketDataEnvironment,
    allowPartialMarketData,
    providerInstanceId,
    brokerName,
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
}

function logMarketDataSubscriptionsReady({
  logger,
  providerInstanceId,
  enabledSymbols,
  subscribedSymbols,
  failedSymbols = [],
}) {
  logSystem({
    logger,
    message: "Market data subscriptions ready",
    providerInstanceId: providerInstanceId ?? null,
    enabledSymbols,
    subscribedSymbols,
    failedSymbols,
  })
}

async function establishMarketDataSubscriptions({ context,
  reportPriceError }) {
  const enabledSymbols = Object.entries(context.pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)

  // Establish every enabled market stream before requesting any missing
  // initial ticker snapshot through Binance WebSocket API ticker.price.
  // A slow first request must never prevent later markets receiving prices.
  const subscriptionFailures = await subscribeToEnabledMarkets({
    context,
    reportPriceError,
  })
  const { subscribedSymbols, missingSubscriptions } = assertAllMarketSubscriptions({
    enabledSymbols,
    subscriptions: context.subscriptions,
    allowPartialMarketData: context.allowPartialMarketData,
  })
  const initialPriceFailures = context.tradingEnabled
    ? await seedMissingInitialPrices({ context,
  reportPriceError })
    : []
  const failedSymbols = [...new Set([
    ...subscriptionFailures,
    ...missingSubscriptions,
    ...initialPriceFailures,
  ])]
  logMarketDataSubscriptionsReady({
    logger: context.logger,
    providerInstanceId: context.providerInstanceId,
    enabledSymbols,
    subscribedSymbols,
    failedSymbols,
  })

  return Object.freeze({
    ok: failedSymbols.length === 0,
    failedSymbols: Object.freeze(failedSymbols),
    subscriptions: context.subscriptions,
    bookSubscriptions: context.bookSubscriptions,
    marketPriceIntake: context.marketPriceIntake,
  })
}

/**
 * Establish market/book subscriptions for every enabled pair, then seed missing
 * first prices only after all WebSocket streams are active.
 */
export async function subscribeToMarketData(options = {}) {
  const context = createMarketDataSubscriptionContext(options)
  const reportPriceError = createMarketPriceErrorReporter({
    logger: context.logger,
    onMarketPriceError: options.onMarketPriceError,
  })
  return establishMarketDataSubscriptions({
    context,
    reportPriceError,
  })
}
