import {
  handleErr,
  toResult,
} from "@coinzilla/utils"

const FLASH_CLOSE_POSITION_PATH = "/api/v1/futures/trade/flash_close_position"
const CLOSE_ALL_POSITIONS_PATH = "/api/v1/futures/trade/close_all_position"

function createPositionResult({ data, errors, mutationOutcome, positionOutcome }) {
  return toResult({
    ...(data === undefined ? {} : {
      data,
    }),
    ...(errors === undefined ? {} : {
      errors,
    }),
    mutationOutcome,
    positionOutcome,
  })
}

function requireInputObject({ input, operation }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Bitunix Futures ${operation} input must be an object`)
  }
}

function requireText({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures ${field} must be a non-empty string`)
  }
  return value.trim()
}

function normalizeOptionalSymbol({ symbol }) {
  return symbol === undefined
    ? undefined
    : requireText({
      value: symbol,
      field: "symbol",
    }).toUpperCase()
}

function filterPositions({ positions, symbol, positionId }) {
  return positions.filter((position) =>
    (symbol === undefined || position.symbol === symbol) &&
    (positionId === undefined || position.positionId === positionId))
}

async function readPositions({ broker, symbol, positionId }) {
  const result = await broker.getFuturesPositions({
    ...(symbol === undefined ? {} : {
      symbol,
    }),
    ...(positionId === undefined ? {} : {
      positionId,
    }),
  })
  if (!result.ok) {
    return {
      errors: result.errors ?? [new Error("Bitunix Futures position read failed")],
    }
  }
  return {
    positions: filterPositions({
      positions: result.data,
      symbol,
      positionId,
    }),
  }
}

function createAlreadyClosedResult({ data }) {
  return createPositionResult({
    data,
    mutationOutcome: "NOT_SENT",
    positionOutcome: "ALREADY_CLOSED",
  })
}

function getMutationOutcome({ dispatchError, positionOutcome }) {
  if (dispatchError) {
    if (dispatchError.outcomeUnknown === true) {
      return "OUTCOME_UNKNOWN"
    }
    return "REJECTED"
  }
  if (positionOutcome === "CLOSED") {
    return "CONFIRMED"
  }
  return "OUTCOME_UNKNOWN"
}

async function reconcilePositionMutation({
  broker,
  scope,
  initialPositions,
  dispatchError,
  operation,
}) {
  const finalRead = await readPositions({
    broker,
    ...scope,
  })
  if (finalRead.errors) {
    return createPositionResult({
      errors: [
        ...(dispatchError === undefined ? [] : [dispatchError]),
        ...finalRead.errors,
      ],
      mutationOutcome: getMutationOutcome({
        dispatchError,
        positionOutcome: "UNKNOWN",
      }),
      positionOutcome: "UNKNOWN",
    })
  }
  const remaining = finalRead.positions
  const initialIds = initialPositions.map((position) => position.positionId)
  const remainingIds = remaining.map((position) => position.positionId)
  const closedPositionIds = initialIds.filter((id) => !remainingIds.includes(id))
  let positionOutcome = "OPEN"
  if (remaining.length === 0) {
    positionOutcome = "CLOSED"
  } else if (closedPositionIds.length > 0) {
    positionOutcome = "PARTIALLY_CLOSED"
  }
  let errors
  if (dispatchError !== undefined) {
    errors = [dispatchError]
  } else if (positionOutcome !== "CLOSED") {
    errors = [new Error(`Bitunix Futures ${operation} did not close every position in the requested scope`)]
  }
  return createPositionResult({
    data: {
      operation,
      closedPositionIds,
      remainingPositionIds: remainingIds,
      remainingPositions: remaining,
    },
    errors,
    mutationOutcome: getMutationOutcome({
      dispatchError,
      positionOutcome,
    }),
    positionOutcome,
  })
}

async function dispatchPositionMutation({ broker, path, body }) {
  try {
    await broker.restClient.request({
      method: "POST",
      path,
      body,
      stateChanging: true,
    })
    return undefined
  } catch (error) {
    handleErr({
      where: "Bitunix Futures position mutation",
      error,
    })
    return error
  }
}

/**
 * Close one exact Futures position using Bitunix's positionId-based flash-close endpoint.
 */
