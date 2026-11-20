import { addDecimal, assertDecimalString, compareDecimal, toResult } from "@coinzilla/utils"

const EVENT = Object.freeze({
  STARTED: "harvester.started",
  STOPPED: "harvester.stopped",
  ACCOUNT_SNAPSHOT: "account.snapshot_captured",
  ACCOUNT_OPEN_ORDERS: "account.open_orders_captured",
  SUBMISSION_REQUESTED: "order.submission_requested",
  SUBMITTED: "order.submitted",
  SUBMISSION_FAILED: "order.submission_failed",
  CANCEL_REQUESTED: "order.cancel_requested",
  CANCELLED: "order.cancelled",
  CANCEL_FAILED: "order.cancel_failed",
  FILL_APPLIED: "execution.fill_applied",
  RECOVERY_COMPLETED: "recovery.cycle_completed",
  RECOVERY_NOT_COMPLETED: "recovery.cycle_not_completed",
  STRATEGY_PAUSED: "strategy.paused",
  EXECUTION_UNOWNED_ORDER: "execution.unowned_order",
  EXECUTION_INVALID_FILL: "execution.invalid_fill",
  EXECUTION_ACCOUNTING_FAILED: "execution.accounting_failed",
})

const ORDER_SIDES = new Set(["BUY", "SELL"])
const SUBMISSION_OUTCOMES = new Set(["REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"])
const CANCEL_OUTCOMES = new Set(["ORDER_STATE_UNKNOWN", "UNCONFIRMED", "NOT_REGISTERED", "NOT_CANCELED"])

// Explicitly non-authoritative telemetry/lifecycle diagnostics. Canonical order,
// fill and safety transitions are represented by the replay facts below; keep
// this allowlist aligned with HARVESTER_EVENT_NAMES and fail closed otherwise.
const IGNORABLE_HARVESTER_EVENTS = new Set([
  "harvester.process_started",
  "harvester.startup_failed",
  "config.validated",
  "broker.connected",
  "broker.connection_failed",
  "broker.disconnected",
  "broker.status_changed",
  "broker.subscription_established",
  "broker.subscription_failed",
  "strategy.decision",
  "market.trading_rules_captured",
  "broker.execution_report",
  "order.updated",
  "execution.duplicate_fill",
])

function requireObject({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field  } must be an object`)
  }
  return value
}

function requireString({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field  } must be a non-empty string`)
  }
  return value.trim()
}

function requireDecimal({ value, field, positive = false }) {
  if (typeof value !== "string") {throw new TypeError(`${field  } must be an exact decimal string`)}
  assertDecimalString({ value,
field })
  if (compareDecimal({ left: value,
right: "0" }) < (positive ? 1 : 0)) {
    throw new RangeError(field + (positive ? " must be positive" : " must be non-negative"))
  }
  return value
}

function requireSignedDecimal({ value, field }) {
  if (typeof value !== "string") {throw new TypeError(`${field  } must be an exact decimal string`)}
  assertDecimalString({ value,
field })
  return value
}

function requireRecoveryDust({ value }) {
  if (value === undefined) {return undefined}
  const dust = requireObject({ value,
field: "dust" })
  if (dust.status !== "EXCHANGE_CONSTRAINED_DUST") {throw new TypeError("dust.status must be EXCHANGE_CONSTRAINED_DUST")}
  if (!["MIN_QUANTITY", "MIN_NOTIONAL", "QUANTITY_INCREMENT"].includes(dust.reason)) {
    throw new TypeError("dust.reason must identify the limiting exchange filter")
  }
  const mapped = {
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: requireDecimal({ value: dust.quantity,
field: "dust.quantity",
positive: true }),
    reason: dust.reason,
  }
  const fields = {
    MIN_QUANTITY: ["minimumQuantity", "evaluatedQuantity"],
    MIN_NOTIONAL: ["minimumQuantity", "minimumNotional", "evaluatedQuantity", "evaluatedNotional"],
    QUANTITY_INCREMENT: ["quantityStepSize", "evaluatedQuantity"],
  }[dust.reason]
  for (const field of fields) {
    mapped[field] = requireDecimal({ value: dust[field],
field: `dust.${  field}` })
    if (["minimumQuantity", "minimumNotional", "quantityStepSize"].includes(field) &&
        compareDecimal({ left: mapped[field],
right: "0" }) <= 0) {
      throw new RangeError(`dust.${  field  } must be positive`)
    }
  }
  if (dust.reason === "MIN_QUANTITY" &&
      compareDecimal({ left: mapped.evaluatedQuantity,
right: mapped.minimumQuantity }) >= 0) {
    throw new RangeError("dust MIN_QUANTITY evidence does not prove the quantity is below the minimum")
  }
  if (dust.reason === "MIN_NOTIONAL" &&
      (compareDecimal({ left: mapped.evaluatedQuantity,
right: mapped.minimumQuantity }) < 0 ||
       compareDecimal({ left: mapped.evaluatedNotional,
right: mapped.minimumNotional }) >= 0)) {
    throw new RangeError("dust MIN_NOTIONAL evidence does not prove the notional is below the minimum")
  }
  if (dust.reason === "QUANTITY_INCREMENT" && mapped.evaluatedQuantity !== "0") {
    throw new RangeError("dust QUANTITY_INCREMENT evidence must record a zero rounded candidate")
  }
  return mapped
}

function requireOrderIntent({ data }) {
  const clientOrderId = requireString({ value: data.clientOrderId,
field: "clientOrderId" })
  const providerFields = ["providerInstanceId", "providerType", "accountId"]
  const providerValues = providerFields.map((field) => data[field])
  if (providerValues.some((value) => value !== undefined) && providerValues.some((value) => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))) {
    throw new TypeError("Journal order provenance must contain all three stable provider identifiers")
  }
  const providerIdentity = providerValues.every((value) => value === undefined) ? {} : {
    providerInstanceId: data.providerInstanceId,
    providerType: data.providerType,
    accountId: data.accountId,
  }
  const symbol = requireString({ value: data.symbol,
field: "symbol" })
  if (!ORDER_SIDES.has(data.side)) {throw new TypeError("order side must be BUY or SELL")}
  const type = requireString({ value: data.type,
field: "type" })
  const price = requireDecimal({ value: data.price,
field: "price",
positive: true })
  const quantity = requireDecimal({ value: data.quantity,
field: "quantity",
positive: true })
  return { clientOrderId,
    ...providerIdentity,
symbol,
side: data.side,
type,
price,
quantity }
}

