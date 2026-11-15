function validateStrategyPolicy({ strategyPolicy } = {}) {
  if (!strategyPolicy || typeof strategyPolicy.evaluate !== "function" ||
      typeof strategyPolicy.evaluateTrailingBuyRepricing !== "function") {
    throw new TypeError("strategyPolicy must provide evaluate and evaluateTrailingBuyRepricing functions")
  }
}

function validateRequiredCallbacks({ callbacks } = {}) {
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") {
      throw new TypeError(`${name} must be a function`)
    }
  }
}

function validateOptionalCallbacks({
  getVolatilityData,
  isMarketPriceFresh,
  isMarketBookFresh,
  onOperationalStateCancellationIntent,
  onOperationalStateCancellationOutcome,
  onOperationalStateStrategyMarketPaused,
  hasUnownedOpenOrdersForSymbol,
} = {}) {
  if (getVolatilityData !== undefined && typeof getVolatilityData !== "function") {
    throw new TypeError("getVolatilityData must be a function when provided")
  }
  if (typeof isMarketPriceFresh !== "function") {
    throw new TypeError("isMarketPriceFresh must be a function")
  }
  if (onOperationalStateCancellationIntent !== undefined &&
      typeof onOperationalStateCancellationIntent !== "function") {
    throw new TypeError("onOperationalStateCancellationIntent must be a function")
  }
  if (onOperationalStateCancellationOutcome !== undefined &&
      typeof onOperationalStateCancellationOutcome !== "function") {
    throw new TypeError("onOperationalStateCancellationOutcome must be a function")
  }
  if ((onOperationalStateCancellationIntent === undefined) !==
      (onOperationalStateCancellationOutcome === undefined)) {
    throw new TypeError("onOperationalStateCancellationIntent and onOperationalStateCancellationOutcome must be provided together")
  }
  if (onOperationalStateStrategyMarketPaused !== undefined &&
      typeof onOperationalStateStrategyMarketPaused !== "function") {
    throw new TypeError("onOperationalStateStrategyMarketPaused must be a function")
  }
  if (typeof hasUnownedOpenOrdersForSymbol !== "function") {
    throw new TypeError("hasUnownedOpenOrdersForSymbol must be a function")
  }
  if (typeof isMarketBookFresh !== "function") {
    throw new TypeError("isMarketBookFresh must be a function")
  }
}

function validateInitialState({ initialState } = {}) {
  if (!initialState || typeof initialState !== "object" || Array.isArray(initialState)) {
    throw new TypeError("initialState must be an object")
  }
}

/**
 * Validate the injected ports and optional callbacks before composing the engine.
 * @param {object} options Engine dependencies and initial state.
 * @returns {void}
 */
export function validateConservativeTradingEngineOptions({
  strategyPolicy,
  getPortfolio,
  getRecoveryLedger,
  getMarketMetadata,
  getAccountSnapshot,
  updateTradingAccounting,
  completeRecoveryCycle,
  canTrade,
  onPause,
  isStopping,
  getVolatilityData,
  isMarketPriceFresh,
  isMarketBookFresh,
  onOperationalStateCancellationIntent,
  onOperationalStateCancellationOutcome,
  onOperationalStateStrategyMarketPaused,
  hasUnownedOpenOrdersForSymbol,
  initialState,
} = {}) {
  validateStrategyPolicy({ strategyPolicy })
  validateRequiredCallbacks({
    callbacks: {
      getPortfolio,
      getRecoveryLedger,
      getMarketMetadata,
      getAccountSnapshot,
      updateTradingAccounting,
      completeRecoveryCycle,
      canTrade,
      onPause,
      isStopping,
    },
  })
  validateOptionalCallbacks({
    getVolatilityData,
    isMarketPriceFresh,
    isMarketBookFresh,
    onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome,
    onOperationalStateStrategyMarketPaused,
    hasUnownedOpenOrdersForSymbol,
    })
  validateInitialState({ initialState })
}
