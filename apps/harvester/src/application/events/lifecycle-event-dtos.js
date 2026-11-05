import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { addDecimal, assertDecimalString, assertObjectInput, toResult } from "@coinzilla/utils"

const STRATEGY_MODES = Object.freeze(["read-only", "conservative", "aggressive"])
const OUTCOMES = Object.freeze(["success", "failed"])
const SECRET_ASSIGNMENT = /\b(api[\s_-]?key|api[\s_-]?secret|client[\s_-]?secret|access[\s_-]?token|secret|token|password|authorization|signature)\b(\s*[:=]\s*|\s+is\s+|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi

const requireString = ({ value, field }) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value.trim()
}

const requireBoolean = ({ value, field }) => {
  if (typeof value !== "boolean") {
    throw new TypeError(field + " must be a boolean")
  }
  return value
}

const requireStrategyMode = ({ value }) => {
  if (!STRATEGY_MODES.includes(value)) {
    throw new TypeError("strategyMode must be read-only, conservative, or aggressive")
  }
  return value
}

const requireMarkets = ({ value }) => {
  if (!Array.isArray(value)) {
    throw new TypeError("enabledMarkets must be an array")
  }
  const markets = value.map((symbol, index) =>
    requireString({ value: symbol, field: "enabledMarkets[" + index + "]" })
  )
  if (new Set(markets).size !== markets.length) {
    throw new TypeError("enabledMarkets must not contain duplicates")
  }
  return markets
}