function assertSameIntent({ current, next }) {
  for (const field of ["clientOrderId", "providerInstanceId", "providerType", "accountId", "symbol", "side", "type", "price", "quantity"]) {
    if (current[field] !== next[field]) {
      throw new Error(`Journal order event changed immutable ${  field  } for ${  current.clientOrderId}`)
    }
  }
}

function requireFillIdentity({ data }) {
  const fillId = requireString({
    value: data.fillId,
    field: "fillId",
  })
  const tradeId = requireString({
    value: data.tradeId,
    field: "tradeId",
  })
  const brokerOrderId = requireString({
    value: data.brokerOrderId,
    field: "brokerOrderId",
  })
  const clientOrderId = data.clientOrderId === undefined
    ? undefined
    : requireString({
        value: data.clientOrderId,
        field: "clientOrderId",
      })
  const providerFields = ["providerInstanceId", "providerType", "accountId"]
  const providerValues = providerFields.map((field) => data[field])
  const hasProviderIdentity = providerValues.some((value) => value !== undefined)
  if (hasProviderIdentity && (
    providerValues.some((value) => typeof value !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) ||
    clientOrderId === undefined
  )) {
    throw new TypeError("Journal fill provenance requires all three provider identifiers and clientOrderId")
  }
  const providerIdentity = hasProviderIdentity ? {
    providerInstanceId: data.providerInstanceId,
    providerType: data.providerType,
    accountId: data.accountId,
  } : {}
  return {
    fillId,
    tradeId,
    brokerOrderId,
    ...(clientOrderId === undefined ? {} : { clientOrderId }),
    ...providerIdentity,
  }
}

function requireFillCommissions({ data }) {
  if (!Array.isArray(data.commissions)) {
    throw new TypeError("fill commissions must be an array")
  }
  return data.commissions.map((commission) => ({
    amount: requireDecimal({
      value: commission?.amount,
      field: "commission.amount",
    }),
    assetId: requireString({
      value: commission?.assetId,
      field: "commission.assetId",
    }),
    asset: requireString({
      value: commission?.asset,
      field: "commission.asset",
    }),
    ...(commission?.quoteValue === undefined ? {} : {
      quoteValue: {
        amount: requireDecimal({
          value: commission.quoteValue?.amount,
          field: "commission.quoteValue.amount",
        }),
        assetId: requireString({
          value: commission.quoteValue?.assetId,
          field: "commission.quoteValue.assetId",
        }),
        asset: requireString({
          value: commission.quoteValue?.asset,
          field: "commission.quoteValue.asset",
        }),
      },
    }),
  }))
}

function requireFill({ data }) {
  const identity = requireFillIdentity({ data })
  const symbol = requireString({
    value: data.symbol,
    field: "symbol",
  })
  if (!ORDER_SIDES.has(data.side)) {
    throw new TypeError("fill side must be BUY or SELL")
  }
  const price = requireDecimal({
    value: data.price,
    field: "price",
    positive: true,
  })
  const quantity = requireDecimal({
    value: data.quantity,
    field: "quantity",
    positive: true,
  })
  const quoteQuantity = requireDecimal({
    value: data.quoteQuantity,
    field: "quoteQuantity",
    positive: true,
  })
  const liquidityRole = requireString({
    value: data.liquidityRole,
    field: "liquidityRole",
  })
  const commissionStatus = requireString({
    value: data.commissionStatus,
    field: "commissionStatus",
  })
  const commissions = requireFillCommissions({ data })
  if (data.duplicate !== undefined && typeof data.duplicate !== "boolean") {
    throw new TypeError("fill duplicate marker must be a boolean")
  }
  return {
    ...identity,
    symbol,
    side: data.side,
    price,
    quantity,
    quoteQuantity,
    liquidityRole,
    ...(data.executedAt === undefined ? {} : { executedAt: data.executedAt }),
    commissions,
    commissionStatus,
    ...(data.duplicate === true ? { duplicate: true } : {}),
  }
}

function fillFingerprint({ fill }) {
  const facts = Object.fromEntries(
    Object.entries(fill).filter(([key]) => key !== "duplicate"),
  )
  return JSON.stringify(facts)
}

/**
 * Build a strict, immutable replay projection from validated Journal records.
 * This does not open the trading gate: every projected order still requires
 * canonical exchange reconciliation before it can be restored as actionable.
 */
const TRADING_ACTIVITY_EVENTS = new Set([
  EVENT.SUBMISSION_REQUESTED,
  EVENT.SUBMITTED,
  EVENT.SUBMISSION_FAILED,
  EVENT.CANCEL_REQUESTED,
  EVENT.CANCELLED,
  EVENT.CANCEL_FAILED,
  EVENT.FILL_APPLIED,
  EVENT.RECOVERY_COMPLETED,
  EVENT.RECOVERY_NOT_COMPLETED,
  EVENT.STRATEGY_PAUSED,
  EVENT.EXECUTION_UNOWNED_ORDER,
  EVENT.EXECUTION_INVALID_FILL,
  EVENT.EXECUTION_ACCOUNTING_FAILED,
])

const SAFETY_BLOCKER_EVENTS = new Set([
  EVENT.EXECUTION_UNOWNED_ORDER,
  EVENT.EXECUTION_INVALID_FILL,
  EVENT.EXECUTION_ACCOUNTING_FAILED,
])

function createProjectionState() {
  return {
    ordersByClientId: new Map(),
    clientIdByBrokerId: new Map(),
    fillsById: new Map(),
    tradeIdBySymbol: new Map(),
    cycles: [],
    recoveryCycleEvaluations: [],
    pausedMarkets: new Map(),
    stickySafetyBlockers: [],
    sessionsByFile: new Map(),
    accountSnapshots: [],
    openOrderSnapshots: [],
    lastFullyFilledSellBySymbol: new Map(),
  }
}

function requireProjectedOrder({ state, clientOrderId, eventName }) {
  const order = state.ordersByClientId.get(clientOrderId)
  if (!order) {
    throw new Error(`${eventName} references an unknown clientOrderId ${clientOrderId}`)
  }
  return order
}

function getOrCreateProjectionSession({ state, fileName }) {
  const existingSession = state.sessionsByFile.get(fileName)
  if (existingSession) {
    return existingSession
  }
  const session = {
    fileName,
    started: false,
    tradingEnabled: false,
    hasTradingActivity: false,
    stoppedOutcome: undefined,
    hasCompleteClosingSnapshot: false,
    closingSnapshotCount: 0,
    lastAccountSnapshotSourceTime: undefined,
    lastOpenOrdersObservedAt: undefined,
  }
  state.sessionsByFile.set(fileName, session)
  return session
}

