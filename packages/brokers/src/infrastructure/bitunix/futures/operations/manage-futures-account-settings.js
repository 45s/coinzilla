import {
  ensure,
  handleErr,
  toResult,
} from "@coinzilla/utils"

const CHANGE_LEVERAGE_PATH = "/api/v1/futures/account/change_leverage"
const CHANGE_MARGIN_MODE_PATH = "/api/v1/futures/account/change_margin_mode"
const CHANGE_POSITION_MODE_PATH = "/api/v1/futures/account/change_position_mode"

function createConfigurationResult({ data, errors, mutationOutcome, configurationOutcome }) {
  return toResult({
    ...(data === undefined ? {} : {
      data,
    }),
    ...(errors === undefined ? {} : {
      errors,
    }),
    mutationOutcome,
    configurationOutcome,
  })
}

function createNotSentResult({ errors }) {
  return createConfigurationResult({
    errors,
    mutationOutcome: "NOT_SENT",
    configurationOutcome: "NOT_SENT",
  })
}

function normalizeSymbol({ value }) {
  return ensure.nonEmptyString({
    value,
    name: "symbol",
  }).trim().toUpperCase()
}

function normalizeMarginCoin({ value = "USDT" }) {
  return ensure.oneOf({
    value,
    values: ["USDT"],
    name: "marginCoin",
    errMsg: 'Bitunix USDT Futures settings require marginCoin "USDT"',
  })
}

function getMutationOutcome({ dispatchError, confirmed }) {
  if (dispatchError) {
    if (dispatchError.outcomeUnknown === true) {
      return "OUTCOME_UNKNOWN"
    }
    return "REJECTED"
  }
  return confirmed ? "CONFIRMED" : "OUTCOME_UNKNOWN"
}

async function readNoOpenExposure({ broker, symbol }) {
  const scope = symbol === undefined ? {} : {
    symbol,
  }
  const positions = await broker.getFuturesPositions(scope)
  if (!positions.ok) {
    return {
      errors: positions.errors ?? [new Error("Bitunix Futures position preflight failed")],
    }
  }
  if (positions.data.length > 0) {
    return {
      errors: [new Error("Bitunix Futures account setting mutation requires no open positions in the requested scope")],
    }
  }
  const pendingOrders = await broker.getFuturesPendingOrders({
    ...scope,
    limit: 100,
  })
  if (!pendingOrders.ok) {
    return {
      errors: pendingOrders.errors ?? [new Error("Bitunix Futures pending-order preflight failed")],
    }
  }
  const orderCount = pendingOrders.data.total ?? pendingOrders.data.orders.length
  if (orderCount > 0 || pendingOrders.data.orders.length > 0) {
    return {
      errors: [new Error("Bitunix Futures account setting mutation requires no pending orders in the requested scope")],
    }
  }
  const pendingTpSl = await broker.getFuturesPendingTpSlOrders({
    ...scope,
    limit: 100,
  })
  if (!pendingTpSl.ok) {
    return {
      errors: pendingTpSl.errors ?? [new Error("Bitunix Futures pending TP/SL preflight failed")],
    }
  }
  if (pendingTpSl.data.length > 0) {
    return {
      errors: [new Error("Bitunix Futures account setting mutation requires no pending TP/SL orders in the requested scope")],
    }
  }
  return {}
}