export async function closeFuturesPosition({ broker, input } = {}) {
  try {
    requireInputObject({
      input,
      operation: "closeFuturesPosition",
    })
    const positionId = requireText({
      value: input.positionId,
      field: "positionId",
    })
    const symbol = normalizeOptionalSymbol({
      symbol: input.symbol,
    })
    const scope = {
      positionId,
    }
    const preflight = await readPositions({
      broker,
      ...scope,
    })
    if (preflight.errors) {
      return createPositionResult({
        errors: preflight.errors,
        mutationOutcome: "NOT_SENT",
        positionOutcome: "UNKNOWN",
      })
    }
    if (preflight.positions.length === 0) {
      return createAlreadyClosedResult({
        data: {
          positionId,
        },
      })
    }
    if (preflight.positions.length !== 1) {
      throw new Error("Bitunix Futures close requires one unique positionId")
    }
    const [position] = preflight.positions
    if (symbol !== undefined && position.symbol !== symbol) {
      throw new TypeError("Bitunix Futures close position symbol does not match the requested symbol")
    }
    const dispatchError = await dispatchPositionMutation({
      broker,
      path: FLASH_CLOSE_POSITION_PATH,
      body: {
        positionId,
      },
    })
    return reconcilePositionMutation({
      broker,
      scope,
      initialPositions: [position],
      dispatchError,
      operation: "closeFuturesPosition",
    })
  } catch (error) {
    handleErr({
      where: "closeFuturesPosition()",
      error,
    })
    return createPositionResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      positionOutcome: "NOT_SENT",
    })
  }
}

/**
 * Close a position only when symbol and LONG/SHORT side identify exactly one open position.
 */
export async function closeFuturesPositionBySide({ broker, input } = {}) {
  try {
    requireInputObject({
      input,
      operation: "closeFuturesPositionBySide",
    })
    const symbol = requireText({
      value: input.symbol,
      field: "symbol",
    }).toUpperCase()
    const side = requireText({
      value: input.side,
      field: "side",
    }).toUpperCase()
    if (side !== "LONG" && side !== "SHORT") {
      throw new TypeError("Bitunix Futures position side must be LONG or SHORT")
    }
    const preflight = await readPositions({
      broker,
      symbol,
    })
    if (preflight.errors) {
      return createPositionResult({
        errors: preflight.errors,
        mutationOutcome: "NOT_SENT",
        positionOutcome: "UNKNOWN",
      })
    }
    const matches = preflight.positions.filter((position) => position.side === side)
    if (matches.length === 0) {
      return createAlreadyClosedResult({
        data: {
          symbol,
          side,
        },
      })
    }
    if (matches.length !== 1) {
      throw new Error("Bitunix Futures symbol and position side do not identify one unique open position")
    }
    return closeFuturesPosition({
      broker,
      input: {
        positionId: matches[0].positionId,
        symbol,
      },
    })
  } catch (error) {
    handleErr({
      where: "closeFuturesPositionBySide()",
      error,
    })
    return createPositionResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      positionOutcome: "NOT_SENT",
    })
  }
}

/**
 * Close every open Futures position for one symbol, or account-wide after explicit confirmation.
 */
export async function closeAllFuturesPositions({ broker, input } = {}) {
  try {
    requireInputObject({
      input,
      operation: "closeAllFuturesPositions",
    })
    const symbol = normalizeOptionalSymbol({
      symbol: input.symbol,
    })
    if (symbol === undefined && input.confirmAccountWideClose !== true) {
      throw new TypeError("Bitunix Futures account-wide close requires confirmAccountWideClose: true")
    }
    const scope = symbol === undefined ? {} : {
      symbol,
    }
    const preflight = await readPositions({
      broker,
      ...scope,
    })
    if (preflight.errors) {
      return createPositionResult({
        errors: preflight.errors,
        mutationOutcome: "NOT_SENT",
        positionOutcome: "UNKNOWN",
      })
    }
    if (preflight.positions.length === 0) {
      return createAlreadyClosedResult({
        data: {
          ...(symbol === undefined ? {} : {
            symbol,
          }),
        },
      })
    }
    const dispatchError = await dispatchPositionMutation({
      broker,
      path: CLOSE_ALL_POSITIONS_PATH,
      body: symbol === undefined ? {} : {
        symbol,
      },
    })
    return reconcilePositionMutation({
      broker,
      scope,
      initialPositions: preflight.positions,
      dispatchError,
      operation: "closeAllFuturesPositions",
    })
  } catch (error) {
    handleErr({
      where: "closeAllFuturesPositions()",
      error,
    })
    return createPositionResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      positionOutcome: "NOT_SENT",
    })
  }
}