function handleSessionLifecycleEvent({ name, data, session }) {
  if (name === EVENT.STARTED) {
    if (session.started) {
      throw new Error("Journal session contains multiple started events")
    }
    if (typeof data.tradingEnabled !== "boolean") {
      throw new TypeError("harvester.started tradingEnabled must be boolean")
    }
    session.started = true
    session.tradingEnabled = data.tradingEnabled
    return true
  }
  if (name === EVENT.STOPPED) {
    if (!session.started) {
      throw new Error("harvester.stopped has no preceding harvester.started event")
    }
    if (!["success", "failed"].includes(data.outcome)) {
      throw new TypeError("harvester.stopped outcome must be success or failed")
    }
    requireString({ value: data.reason,
field: "harvester.stopped reason" })
    session.stoppedOutcome = data.outcome
    return true
  }
  return false
}

function normalizeAccountBalances({ balances }) {
  const normalizedBalances = []
  for (const [index, balance] of balances.entries()) {
    const asset = requireString({ value: balance?.asset,
field: `balances[${index}].asset` })
    const free = requireDecimal({ value: balance?.free,
field: `balances[${index}].free` })
    const locked = requireDecimal({ value: balance?.locked,
field: `balances[${index}].locked` })
    const total = requireDecimal({ value: balance?.total,
field: `balances[${index}].total` })
    if (total !== addDecimal({ left: free,
right: locked })) {
      throw new Error(`Account snapshot total does not equal free plus locked for ${asset}`)
    }
    normalizedBalances.push(Object.freeze({ asset,
free,
locked,
total }))
  }
  if (new Set(normalizedBalances.map(({ asset }) => asset)).size !== normalizedBalances.length) {
    throw new Error("Account snapshot contains duplicate asset balances")
  }
  return normalizedBalances
}

function normalizeAuditReasons({ auditReasons }) {
  const normalizedReasons = []
  for (const [index, reason] of auditReasons.entries()) {
    normalizedReasons.push(requireString({ value: reason,
field: `auditReasons[${index}]` }))
  }
  return normalizedReasons
}

function validateAccountSnapshotMetadata({ data, fileName, session }) {
  if (!["PREFLIGHT", "OPENING", "RECOVERY", "CLOSING", "COMMISSION_BASELINE"].includes(data.phase)) {
    throw new TypeError("Account snapshot phase is invalid")
  }
  if (data.phase === "RECOVERY" && !session.started) {
    throw new Error(`RECOVERY account snapshot requires a started Journal session ${fileName}`)
  }
  if (data.phase === "PREFLIGHT" && (session.started || session.hasTradingActivity)) {
    throw new Error(`PREFLIGHT account snapshot must precede trading activity in Journal session ${fileName}`)
  }
  if (!["COMPLETE", "INCOMPLETE"].includes(data.auditStatus)) {
    throw new TypeError("Account snapshot auditStatus is invalid")
  }
  if (!Number.isSafeInteger(data.sourceTime) || data.sourceTime < 0) {
    throw new TypeError("Account snapshot sourceTime must be a non-negative safe integer")
  }
  if (
    session.lastAccountSnapshotSourceTime !== undefined &&
    data.sourceTime < session.lastAccountSnapshotSourceTime
  ) {
    throw new Error(`Account snapshot sourceTime moved backwards within Journal session ${fileName}`)
  }
  session.lastAccountSnapshotSourceTime = data.sourceTime
  if (!Array.isArray(data.balances) || !Array.isArray(data.auditReasons)) {
    throw new TypeError("Account snapshot balances and auditReasons must be arrays")
  }
}

function validateAccountSnapshotAuditStatus({ auditStatus, auditReasons }) {
  if (auditStatus === "COMPLETE" && auditReasons.length > 0) {
    throw new Error("COMPLETE account snapshot cannot contain audit reasons")
  }
  if (auditStatus === "INCOMPLETE" && auditReasons.length === 0) {
    throw new Error("INCOMPLETE account snapshot requires audit reasons")
  }
}

function handleAccountSnapshotEvent({ data, fileName, sequence, session, state }) {
  validateAccountSnapshotMetadata({ data,
fileName,
session })
  const balances = normalizeAccountBalances({ balances: data.balances })
  const auditReasons = normalizeAuditReasons({ auditReasons: data.auditReasons })
  validateAccountSnapshotAuditStatus({ auditStatus: data.auditStatus,
auditReasons })
  state.accountSnapshots.push(Object.freeze({
    fileName,
    sequence,
    phase: data.phase,
    sourceTime: data.sourceTime,
    auditStatus: data.auditStatus,
    balances: Object.freeze(balances),
    auditReasons: Object.freeze(auditReasons),
  }))

  if (data.phase === "CLOSING") {
    if (!session.started || !session.tradingEnabled) {
      throw new Error("Closing account snapshot requires a started trading-enabled session")
    }
    session.closingSnapshotCount += 1
    if (session.closingSnapshotCount > 1) {
      throw new Error("Journal session contains multiple closing account snapshots")
    }
    session.hasCompleteClosingSnapshot = data.auditStatus === "COMPLETE" && auditReasons.length === 0
  }
}

function normalizeOpenOrder({ order, index }) {
  const brokerOrderId = requireString({
    value: order?.brokerOrderId,
    field: `orders[${index}].brokerOrderId`,
  })
  const symbol = requireString({ value: order?.symbol,
field: `orders[${index}].symbol` })
  if (!ORDER_SIDES.has(order?.side)) {
    throw new TypeError(`orders[${index}].side must be BUY or SELL`)
  }
  const type = requireString({ value: order?.type,
field: `orders[${index}].type` })
  const quantity = requireDecimal({
    value: order?.quantity,
    field: `orders[${index}].quantity`,
    positive: true,
  })
  const executedQuantity = requireDecimal({
    value: order?.executedQuantity,
    field: `orders[${index}].executedQuantity`,
  })
  const price = order?.price === undefined
    ? undefined
    : requireDecimal({ value: order.price,
field: `orders[${index}].price`,
positive: true })
  if (compareDecimal({ left: executedQuantity,
right: quantity }) > 0) {
    throw new Error("Open-order snapshot executed quantity exceeds original quantity")
  }
  return Object.freeze({
    ...(order?.clientOrderId === undefined ? {} : {
      clientOrderId: requireString({
        value: order.clientOrderId,
        field: `orders[${index}].clientOrderId`,
      }),
    }),
    brokerOrderId,
    symbol,
    side: order.side,
    type,
    ...(price === undefined ? {} : { price }),
    quantity,
    executedQuantity,
    status: requireString({ value: order.status,
field: `orders[${index}].status` }),
  })
}