async function dispatchAndVerifyConfiguration({
  broker,
  path,
  body,
  readBack,
  matches,
  operation,
}) {
  let dispatchError
  try {
    await broker.restClient.request({
      method: "POST",
      path,
      body,
      stateChanging: true,
    })
  } catch (error) {
    dispatchError = error
    handleErr({
      where: `Bitunix Futures ${operation} mutation`,
      error,
    })
  }
  const finalRead = await readBack()
  if (!finalRead.ok) {
    return createConfigurationResult({
      errors: [
        ...(dispatchError === undefined ? [] : [dispatchError]),
        ...(finalRead.errors ?? [new Error("Bitunix Futures configuration readback failed")]),
      ],
      mutationOutcome: getMutationOutcome({
        dispatchError,
        confirmed: false,
      }),
      configurationOutcome: "UNKNOWN",
    })
  }
  const confirmed = matches(finalRead.data)
  let errors
  if (dispatchError !== undefined) {
    errors = [dispatchError]
  } else if (!confirmed) {
    errors = [new Error(`Bitunix Futures ${operation} readback does not match the requested configuration`)]
  }
  return createConfigurationResult({
    data: {
      requested: body,
      observed: finalRead.data,
    },
    errors,
    mutationOutcome: getMutationOutcome({
      dispatchError,
      confirmed,
    }),
    configurationOutcome: confirmed ? "CONFIRMED" : "UNKNOWN",
  })
}

async function readCurrentLeverageSettings({ broker, symbol, marginCoin }) {
  const result = await broker.getFuturesLeverageAndMarginMode({
    symbol,
    marginCoin,
  })
  return result.ok ? {
    settings: result.data,
  } : {
    errors: result.errors,
  }
}

async function validateLeverageAgainstTiers({ broker, symbol, leverage }) {
  const tiers = await broker.getFuturesPositionTiers({
    symbol,
  })
  if (!tiers.ok || tiers.data.length === 0) {
    return {
      errors: tiers.errors ?? [new Error("Bitunix Futures leverage tiers are unavailable")],
    }
  }
  const maximumLeverage = Math.max(...tiers.data.map((tier) => tier.leverage))
  if (leverage > maximumLeverage) {
    return {
      errors: [new RangeError(`Bitunix Futures leverage cannot exceed the documented maximum of ${maximumLeverage} for ${symbol}`)],
    }
  }
  return {}
}

async function validateLeverageChange({ broker, symbol, marginCoin, leverage }) {
  const current = await readCurrentLeverageSettings({
    broker,
    symbol,
    marginCoin,
  })
  if (current.errors) {
    return {
      result: createNotSentResult({
        errors: current.errors,
      }),
    }
  }
  if (current.settings.leverage === leverage) {
    return {
      result: createConfigurationResult({
        data: {
          symbol,
          marginCoin,
          leverage,
        },
        mutationOutcome: "NOT_SENT",
        configurationOutcome: "ALREADY_SET",
      }),
    }
  }
  const tierValidation = await validateLeverageAgainstTiers({
    broker,
    symbol,
    leverage,
  })
  if (tierValidation.errors) {
    return {
      result: createNotSentResult({
        errors: tierValidation.errors,
      }),
    }
  }
  const preflight = await readNoOpenExposure({
    broker,
    symbol,
  })
  if (preflight.errors) {
    return {
      result: createNotSentResult({
        errors: preflight.errors,
      }),
    }
  }
  return {}
}

async function prepareLeverageChange({ broker, input }) {
  ensure.plainObject({
    value: input,
    name: "setFuturesLeverage input",
  })
  const symbol = normalizeSymbol({
    value: input.symbol,
  })
  const marginCoin = normalizeMarginCoin({
    value: input.marginCoin,
  })
  const leverage = ensure.positiveInteger({
    value: input.leverage,
    name: "leverage",
  })
  const validation = await validateLeverageChange({
    broker,
    symbol,
    marginCoin,
    leverage,
  })
  if (validation.result) {
    return validation
  }
  return {
    symbol,
    marginCoin,
    leverage,
  }
}