const safeError = ({ error }) => {
  if (!(error instanceof Error)) {
    throw new TypeError("error must be an Error")
  }
  const name = typeof error.name === "string" && error.name.trim()
    ? error.name.trim().slice(0, 80)
    : "Error"
  const rawMessage = typeof error.message === "string" ? error.message : "Unknown error"
  const message = rawMessage
    .replace(SECRET_ASSIGNMENT, "$1$2[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .slice(0, 240)
  return { name, message }
}

const mapData = (input, operation, mapper) => {
  try {
    assertObjectInput({ input, operation })
    return toResult({ data: mapper(input) })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Map process-start facts to a small allowlisted DTO.
 * Extra input properties (including credentials and account data) are ignored.
 */
export const mapHarvesterStartedData = (input = {}) =>
  mapData(input, "Harvester started event mapping", ({
    broker,
    strategyMode,
    enabledMarkets,
    tradingEnabled,
  }) => ({
    broker: requireString({ value: broker, field: "broker" }),
    strategyMode: requireStrategyMode({ value: strategyMode }),
    enabledMarkets: requireMarkets({ value: enabledMarkets }),
    tradingEnabled: requireBoolean({ value: tradingEnabled, field: "tradingEnabled" }),
  }))

/** Map a startup failure without exposing stack traces, causes, or raw Error objects. */
export const mapHarvesterStartupFailedData = (input = {}) =>
  mapData(input, "Harvester startup-failed event mapping", ({ stage, error }) => ({
    stage: requireString({ value: stage, field: "stage" }),
    error: safeError({ error }),
  }))

/** Map a completed shutdown attempt. */
export const mapHarvesterStoppedData = (input = {}) =>
  mapData(input, "Harvester stopped event mapping", ({ reason, outcome, error }) => {
    if (!OUTCOMES.includes(outcome)) {
      throw new TypeError("outcome must be success or failed")
    }
    return {
      reason: requireString({ value: reason, field: "reason" }),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })

/** Map only non-secret effective configuration facts, never the full config. */
export const mapConfigValidatedData = (input = {}) =>
  mapData(input, "Configuration-validated event mapping", ({
    enabledMarkets,
    strategyMode,
    tradingEnabled,
  }) => ({
    enabledMarkets: requireMarkets({ value: enabledMarkets }),
    strategyMode: requireStrategyMode({ value: strategyMode }),
    tradingEnabled: requireBoolean({ value: tradingEnabled, field: "tradingEnabled" }),
  }))

export const mapBrokerConnectedData = (input = {}) =>
  mapData(input, "Broker-connected event mapping", ({ broker }) => ({
    broker: requireString({ value: broker, field: "broker" }),
  }))

export const mapBrokerConnectionFailedData = (input = {}) =>
  mapData(input, "Broker-connection-failed event mapping", ({ broker, error }) => ({
    broker: requireString({ value: broker, field: "broker" }),
    error: safeError({ error }),
  }))

export const mapBrokerDisconnectedData = (input = {}) =>
  mapData(input, "Broker-disconnected event mapping", ({ broker, outcome, error }) => {
    if (!OUTCOMES.includes(outcome)) {
      throw new TypeError("outcome must be success or failed")
    }
    return {
      broker: requireString({ value: broker, field: "broker" }),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })

const STREAM_KINDS = Object.freeze(["user-data", "market-price"])

const requireStream = ({ value }) => {
  if (!STREAM_KINDS.includes(value)) {
    throw new TypeError("stream must be user-data or market-price")
  }
  return value
}

const optionalMarket = ({ value, stream }) => {
  if (stream === "market-price") {
    return requireString({ value, field: "market" })
  }
  if (value !== undefined) {
    throw new TypeError("market is only valid for market-price streams")
  }
  return undefined
}

export const mapBrokerSubscriptionEstablishedData = (input = {}) =>
  mapData(input, "Broker-subscription-established event mapping", ({ broker, stream, market }) => {
    const normalizedStream = requireStream({ value: stream })
    const normalizedMarket = optionalMarket({ value: market, stream: normalizedStream })
    return {
      broker: requireString({ value: broker, field: "broker" }),
      stream: normalizedStream,
      ...(normalizedMarket === undefined ? {} : { market: normalizedMarket }),
    }
  })

export const mapBrokerSubscriptionFailedData = (input = {}) =>
  mapData(input, "Broker-subscription-failed event mapping", ({ broker, stream, market, error }) => {
    const normalizedStream = requireStream({ value: stream })
    const normalizedMarket = optionalMarket({ value: market, stream: normalizedStream })
    return {
      broker: requireString({ value: broker, field: "broker" }),
      stream: normalizedStream,
      ...(normalizedMarket === undefined ? {} : { market: normalizedMarket }),
      error: safeError({ error }),
    }
  })

export const mapBrokerStatusChangedData = (input = {}) =>
  mapData(input, "Broker-status-changed event mapping", ({
    broker,
    stream,
    status,
    recoveryRequired,
    attempt,
    code,
    error,
  }) => {
    const normalizedStream = requireStream({ value: stream })
    if (typeof recoveryRequired !== "boolean") {
      throw new TypeError("recoveryRequired must be a boolean")
    }
    if (attempt !== undefined && (!Number.isSafeInteger(attempt) || attempt < 0)) {
      throw new TypeError("attempt must be a non-negative safe integer")
    }
    if (code !== undefined && code !== null && !Number.isSafeInteger(code)) {
      throw new TypeError("code must be a safe integer")
    }
    return {
      broker: requireString({ value: broker, field: "broker" }),
      stream: normalizedStream,
      status: requireString({ value: status, field: "status" }),
      recoveryRequired,
      ...(attempt === undefined ? {} : { attempt }),
      ...(code === undefined || code === null ? {} : { code }),
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })


const requireDecimalString = ({ value, field }) => {
  if (typeof value !== "string") throw new TypeError(field + " must be a decimal string")
  assertDecimalString({ value, field })
  return value
}

const requireOrderFacts = ({ order }) => {
  if (!order || typeof order !== "object" || !order.market?.symbol) {
    throw new TypeError("order must contain canonical market facts")
  }
  return {
    clientOrderId: requireString({ value: order.clientOrderId, field: "clientOrderId" }),
    symbol: requireString({ value: order.market.symbol, field: "symbol" }),
    side: order.side === "BUY" || order.side === "SELL"
      ? order.side
      : (() => { throw new TypeError("order.side must be BUY or SELL") })(),
    type: requireString({ value: order.type, field: "type" }),
    price: requireDecimalString({ value: order.limitPrice?.amount, field: "price" }),
    quantity: requireDecimalString({ value: order.originalQuantity?.amount, field: "quantity" }),
  }
}

/** Map an actionable strategy decision; NO_ACTION evaluations are not journal events. */
export const mapStrategyDecisionData = (input = {}) =>
  mapData(input, "Strategy-decision event mapping", ({ strategy, symbol, referencePrice, actions }) => {
    if (strategy !== "CONSERVATIVE") throw new TypeError("strategy must be CONSERVATIVE")
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new TypeError("strategy decision must contain at least one actionable order")
    }
    return {
      strategy,
      symbol: requireString({ value: symbol, field: "symbol" }),
      referencePrice: requireDecimalString({ value: referencePrice, field: "referencePrice" }),
      actions: actions.map((action, index) => ({
        side: action?.side === "BUY" || action?.side === "SELL"
          ? action.side
          : (() => { throw new TypeError("actions[" + index + "].side must be BUY or SELL") })(),
        type: requireString({ value: action?.type, field: "actions[" + index + "].type" }),
        price: requireDecimalString({ value: action?.price, field: "actions[" + index + "].price" }),
        quantity: requireDecimalString({ value: action?.quantity, field: "actions[" + index + "].quantity" }),
        ...(action?.reason === undefined ? {} : {
          reason: requireString({ value: action.reason, field: "actions[" + index + "].reason" }),
        }),
      })),
    }
  })

/** Map the local pending order immediately before broker submission. */
export const mapOrderSubmissionRequestedData = (input = {}) =>
  mapData(input, "Order-submission-requested event mapping", ({ order }) => ({
    ...requireOrderFacts({ order }),
    status: requireString({ value: order.status, field: "order.status" }),
  }))

/** Map only a broker-acknowledged canonical order. */
export const mapOrderSubmittedData = (input = {}) =>
  mapData(input, "Order-submitted event mapping", ({ order }) => ({
    ...requireOrderFacts({ order }),
    brokerOrderId: requireString({ value: order.brokerOrderId, field: "brokerOrderId" }),
    status: requireString({ value: order.status, field: "order.status" }),
  }))

/** Map a rejected or unknown submission without retaining raw errors or SDK data. */
export const mapOrderSubmissionFailedData = (input = {}) =>
  mapData(input, "Order-submission-failed event mapping", ({ order, outcome, error }) => {
    if (!["REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"].includes(outcome)) {
      throw new TypeError("outcome must be REJECTED, REJECTED_OR_UNKNOWN, or UNKNOWN")
    }
    return {
      clientOrderId: requireString({ value: order?.clientOrderId, field: "clientOrderId" }),
      symbol: requireString({ value: order?.market?.symbol, field: "symbol" }),
      side: order?.side === "BUY" || order?.side === "SELL"
        ? order.side
        : (() => { throw new TypeError("order.side must be BUY or SELL") })(),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })


/** Map the first transition of a strategy pair into its paused state. */
export const mapStrategyPausedData = (input = {}) =>
  mapData(input, "Strategy-paused event mapping", ({ symbol, reason, error }) => ({
    symbol: requireString({ value: symbol, field: "symbol" }),
    reason: requireString({ value: reason, field: "reason" }),
    ...(error === undefined ? {} : { error: safeError({ error }) }),
  }))

/** Map a cancellation intent before any broker cancellation request is sent. */
export const mapOrderCancellationRequestedData = (input = {}) =>
  mapData(input, "Order-cancellation-requested event mapping", ({ order, reason }) => {
    const facts = requireOrderFacts({ order })
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
      throw new TypeError("order.status must be OPEN or PARTIALLY_FILLED before cancellation")
    }
    return {
      ...facts,
      brokerOrderId: requireString({ value: order.brokerOrderId, field: "brokerOrderId" }),
      executedQuantity: requireDecimalString({
        value: order.executedQuantity?.amount,
        field: "executedQuantity",
      }),
      status: order.status,
      reason: requireString({ value: reason, field: "reason" }),
    }
  })

/** Map a broker-confirmed cancellation after the local order registry is updated. */
export const mapOrderCancelledData = (input = {}) =>
  mapData(input, "Order-cancelled event mapping", ({ order }) => {
    const facts = requireOrderFacts({ order })
    if (order.status !== "CANCELED") throw new TypeError("order.status must be CANCELED")
    return {
      ...facts,
      brokerOrderId: requireString({ value: order.brokerOrderId, field: "brokerOrderId" }),
      executedQuantity: requireDecimalString({
        value: order.executedQuantity?.amount,
        field: "executedQuantity",
      }),
      status: "CANCELED",
    }
  })

/** Map a cancellation that was not confirmed without retaining raw broker data. */
export const mapOrderCancelFailedData = (input = {}) =>
  mapData(input, "Order-cancel-failed event mapping", ({ order, outcome, error }) => {
    if (!["ORDER_STATE_UNKNOWN", "UNCONFIRMED", "NOT_REGISTERED", "NOT_CANCELED"].includes(outcome)) {
      throw new TypeError("outcome must describe an unconfirmed or unsuccessful cancellation")
    }
    return {
      clientOrderId: requireString({ value: order?.clientOrderId, field: "clientOrderId" }),
      symbol: requireString({ value: order?.market?.symbol, field: "symbol" }),
      side: order?.side === "BUY" || order?.side === "SELL"
        ? order.side
        : (() => { throw new TypeError("order.side must be BUY or SELL") })(),
      ...(typeof order?.brokerOrderId === "string" && order.brokerOrderId.trim()
        ? { brokerOrderId: order.brokerOrderId.trim() }
        : {}),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })


/** Map a canonical Fill only after both accounting projections were committed. */
export const mapFillAppliedData = (input = {}) =>
  mapData(input, "Fill-applied event mapping", ({ fill }) => {
    if (!(fill instanceof Fill)) throw new TypeError("fill must be a canonical Fill")
    return {
      fillId: requireString({ value: fill.id, field: "fillId" }),
      tradeId: requireString({ value: fill.tradeId, field: "tradeId" }),
      brokerOrderId: requireString({ value: fill.brokerOrderId, field: "brokerOrderId" }),
      ...(fill.clientOrderId === undefined ? {} : {
        clientOrderId: requireString({ value: fill.clientOrderId, field: "clientOrderId" }),
      }),
      symbol: requireString({ value: fill.market.symbol, field: "symbol" }),
      side: fill.side === "BUY" || fill.side === "SELL"
        ? fill.side
        : (() => { throw new TypeError("fill.side must be BUY or SELL") })(),
      price: requireDecimalString({ value: fill.price?.amount, field: "price" }),
      quantity: requireDecimalString({ value: fill.quantity?.amount, field: "quantity" }),
      quoteQuantity: requireDecimalString({ value: fill.quoteQuantity?.amount, field: "quoteQuantity" }),
      liquidityRole: requireString({ value: fill.liquidityRole, field: "liquidityRole" }),
      ...(fill.executedAt === undefined ? {} : { executedAt: fill.executedAt }),
      commissions: fill.commissions.map((commission, index) => ({
        amount: requireDecimalString({
          value: commission.amount?.amount,
          field: "commissions[" + index + "].amount",
        }),
        assetId: requireString({
          value: commission.amount?.asset?.id,
          field: "commissions[" + index + "].assetId",
        }),
        asset: requireString({
          value: commission.amount?.asset?.code,
          field: "commissions[" + index + "].asset",
        }),
      })),
      commissionStatus: requireString({ value: fill.commissionStatus, field: "commissionStatus" }),
    }
  })


const requireExecutionOrderFacts = ({ order }) => {
  if (!(order instanceof CanonicalOrder)) throw new TypeError("order must be a canonical Harvester order")
  if (order.side !== "BUY" && order.side !== "SELL") throw new TypeError("order.side must be BUY or SELL")
  return {
    clientOrderId: requireString({ value: order.clientOrderId, field: "clientOrderId" }),
    ...(typeof order.brokerOrderId === "string" && order.brokerOrderId.trim()
      ? { brokerOrderId: order.brokerOrderId.trim() }
      : {}),
    symbol: requireString({ value: order.market?.symbol, field: "symbol" }),
    side: order.side,
    status: requireString({ value: order.status, field: "status" }),
  }
}

const requireExecutionFillFacts = ({ fill }) => {
  if (!(fill instanceof Fill)) throw new TypeError("fill must be a canonical Fill")
  return {
    fillId: requireString({ value: fill.id, field: "fillId" }),
    fillBrokerOrderId: requireString({ value: fill.brokerOrderId, field: "fillBrokerOrderId" }),
    fillSymbol: requireString({ value: fill.market?.symbol, field: "fillSymbol" }),
    fillSide: fill.side === "BUY" || fill.side === "SELL"
      ? fill.side
      : (() => { throw new TypeError("fill.side must be BUY or SELL") })(),
  }
}

/** Map an order update that cannot be associated with a Harvester-owned order. */
export const mapExecutionUnownedOrderData = (input = {}) =>
  mapData(input, "Execution-unowned-order event mapping", ({ order }) => ({
    ...requireExecutionOrderFacts({ order }),
    reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
  }))

/** Map a missing or identity-mismatched Fill without exposing the raw event. */
export const mapExecutionInvalidFillData = (input = {}) =>
  mapData(input, "Execution-invalid-Fill event mapping", ({ order, fill, reason, error }) => {
    if (!["MISSING_FILL", "IDENTITY_MISMATCH"].includes(reason)) {
      throw new TypeError("reason must be MISSING_FILL or IDENTITY_MISMATCH")
    }
    return {
      ...requireExecutionOrderFacts({ order }),
      reason,
      ...(fill === undefined ? {} : requireExecutionFillFacts({ fill })),
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })

/** Map accounting failure after the canonical Fill has been validated. */
export const mapExecutionAccountingFailedData = (input = {}) =>
  mapData(input, "Execution-accounting-failed event mapping", ({ order, fill, error }) => ({
    ...requireExecutionOrderFacts({ order }),
    ...requireExecutionFillFacts({ fill }),
    error: safeError({ error }),
  }))


/** Map an idempotent duplicate Fill without implying a second accounting application. */
export const mapDuplicateFillData = (input = {}) => {
  const fillResult = mapFillAppliedData(input)
  if (!fillResult.ok) return fillResult
  return toResult({ data: { ...fillResult.data, duplicate: true } })
}

/** Map a completed recovery cycle after the application has committed its reset. */
export const mapRecoveryCycleCompletedData = (input = {}) =>
  mapData(input, "Recovery-cycle-completed event mapping", ({ symbol, marketId, freeQuantity, realizedNetProfit }) => ({
    symbol: requireString({ value: symbol, field: "symbol" }),
    marketId: requireString({ value: marketId, field: "marketId" }),
    freeQuantity: requireDecimalString({ value: freeQuantity, field: "freeQuantity" }),
    realizedNetProfit: requireDecimalString({ value: realizedNetProfit, field: "realizedNetProfit" }),
  }))



/** Map the complete account-wide open-order snapshot before trading readiness is granted. */
export const mapAccountOpenOrdersCapturedData = (input = {}) =>
  mapData(input, "Account-open-orders-captured event mapping", ({
    phase, observedAt, orders, readiness, blockReasons = [],
  }) => {
    if (!["OPENING", "PREFLIGHT"].includes(phase)) throw new TypeError("phase must be OPENING or PREFLIGHT")
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      throw new TypeError("observedAt must be a non-negative safe integer")
    }
    if (!Array.isArray(orders)) throw new TypeError("orders must be an array")
    if (!["READY", "BLOCKED"].includes(readiness)) {
      throw new TypeError("readiness must be READY or BLOCKED")
    }
    if (!Array.isArray(blockReasons) || blockReasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
      throw new TypeError("blockReasons must contain non-empty strings")
    }
    const mappedOrders = orders.map((order, index) => {
      if (!order || typeof order !== "object") {
        throw new TypeError("orders[" + index + "] must be a normalized broker order")
      }
      const symbol = order.market?.symbol ?? order.symbol
      const brokerOrderId = order.brokerOrderId ?? order.id
      const price = order.limitPrice?.amount ?? order.originalPrice
      const quantity = order.originalQuantity?.amount ?? order.originalQuantity
      const executedQuantity = order.executedQuantity?.amount ?? order.executedQuantity ?? "0"
      return {
        ...(typeof order.clientOrderId === "string" && order.clientOrderId.trim()
          ? { clientOrderId: order.clientOrderId.trim() }
          : {}),
        brokerOrderId: requireString({ value: brokerOrderId, field: "orders[" + index + "].brokerOrderId" }),
        symbol: requireString({ value: symbol, field: "orders[" + index + "].symbol" }),
        side: order.side === "BUY" || order.side === "SELL"
          ? order.side
          : (() => { throw new TypeError("orders[" + index + "].side must be BUY or SELL") })(),
        type: requireString({ value: order.type, field: "orders[" + index + "].type" }),
        ...(price === undefined ? {} : {
          price: requireDecimalString({ value: price, field: "orders[" + index + "].price" }),
        }),
        quantity: requireDecimalString({ value: quantity, field: "orders[" + index + "].quantity" }),
        executedQuantity: requireDecimalString({
          value: executedQuantity,
          field: "orders[" + index + "].executedQuantity",
        }),
        status: requireString({ value: order.status, field: "orders[" + index + "].status" }),
      }
    }).sort((left, right) =>
      left.symbol.localeCompare(right.symbol) ||
      left.brokerOrderId.localeCompare(right.brokerOrderId)
    )
    const identities = mappedOrders.map(({ symbol, brokerOrderId }) => symbol + ":" + brokerOrderId)
    if (new Set(identities).size !== identities.length) {
      throw new TypeError("orders must not contain duplicate symbol/brokerOrderId identities")
    }
    if (readiness === "READY" && (mappedOrders.length > 0 || blockReasons.length > 0)) {
      throw new TypeError("READY open-order audit requires no open orders and no block reasons")
    }
    if (readiness === "BLOCKED" && blockReasons.length === 0) {
      throw new TypeError("BLOCKED open-order audit requires blockReasons")
    }
    return {
      phase,
      observedAt,
      readiness,
      orderCount: mappedOrders.length,
      orders: mappedOrders,
      blockReasons: [...blockReasons],
    }
  })

/** Map all exchange-returned balances into an exact-decimal account audit event. */
export const mapAccountSnapshotCapturedData = (input = {}) =>
  mapData(input, "Account-snapshot-captured event mapping", ({
    phase, snapshot, auditStatus = "COMPLETE", auditReasons = [],
  }) => {
    if (!["OPENING", "CLOSING", "PREFLIGHT"].includes(phase)) throw new TypeError("phase must be OPENING, CLOSING, or PREFLIGHT")
    if (!["COMPLETE", "INCOMPLETE"].includes(auditStatus)) throw new TypeError("auditStatus must be COMPLETE or INCOMPLETE")
    if (!snapshot || !Array.isArray(snapshot.balances) || !Number.isSafeInteger(snapshot.sourceTime)) {
      throw new TypeError("snapshot must contain sourceTime and canonical balances")
    }
    if (!Array.isArray(auditReasons) || auditReasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
      throw new TypeError("auditReasons must contain non-empty strings")
    }
    const balances = snapshot.balances.map((balance, index) => {
      const asset = requireString({ value: balance?.asset?.code, field: "balances[" + index + "].asset.code" })
      const free = requireDecimalString({ value: balance?.free?.amount, field: "balances[" + index + "].free" })
      const locked = requireDecimalString({ value: balance?.locked?.amount, field: "balances[" + index + "].locked" })
      return { asset, free, locked, total: addDecimal({ left: free, right: locked }) }
    }).sort((left, right) => left.asset.localeCompare(right.asset))
    if (new Set(balances.map(({ asset }) => asset)).size !== balances.length) {
      throw new TypeError("snapshot must not contain duplicate asset codes")
    }
    if (auditStatus === "COMPLETE" && auditReasons.length > 0) throw new TypeError("COMPLETE snapshot cannot contain auditReasons")
    if (auditStatus === "INCOMPLETE" && auditReasons.length === 0) throw new TypeError("INCOMPLETE snapshot requires auditReasons")
    return { phase, auditStatus, sourceTime: snapshot.sourceTime, assetCount: balances.length, balances, auditReasons: [...auditReasons] }
  })