function normalizeOpenOrderSnapshotOrders({ orders }) {
  const normalizedOrders = []
  for (const [index, order] of orders.entries()) {
    normalizedOrders.push(normalizeOpenOrder({ order,
index }))
  }
  const identities = normalizedOrders.map(({ symbol, brokerOrderId }) => `${symbol}:${brokerOrderId}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error("Open-order snapshot contains duplicate order identities")
  }
  return normalizedOrders
}

function normalizeOpenOrderBlockReasons({ blockReasons }) {
  const normalizedReasons = []
  for (const [index, reason] of blockReasons.entries()) {
    normalizedReasons.push(requireString({ value: reason,
field: `blockReasons[${index}]` }))
  }
  return normalizedReasons
}

function assertReconciledOpenOrderMatchesOwnership({ order, state }) {
  if (order.status !== "NEW" && order.status !== "PARTIALLY_FILLED") {
    throw new Error("RECONCILED open-order snapshot contains a non-active order")
  }
  if (typeof order.clientOrderId !== "string") {
    throw new Error("RECONCILED open-order snapshot order is missing clientOrderId")
  }
  const owned = state.ordersByClientId.get(order.clientOrderId)
  if (
    !owned ||
    owned.brokerOrderId !== order.brokerOrderId ||
    owned.symbol !== order.symbol ||
    owned.side !== order.side ||
    owned.type !== order.type ||
    compareDecimal({ left: owned.quantity,
right: order.quantity }) !== 0 ||
    compareDecimal({ left: owned.cumulativeFillQuantity,
right: order.executedQuantity }) !== 0 ||
    (owned.price === undefined
      ? order.price !== undefined
      : order.price === undefined || compareDecimal({ left: owned.price,
right: order.price }) !== 0)
  ) {
    throw new Error(`RECONCILED open-order snapshot contradicts durable Harvester ownership for ${order.clientOrderId}`)
  }
}

function validateOpenOrderSnapshotReadiness({ readiness, orders, blockReasons }) {
  if (readiness === "READY" && (orders.length > 0 || blockReasons.length > 0)) {
    throw new Error("READY open-order snapshot requires no orders and no block reasons")
  }
  if (readiness === "RECONCILED" && (orders.length === 0 || blockReasons.length > 0)) {
    throw new Error("RECONCILED open-order snapshot requires owned orders and no block reasons")
  }
  if (readiness === "BLOCKED" && blockReasons.length === 0) {
    throw new Error("BLOCKED open-order snapshot must contain block reasons")
  }
}

function validateOpenOrderSnapshotMetadata({ data, fileName, session }) {
  if (!["OPENING", "PREFLIGHT", "RECOVERY"].includes(data.phase)) {
    throw new TypeError("Open-order snapshot phase is invalid")
  }
  if (data.phase === "RECOVERY" && !session.started) {
    throw new Error(`RECOVERY open-order snapshot requires a started Journal session ${fileName}`)
  }
  if (data.phase === "PREFLIGHT" && (session.started || session.hasTradingActivity)) {
    throw new Error(`PREFLIGHT open-order snapshot must precede trading activity in Journal session ${fileName}`)
  }
  if (!Number.isSafeInteger(data.observedAt) || data.observedAt < 0) {
    throw new TypeError("Open-order snapshot observedAt must be a non-negative safe integer")
  }
  if (session.lastOpenOrdersObservedAt !== undefined && data.observedAt < session.lastOpenOrdersObservedAt) {
    throw new Error(`Open-order snapshot observedAt moved backwards within Journal session ${fileName}`)
  }
  session.lastOpenOrdersObservedAt = data.observedAt
  if (!["READY", "RECONCILED", "BLOCKED"].includes(data.readiness)) {
    throw new TypeError("Open-order snapshot readiness is invalid")
  }
  if (!Array.isArray(data.orders) || !Array.isArray(data.blockReasons)) {
    throw new TypeError("Open-order snapshot orders and blockReasons must be arrays")
  }
  if (data.orderCount !== data.orders.length) {
    throw new Error("Open-order snapshot orderCount does not match orders")
  }
}

function handleOpenOrderSnapshotEvent({ data, fileName, session, state }) {
  validateOpenOrderSnapshotMetadata({ data,
fileName,
session })
  const orders = normalizeOpenOrderSnapshotOrders({ orders: data.orders })
  const blockReasons = normalizeOpenOrderBlockReasons({ blockReasons: data.blockReasons })
  validateOpenOrderSnapshotReadiness({ readiness: data.readiness,
orders,
blockReasons })
  if (data.readiness === "RECONCILED") {
    for (const order of orders) {
      assertReconciledOpenOrderMatchesOwnership({ order,
state })
    }
  }
  state.openOrderSnapshots.push(Object.freeze({
    fileName,
    phase: data.phase,
    observedAt: data.observedAt,
    readiness: data.readiness,
    orders: Object.freeze(orders),
    blockReasons: Object.freeze(blockReasons),
  }))
}

function handleSubmissionRequestedEvent({ data, sequence, state }) {
  const intent = requireOrderIntent({ data })
  if (data.status !== "PENDING") {
    throw new Error("Submission intent must record PENDING status")
  }
  const existing = state.ordersByClientId.get(intent.clientOrderId)
  if (existing) {
    assertSameIntent({ current: existing,
next: intent })
    if (existing.submissionRequested) {
      return
    }
    throw new Error(`Conflicting duplicate submission intent for ${intent.clientOrderId}`)
  }
  const unresolvedCancellation = [...state.ordersByClientId.values()].find((order) =>
    order.symbol === intent.symbol && ["REQUESTED", "UNKNOWN"].includes(order.cancellationState)
  )
  if (unresolvedCancellation) {
    throw new Error(`New order submission is journaled while a prior cancellation remains UNKNOWN for ${intent.symbol}`)
  }
  state.ordersByClientId.set(intent.clientOrderId, {
    ...intent,
    submissionSequence: sequence,
    brokerOrderId: undefined,
    submissionRequested: true,
    submissionOutcome: "PENDING",
    exchangeStatusHint: "PENDING",
    cancellationState: "NONE",
    cancellationExecutedQuantity: undefined,
    cumulativeFillQuantity: "0",
    fillIds: [],
    requiresExchangeReconciliation: true,
  })
}

function handleSubmittedEvent({ data, name, state }) {
  const intent = requireOrderIntent({ data })
  const order = requireProjectedOrder({
    state,
    clientOrderId: intent.clientOrderId,
    eventName: name,
  })
  assertSameIntent({ current: order,
next: intent })
  const brokerOrderId = requireString({ value: data.brokerOrderId,
field: "brokerOrderId" })
  const status = requireString({ value: data.status,
field: "status" })
  const existingOwner = state.clientIdByBrokerId.get(brokerOrderId)
  if (existingOwner && existingOwner !== order.clientOrderId) {
    throw new Error(`Broker order ID is assigned to multiple Harvester client order IDs: ${brokerOrderId}`)
  }
  if (order.brokerOrderId !== undefined && order.brokerOrderId !== brokerOrderId) {
    throw new Error(`Journal acknowledgement changed brokerOrderId for ${order.clientOrderId}`)
  }
  if (order.submissionOutcome === "REJECTED") {
    throw new Error(`Rejected submission later received an acknowledgement for ${order.clientOrderId}`)
  }
  order.brokerOrderId = brokerOrderId
  order.submissionOutcome = "ACKNOWLEDGED"
  order.exchangeStatusHint = status
  order.recoveryStatus = "UNKNOWN"
  order.requiresExchangeReconciliation = true
  state.clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
}

function handleSubmissionFailedEvent({ data, name, state }) {
  const clientOrderId = requireString({ value: data.clientOrderId,
field: "clientOrderId" })
  const order = requireProjectedOrder({ state,
clientOrderId,
eventName: name })
  const intent = requireOrderIntent({
    data: { ...data,
price: order.price,
quantity: order.quantity,
type: order.type },
  })
  assertSameIntent({ current: order,
next: intent })
  if (!SUBMISSION_OUTCOMES.has(data.outcome)) {
    throw new TypeError("Invalid order submission outcome")
  }
  if (order.brokerOrderId !== undefined && data.outcome === "REJECTED") {
    throw new Error("Acknowledged order cannot later have a definite submission rejection")
  }
  order.submissionOutcome = data.outcome
  order.recoveryStatus = data.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN"
  order.exchangeStatusHint = data.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN"
  order.requiresExchangeReconciliation = data.outcome !== "REJECTED"
}

function assertJournalOrderFieldsMatch({ data, order, fields, message }) {
  if (fields.some((field) => data[field] !== order[field])) {
    throw new Error(message)
  }
}

function handleCancelRequestedEvent({ data, name, sequence, state }) {
  const clientOrderId = requireString({ value: data.clientOrderId,
field: "clientOrderId" })
  const order = requireProjectedOrder({ state,
clientOrderId,
eventName: name })
  if (order.submissionOutcome === "REJECTED") {
    throw new Error(`Cancellation intent references a definitively rejected submission: ${clientOrderId}`)
  }
  if (order.cancellationState !== "NONE") {
    throw new Error(`Cancellation intent cannot be retried or duplicated before prior cancellation resolution: ${clientOrderId}`)
  }
  const brokerOrderId = requireString({ value: data.brokerOrderId,
field: "brokerOrderId" })
  if (order.brokerOrderId === undefined) {
    const existingOwner = state.clientIdByBrokerId.get(brokerOrderId)
    if (existingOwner && existingOwner !== order.clientOrderId) {
      throw new Error("Cancellation intent brokerOrderId is already owned by another clientOrderId")
    }
    order.brokerOrderId = brokerOrderId
    order.submissionOutcome = "ACKNOWLEDGED"
    order.exchangeStatusHint = "UNKNOWN"
    order.recoveryStatus = "UNKNOWN"
    state.clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
  } else if (order.brokerOrderId !== brokerOrderId) {
    throw new Error("Cancellation intent brokerOrderId conflicts with submission acknowledgement")
  }
  assertJournalOrderFieldsMatch({
    data,
    order,
    fields: ["providerInstanceId", "providerType", "accountId", "symbol", "side", "type", "price", "quantity"],
    message: "Cancellation intent changed immutable order facts",
  })
  if (!["OPEN", "PARTIALLY_FILLED"].includes(data.status)) {
    throw new Error("Cancellation intent must record an active order status")
  }
  const executedQuantity = requireDecimal({ value: data.executedQuantity,
field: "executedQuantity" })
  if (compareDecimal({ left: executedQuantity,
right: order.quantity }) > 0) {
    throw new Error("Cancellation intent executed quantity exceeds original order quantity")
  }
  if (compareDecimal({ left: executedQuantity,
right: order.cumulativeFillQuantity }) < 0) {
    throw new Error("Cancellation intent executed quantity is behind journaled fills")
  }
  order.cancellationState = "REQUESTED"
  order.cancellationReason = requireString({ value: data.reason,
field: "cancellation reason" })
  order.cancellationSequence = sequence
  order.cancellationExecutedQuantity = executedQuantity
  order.requiresExchangeReconciliation = true
}

function handleCancelledEvent({ data, name, sequence, state }) {
  const clientOrderId = requireString({ value: data.clientOrderId,
field: "clientOrderId" })
  const order = requireProjectedOrder({ state,
clientOrderId,
eventName: name })
  if (order.cancellationState !== "REQUESTED") {
    throw new Error("Confirmed cancellation has no preceding durable cancellation intent")
  }
  assertJournalOrderFieldsMatch({
    data,
    order,
    fields: ["providerInstanceId", "providerType", "accountId", "brokerOrderId", "symbol", "side", "type", "price", "quantity"],
    message: "Confirmed cancellation conflicts with the owned order identity",
  })
  if (data.status !== "CANCELED") {
    throw new Error("Confirmed cancellation conflicts with the owned order identity")
  }
  const executedQuantity = requireDecimal({ value: data.executedQuantity,
field: "executedQuantity" })
  if (compareDecimal({ left: executedQuantity,
right: order.quantity }) > 0) {
    throw new Error("Confirmed cancellation executed quantity exceeds original order quantity")
  }
  if (compareDecimal({ left: executedQuantity,
right: order.cumulativeFillQuantity }) < 0) {
    throw new Error("Confirmed cancellation executed quantity is behind journaled fills")
  }
  order.cancellationState = "CANCELED"
  order.cancellationSequence = sequence
  order.cancellationExecutedQuantity = executedQuantity
  order.exchangeStatusHint = "CANCELED"
  order.recoveryStatus = "UNKNOWN"
  order.requiresExchangeReconciliation = true
}

function handleCancelFailedEvent({ data, name, sequence, state }) {
  const clientOrderId = requireString({ value: data.clientOrderId,
field: "clientOrderId" })
  const order = requireProjectedOrder({ state,
clientOrderId,
eventName: name })
  if (order.submissionOutcome === "REJECTED") {
    throw new Error(`Cancellation failure references a definitively rejected submission: ${clientOrderId}`)
  }
  if (order.cancellationState !== "REQUESTED") {
    throw new Error(`Cancellation failure has no preceding durable cancellation intent: ${clientOrderId}`)
  }
  if (!CANCEL_OUTCOMES.has(data.outcome)) {
    throw new TypeError("Invalid order cancellation outcome")
  }
  assertJournalOrderFieldsMatch({
    data,
    order,
    fields: ["providerInstanceId", "providerType", "accountId", "symbol", "side"],
    message: "Cancellation failure conflicts with the owned order identity",
  })
  if (data.brokerOrderId !== undefined) {
    const brokerOrderId = requireString({ value: data.brokerOrderId,
field: "brokerOrderId" })
    if (order.brokerOrderId === undefined) {
      const existingOwner = state.clientIdByBrokerId.get(brokerOrderId)
      if (existingOwner && existingOwner !== order.clientOrderId) {
        throw new Error("Cancellation failure brokerOrderId is already owned by another clientOrderId")
      }
      order.brokerOrderId = brokerOrderId
      order.submissionOutcome = "ACKNOWLEDGED"
      order.exchangeStatusHint = "UNKNOWN"
      state.clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
    } else if (order.brokerOrderId !== brokerOrderId) {
      throw new Error("Cancellation failure changed brokerOrderId")
    }
  }
  order.cancellationState = "UNKNOWN"
  order.cancellationSequence = sequence
  order.recoveryStatus = "UNKNOWN"
  order.requiresExchangeReconciliation = true
}

function resolveFillOrder({ fill, state }) {
  const clientOrderId = fill.clientOrderId ?? state.clientIdByBrokerId.get(fill.brokerOrderId)
  if (!clientOrderId) {
    throw new Error(`Applied fill cannot be assigned to a journaled Harvester order: ${fill.fillId}`)
  }
  const order = requireProjectedOrder({
    state,
    clientOrderId,
    eventName: EVENT.FILL_APPLIED,
  })
  if (fill.providerInstanceId !== undefined) {
    assertJournalOrderFieldsMatch({
      data: fill,
      order,
      fields: ["providerInstanceId", "providerType", "accountId"],
      message: "Applied fill provider provenance conflicts with its journaled order",
    })
  }
  if (order.submissionOutcome === "REJECTED") {
    throw new Error(`Applied fill references a definitively rejected submission: ${fill.fillId}`)
  }
  if (order.brokerOrderId === undefined) {
    const existingOwner = state.clientIdByBrokerId.get(fill.brokerOrderId)
    if (existingOwner && existingOwner !== order.clientOrderId) {
      throw new Error("Applied fill brokerOrderId is already owned by another clientOrderId")
    }
    order.brokerOrderId = fill.brokerOrderId
    order.submissionOutcome = "ACKNOWLEDGED"
    order.exchangeStatusHint = "UNKNOWN"
    order.recoveryStatus = "UNKNOWN"
    state.clientIdByBrokerId.set(fill.brokerOrderId, order.clientOrderId)
  }
  if (order.brokerOrderId !== fill.brokerOrderId || order.symbol !== fill.symbol || order.side !== fill.side) {
    throw new Error(`Applied fill identity conflicts with its journaled order: ${fill.fillId}`)
  }
  if (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId) {
    throw new Error("Applied fill clientOrderId conflicts with its journaled order")
  }
  return order
}

function assertUniqueAppliedFill({ fill, fingerprint, state }) {
  const existing = state.fillsById.get(fill.fillId)
  if (existing) {
    if (existing.fingerprint !== fingerprint || fill.duplicate !== true) {
      throw new Error(`Duplicate execution ID has conflicting or unmarked replay facts: ${fill.fillId}`)
    }
    return false
  }
  if (fill.duplicate === true) {
    throw new Error(`Duplicate fill marker has no original execution record: ${fill.fillId}`)
  }
  return true
}

function applyFillToProjection({ fill, fingerprint, order, sequence, state }) {
  const tradeKey = `${fill.symbol}:${fill.tradeId}`
  const existingTrade = state.tradeIdBySymbol.get(tradeKey)
  if (existingTrade && existingTrade !== fill.fillId) {
    throw new Error(`Exchange trade ID maps to multiple execution IDs: ${tradeKey}`)
  }
  const cumulativeFillQuantity = addDecimal({
    left: order.cumulativeFillQuantity,
    right: fill.quantity,
  })
  if (compareDecimal({ left: cumulativeFillQuantity,
right: order.quantity }) > 0) {
    throw new Error(`Journaled fills exceed original order quantity for ${order.clientOrderId}`)
  }
  order.cumulativeFillQuantity = cumulativeFillQuantity
  order.fillIds.push(fill.fillId)
  order.requiresExchangeReconciliation = true
  state.fillsById.set(fill.fillId, { fill,
fingerprint,
sequence })
  state.tradeIdBySymbol.set(tradeKey, fill.fillId)
  if (order.side === "BUY") {
    order.lastBuyFillSequence = sequence
  }
  if (order.side === "SELL" && compareDecimal({
    left: cumulativeFillQuantity,
    right: order.quantity,
  }) === 0) {
    const previousFullyFilledSell = state.lastFullyFilledSellBySymbol.get(order.symbol)
    if (previousFullyFilledSell && previousFullyFilledSell.outcome !== "CONTINUE_SELL_THROUGH") {
      throw new Error(`Multiple fully filled Harvester SELL orders require an explicit continue-sell-through outcome for ${order.symbol}`)
    }
    state.lastFullyFilledSellBySymbol.set(order.symbol, {
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      sequence,
    })
  }
}

function handleFillAppliedEvent({ data, sequence, state }) {
  const fill = requireFill({ data })
  const order = resolveFillOrder({ fill,
state })
  const fingerprint = fillFingerprint({ fill })
  if (!assertUniqueAppliedFill({ fill,
fingerprint,
state })) {
    return
  }
  applyFillToProjection({ fill,
fingerprint,
order,
sequence,
state })
}

function handleRecoveryCompletedEvent({ data, sequence, state }) {
  const symbol = requireString({ value: data.symbol,
field: "symbol" })
  const marketId = requireString({ value: data.marketId,
field: "marketId" })
  const freeQuantity = requireDecimal({ value: data.freeQuantity,
field: "freeQuantity" })
  const keepQuantity = requireDecimal({ value: data.keepQuantity,
field: "keepQuantity" })
  const minProfit = requireDecimal({ value: data.minProfit,
field: "minProfit",
positive: true })
  const realizedNetProfit = requireDecimal({ value: data.realizedNetProfit,
field: "realizedNetProfit" })
  if (compareDecimal({ left: minProfit,
right: "0.01" }) < 0) {
    throw new RangeError("Recovery-cycle minProfit must be at least 0.01")
  }
  if (compareDecimal({ left: realizedNetProfit,
right: minProfit }) < 0) {
    throw new RangeError("Recovery-cycle realizedNetProfit does not meet minProfit")
  }
  const dust = requireRecoveryDust({ value: data.dust })
  const expectedFreeQuantity = addDecimal({ left: keepQuantity,
right: dust?.quantity ?? "0" })
  if (compareDecimal({ left: freeQuantity,
right: expectedFreeQuantity }) !== 0) {
    throw new Error("Recovery-cycle freeQuantity must equal keepQuantity plus validated dust")
  }
  const completedSellOrder = state.lastFullyFilledSellBySymbol.get(symbol)
  if (!completedSellOrder) {
    throw new Error(`Recovery-cycle completion has no preceding fully filled Harvester SELL order for ${symbol}`)
  }
  if (completedSellOrder.outcome === "BLOCKED") {
    throw new Error(`Recovery-cycle completion follows a blocked non-completion outcome for ${symbol}`)
  }
  state.cycles.push({
    symbol,
    marketId,
    freeQuantity,
    keepQuantity,
    minProfit,
    realizedNetProfit,
    ...(dust === undefined ? {} : { dust }),
    completedOrderClientId: completedSellOrder.clientOrderId,
    completedOrderBrokerOrderId: completedSellOrder.brokerOrderId,
    sequence,
  })
  state.lastFullyFilledSellBySymbol.delete(symbol)
}

function validateRecoveryCycleNonCompletionReason({
  outcome,
  reason,
  realizedNetProfit,
  activeQuantity,
  keepQuantity,
  minProfit,
}) {
  if (outcome === "CONTINUE_SELL_THROUGH") {
    if (!["RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY"].includes(reason)) {
      throw new Error("CONTINUE_SELL_THROUGH has an unsupported reason")
    }
    if (compareDecimal({ left: activeQuantity,
right: keepQuantity }) <= 0) {
      throw new Error("CONTINUE_SELL_THROUGH requires active inventory above keepQuantity")
    }
    if (
      reason === "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY" &&
      compareDecimal({ left: realizedNetProfit,
right: minProfit }) >= 0
    ) {
      throw new Error("Profit-target continuation requires realized profit below minProfit")
    }
    if (
      reason === "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH" &&
      compareDecimal({ left: realizedNetProfit,
right: minProfit }) < 0
    ) {
      throw new Error("Residual sell-through requires realized profit to meet minProfit")
    }
    return
  }
  if (["RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY"].includes(reason)) {
    throw new Error("BLOCKED cannot use a residual sell-through reason")
  }
  if (
    reason === "RECOVERY_SELL_FAILED_MIN_PROFIT" &&
    compareDecimal({ left: realizedNetProfit,
right: minProfit }) >= 0
  ) {
    throw new Error("RECOVERY_SELL_FAILED_MIN_PROFIT requires realized profit below minProfit")
  }
}

function mapRecoveryNonCompletionMetrics({ data }) {
  const reason = requireString({
    value: data.reason,
    field: "reason",
  })
  const realizedNetProfit = requireSignedDecimal({
    value: data.realizedNetProfit,
    field: "realizedNetProfit",
  })
  const activeQuantity = requireDecimal({
    value: data.activeQuantity,
    field: "activeQuantity",
  })
  const keepQuantity = requireDecimal({
    value: data.keepQuantity,
    field: "keepQuantity",
  })
  const minProfit = requireDecimal({
    value: data.minProfit,
    field: "minProfit",
    positive: true,
  })
  if (compareDecimal({
    left: minProfit,
    right: "0.01",
  }) < 0) {
    throw new RangeError("Recovery-cycle minProfit must be at least 0.01")
  }
  validateRecoveryCycleNonCompletionReason({
    outcome: data.outcome,
    reason,
    realizedNetProfit,
    activeQuantity,
    keepQuantity,
    minProfit,
  })
  return {
    reason,
    realizedNetProfit,
    activeQuantity,
    keepQuantity,
    minProfit,
  }
}

function resolveRecoveryNonCompletionDetails({ data }) {
  if (!["CONTINUE_SELL_THROUGH", "BLOCKED"].includes(data.outcome)) {
    throw new TypeError("Recovery-cycle non-completion outcome is invalid")
  }
  const metrics = mapRecoveryNonCompletionMetrics({ data })
  return {
    symbol: requireString({
      value: data.symbol,
      field: "symbol",
    }),
    marketId: requireString({
      value: data.marketId,
      field: "marketId",
    }),
    sellOrderClientId: requireString({
      value: data.sellOrderClientId,
      field: "sellOrderClientId",
    }),
    sellOrderBrokerOrderId: requireString({
      value: data.sellOrderBrokerOrderId,
      field: "sellOrderBrokerOrderId",
    }),
    outcome: data.outcome,
    ...metrics,
  }
}

function handleRecoveryNotCompletedEvent({ data, sequence, state }) {
  const details = resolveRecoveryNonCompletionDetails({ data })
  const pendingSell = state.lastFullyFilledSellBySymbol.get(details.symbol)
  if (
    !pendingSell ||
    pendingSell.clientOrderId !== details.sellOrderClientId ||
    pendingSell.brokerOrderId !== details.sellOrderBrokerOrderId
  ) {
    throw new Error(`Recovery-cycle non-completion does not match the latest fully filled SELL order for ${details.symbol}`)
  }
  if (pendingSell.outcome === "BLOCKED") {
    throw new Error(`Recovery-cycle SELL already has a terminal BLOCKED outcome for ${details.symbol}`)
  }
  state.recoveryCycleEvaluations.push(Object.freeze({
    ...details,
    sequence,
  }))
  pendingSell.outcome = details.outcome
}

function handleStrategyPausedEvent({ data, state }) {
  const symbol = requireString({ value: data.symbol,
field: "symbol" })
  const reason = requireString({ value: data.reason,
field: "reason" })
  state.pausedMarkets.set(symbol, reason)
}

function handleExecutionSafetyEvent({ data, name, sequence, state }) {
  const symbol = requireString({ value: data.symbol,
field: `${name} symbol` })
  const reason = requireString({
    value: data.reason ?? data.error?.message ?? data.error?.code ?? name,
    field: `${name} reason`,
  })
  state.stickySafetyBlockers.push(Object.freeze({
    eventName: name,
    symbol,
    reason,
    ...(data.clientOrderId === undefined ? {} : {
      clientOrderId: requireString({
        value: data.clientOrderId,
        field: `${name} clientOrderId`,
      }),
    }),
    ...(data.brokerOrderId === undefined ? {} : {
      brokerOrderId: requireString({
        value: data.brokerOrderId,
        field: `${name} brokerOrderId`,
      }),
    }),
    ...(data.fillId === undefined ? {} : {
      fillId: requireString({ value: data.fillId,
field: `${name} fillId` }),
    }),
    sequence,
  }))
}

const JOURNAL_EVENT_HANDLERS = Object.freeze({
  [EVENT.ACCOUNT_SNAPSHOT]: handleAccountSnapshotEvent,
  [EVENT.ACCOUNT_OPEN_ORDERS]: handleOpenOrderSnapshotEvent,
  [EVENT.SUBMISSION_REQUESTED]: handleSubmissionRequestedEvent,
  [EVENT.SUBMITTED]: handleSubmittedEvent,
  [EVENT.SUBMISSION_FAILED]: handleSubmissionFailedEvent,
  [EVENT.CANCEL_REQUESTED]: handleCancelRequestedEvent,
  [EVENT.CANCELLED]: handleCancelledEvent,
  [EVENT.CANCEL_FAILED]: handleCancelFailedEvent,
  [EVENT.FILL_APPLIED]: handleFillAppliedEvent,
  [EVENT.RECOVERY_COMPLETED]: handleRecoveryCompletedEvent,
  [EVENT.RECOVERY_NOT_COMPLETED]: handleRecoveryNotCompletedEvent,
  [EVENT.STRATEGY_PAUSED]: handleStrategyPausedEvent,
  [EVENT.EXECUTION_UNOWNED_ORDER]: handleExecutionSafetyEvent,
  [EVENT.EXECUTION_INVALID_FILL]: handleExecutionSafetyEvent,
  [EVENT.EXECUTION_ACCOUNTING_FAILED]: handleExecutionSafetyEvent,
})

function processJournalRecoveryRecord({ record, sequence, state }) {
  const payload = requireObject({ value: record?.payload,
field: "Journal record payload" })
  const { name } = payload
  if (typeof name !== "string") {
    throw new TypeError("Journal event name must be a string")
  }
  if (!Object.values(EVENT).includes(name)) {
    if (
      (payload.source === "harvester" || payload.source === undefined) &&
      !IGNORABLE_HARVESTER_EVENTS.has(name)
    ) {
      throw new Error(`unknown Harvester recovery event: ${name}`)
    }
    return
  }

  const data = requireObject({ value: payload.data,
field: `${name} data` })
  const { fileName: recordFileName } = record.position ?? {}
  const fileName = requireString({
    value: recordFileName,
    field: "Journal record position.fileName",
  })
  const session = getOrCreateProjectionSession({ state,
fileName })
  if (session.stoppedOutcome !== undefined) {
    throw new Error("Journal session contains recognized events after harvester.stopped")
  }
  if (handleSessionLifecycleEvent({ name,
data,
session })) {
    return
  }
  if (session.closingSnapshotCount > 0) {
    throw new Error("Journal session contains recognized events after its closing account snapshot")
  }
  if (TRADING_ACTIVITY_EVENTS.has(name)) {
    session.hasTradingActivity = true
  }
  const handler = JOURNAL_EVENT_HANDLERS[name]
  if (handler) {
    handler({ data,
name,
fileName,
sequence,
session,
state })
    return
  }
  if (SAFETY_BLOCKER_EVENTS.has(name)) {
    handleExecutionSafetyEvent({ data,
name,
sequence,
state })
  }
}

function assertFullyFilledSellOutcomesResolved({ state }) {
  for (const [symbol, pendingSell] of state.lastFullyFilledSellBySymbol) {
    if (pendingSell.outcome === undefined) {
      throw new Error(`fully filled SELL has no explicit recovery-cycle outcome for ${symbol}`)
    }
  }
}

function createJournalRecoveryProjectionData({ state }) {
  const sessions = [...state.sessionsByFile.values()].map((session) => Object.freeze({
    ...session,
    uncleanTradingShutdown: (session.tradingEnabled || session.hasTradingActivity) && (
      !session.tradingEnabled ||
      session.stoppedOutcome !== "success" ||
      !session.hasCompleteClosingSnapshot
    ),
  }))
  const orders = [...state.ordersByClientId.values()].map((order) => Object.freeze({
    ...order,
    fillIds: Object.freeze([...order.fillIds]),
    requiresFillHistoryReconciliation: order.cancellationExecutedQuantity !== undefined &&
      compareDecimal({
        left: order.cancellationExecutedQuantity,
        right: order.cumulativeFillQuantity,
      }) !== 0,
  }))
  const fills = [...state.fillsById.values()].map(({ fill, sequence }) => Object.freeze({
    ...fill,
    sequence,
    commissions: Object.freeze(fill.commissions.map((commission) => Object.freeze({ ...commission }))),
  }))
  const recoveryCycles = state.cycles.map((cycle) => Object.freeze({ ...cycle }))
  const pausedMarkets = [...state.pausedMarkets].map(([symbol, reason]) => Object.freeze({ symbol,
reason }))
  const requiresExchangeReconciliation = orders.some((order) => order.requiresExchangeReconciliation) ||
    fills.length > 0 || recoveryCycles.length > 0 ||
    sessions.some((session) => session.tradingEnabled || session.uncleanTradingShutdown)

  return Object.freeze({
    orders: Object.freeze(orders),
    fills: Object.freeze(fills),
    recoveryCycles: Object.freeze(recoveryCycles),
    recoveryCycleEvaluations: Object.freeze(state.recoveryCycleEvaluations),
    pausedMarkets: Object.freeze(pausedMarkets),
    stickySafetyBlockers: Object.freeze(state.stickySafetyBlockers),
    sessions: Object.freeze(sessions),
    accountSnapshots: Object.freeze(state.accountSnapshots),
    openOrderSnapshots: Object.freeze(state.openOrderSnapshots),
    requiresExchangeReconciliation,
  })
}

/**
 * Build a strict, immutable replay projection from validated Journal records.
 * This does not open the trading gate: every projected order still requires
 * canonical exchange reconciliation before it can be restored as actionable.
 */
export function projectHarvesterJournalRecovery({ records } = {}) {
  try {
    if (!Array.isArray(records)) {
      throw new TypeError("Harvester Journal recovery records must be an array")
    }
    const state = createProjectionState()
    for (const [sequence, record] of records.entries()) {
      processJournalRecoveryRecord({ record,
sequence,
state })
    }
    assertFullyFilledSellOutcomesResolved({ state })
    return toResult({ data: createJournalRecoveryProjectionData({ state }) })
  } catch (error) {
    return toResult({ error })
  }
}