export async function setFuturesLeverage({ broker, input } = {}) {
  try {
    const prepared = await prepareLeverageChange({
      broker,
      input,
    })
    if (prepared.result) {
      return prepared.result
    }
    const { symbol, marginCoin, leverage } = prepared
    return dispatchAndVerifyConfiguration({
      broker,
      path: CHANGE_LEVERAGE_PATH,
      body: {
        symbol,
        marginCoin,
        leverage,
      },
      readBack: () => broker.getFuturesLeverageAndMarginMode({
        symbol,
        marginCoin,
      }),
      matches: (settings) => settings.leverage === leverage,
      operation: "setFuturesLeverage",
    })
  } catch (error) {
    handleErr({
      where: "setFuturesLeverage()",
      error,
    })
    return createNotSentResult({
      errors: [error],
    })
  }
}

async function prepareMarginModeChange({ broker, input }) {
  ensure.plainObject({
    value: input,
    name: "setFuturesMarginMode input",
  })
  const symbol = normalizeSymbol({
    value: input.symbol,
  })
  const marginCoin = normalizeMarginCoin({
    value: input.marginCoin,
  })
  const marginMode = ensure.oneOf({
    value: input.marginMode,
    values: ["ISOLATION", "CROSS"],
    name: "marginMode",
  })
  const current = await readCurrentLeverageSettings({
    broker,
    symbol,
    marginCoin,
  })
  if (current.errors) {
    return {
      result: createNotSentResult({
        errors: current.errors,
      }),
    }
  }
  if (current.settings.marginMode === marginMode) {
    return {
      result: createConfigurationResult({
        data: {
          symbol,
          marginCoin,
          marginMode,
        },
        mutationOutcome: "NOT_SENT",
        configurationOutcome: "ALREADY_SET",
      }),
    }
  }
  const preflight = await readNoOpenExposure({
    broker,
    symbol,
  })
  if (preflight.errors) {
    return {
      result: createNotSentResult({
        errors: preflight.errors,
      }),
    }
  }
  return {
    symbol,
    marginCoin,
    marginMode,
  }
}

export async function setFuturesMarginMode({ broker, input } = {}) {
  try {
    const prepared = await prepareMarginModeChange({
      broker,
      input,
    })
    if (prepared.result) {
      return prepared.result
    }
    const { symbol, marginCoin, marginMode } = prepared
    return dispatchAndVerifyConfiguration({
      broker,
      path: CHANGE_MARGIN_MODE_PATH,
      body: {
        symbol,
        marginCoin,
        marginMode,
      },
      readBack: () => broker.getFuturesLeverageAndMarginMode({
        symbol,
        marginCoin,
      }),
      matches: (settings) => settings.marginMode === marginMode,
      operation: "setFuturesMarginMode",
    })
  } catch (error) {
    handleErr({
      where: "setFuturesMarginMode()",
      error,
    })
    return createNotSentResult({
      errors: [error],
    })
  }
}

export async function setFuturesPositionMode({ broker, input } = {}) {
  try {
    ensure.plainObject({
      value: input,
      name: "setFuturesPositionMode input",
    })
    const positionMode = ensure.oneOf({
      value: input.positionMode,
      values: ["ONE_WAY", "HEDGE"],
      name: "positionMode",
    })
    const current = await broker.getFuturesPositionMode()
    if (!current.ok) {
      return createNotSentResult({
        errors: current.errors,
      })
    }
    if (current.data.positionMode === positionMode) {
      return createConfigurationResult({
        data: {
          positionMode,
        },
        mutationOutcome: "NOT_SENT",
        configurationOutcome: "ALREADY_SET",
      })
    }
    const preflight = await readNoOpenExposure({
      broker,
    })
    if (preflight.errors) {
      return createNotSentResult({
        errors: preflight.errors,
      })
    }
    return dispatchAndVerifyConfiguration({
      broker,
      path: CHANGE_POSITION_MODE_PATH,
      body: {
        positionMode,
      },
      readBack: () => broker.getFuturesPositionMode(),
      matches: (settings) => settings.positionMode === positionMode,
      operation: "setFuturesPositionMode",
    })
  } catch (error) {
    handleErr({
      where: "setFuturesPositionMode()",
      error,
    })
    return createNotSentResult({
      errors: [error],
    })
  }
}
