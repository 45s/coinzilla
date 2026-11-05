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
  STRATEGY_PAUSED: "strategy.paused",
})

const ORDER_SIDES = new Set(["BUY", "SELL"])
const SUBMISSION_OUTCOMES = new Set(["REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"])
const CANCEL_OUTCOMES = new Set(["ORDER_STATE_UNKNOWN", "UNCONFIRMED", "NOT_REGISTERED", "NOT_CANCELED"])

function requireObject({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(field + " must be an object")
  }
  return value
}

function requireString({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value.trim()
}

function requireDecimal({ value, field, positive = false }) {
  if (typeof value !== "string") throw new TypeError(field + " must be an exact decimal string")
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < (positive ? 1 : 0)) {
    throw new RangeError(field + (positive ? " must be positive" : " must be non-negative"))
  }
  return value
}

function requireOrderIntent({ data }) {
  const clientOrderId = requireString({ value: data.clientOrderId, field: "clientOrderId" })
  const symbol = requireString({ value: data.symbol, field: "symbol" })
  if (!ORDER_SIDES.has(data.side)) throw new TypeError("order side must be BUY or SELL")
  const type = requireString({ value: data.type, field: "type" })
  const price = requireDecimal({ value: data.price, field: "price", positive: true })
  const quantity = requireDecimal({ value: data.quantity, field: "quantity", positive: true })
  return { clientOrderId, symbol, side: data.side, type, price, quantity }
}

function assertSameIntent({ current, next }) {
  for (const field of ["clientOrderId", "symbol", "side", "type", "price", "quantity"]) {
    if (current[field] !== next[field]) {
      throw new Error("Journal order event changed immutable " + field + " for " + current.clientOrderId)
    }
  }
}

function requireFill({ data }) {
  const fillId = requireString({ value: data.fillId, field: "fillId" })
  const tradeId = requireString({ value: data.tradeId, field: "tradeId" })
  const brokerOrderId = requireString({ value: data.brokerOrderId, field: "brokerOrderId" })
  const clientOrderId = data.clientOrderId === undefined
    ? undefined
    : requireString({ value: data.clientOrderId, field: "clientOrderId" })
  const symbol = requireString({ value: data.symbol, field: "symbol" })
  if (!ORDER_SIDES.has(data.side)) throw new TypeError("fill side must be BUY or SELL")
  const price = requireDecimal({ value: data.price, field: "price", positive: true })
  const quantity = requireDecimal({ value: data.quantity, field: "quantity", positive: true })
  const quoteQuantity = requireDecimal({ value: data.quoteQuantity, field: "quoteQuantity", positive: true })
  const liquidityRole = requireString({ value: data.liquidityRole, field: "liquidityRole" })
  const commissionStatus = requireString({ value: data.commissionStatus, field: "commissionStatus" })
  if (!Array.isArray(data.commissions)) throw new TypeError("fill commissions must be an array")
  const commissions = data.commissions.map((commission, index) => ({
    amount: requireDecimal({ value: commission?.amount, field: "commissions[" + index + "].amount" }),
    assetId: requireString({ value: commission?.assetId, field: "commissions[" + index + "].assetId" }),
    asset: requireString({ value: commission?.asset, field: "commissions[" + index + "].asset" }),
  }))
  if (data.duplicate !== undefined && typeof data.duplicate !== "boolean") {
    throw new TypeError("fill duplicate marker must be a boolean")
  }
  return {
    fillId,
    tradeId,
    brokerOrderId,
    ...(clientOrderId === undefined ? {} : { clientOrderId }),
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
  const { duplicate, ...facts } = fill
  return JSON.stringify(facts)
}

/**
 * Build a strict, immutable replay projection from validated Journal records.
 * This does not open the trading gate: every projected order still requires
 * canonical exchange reconciliation before it can be restored as actionable.
 */
export function projectHarvesterJournalRecovery({ records } = {}) {
  try {
    if (!Array.isArray(records)) throw new TypeError("Harvester Journal recovery records must be an array")

    const ordersByClientId = new Map()
    const clientIdByBrokerId = new Map()
    const fillsById = new Map()
    const tradeIdBySymbol = new Map()
    const cycles = []
    const pausedMarkets = new Map()
    const sessionsByFile = new Map()
    const accountSnapshots = []
    const openOrderSnapshots = []
    const lastFullyFilledSellBySymbol = new Map()
    let journalSequence = 0

    const requireOrder = ({ clientOrderId, eventName }) => {
      const order = ordersByClientId.get(clientOrderId)
      if (!order) throw new Error(eventName + " references an unknown clientOrderId " + clientOrderId)
      return order
    }

    for (const record of records) {
      const currentSequence = journalSequence
      journalSequence += 1
      const payload = requireObject({ value: record?.payload, field: "Journal record payload" })
      const name = payload.name
      if (typeof name !== "string") throw new TypeError("Journal event name must be a string")
      if (!Object.values(EVENT).includes(name)) continue
      const data = requireObject({ value: payload.data, field: name + " data" })
      const fileName = requireString({
        value: record.position?.fileName,
        field: "Journal record position.fileName",
      })
      const session = sessionsByFile.get(fileName) ?? {
        fileName,
        started: false,
        tradingEnabled: false,
        hasTradingActivity: false,
        stoppedOutcome: undefined,
        hasCompleteClosingSnapshot: false,
        closingSnapshotCount: 0,
      }
      sessionsByFile.set(fileName, session)

      if (session.stoppedOutcome !== undefined) {
        throw new Error("Journal session contains recognized events after harvester.stopped")
      }

      if (name === EVENT.STARTED) {
        if (session.started) throw new Error("Journal session contains multiple started events")
        if (typeof data.tradingEnabled !== "boolean") throw new TypeError("harvester.started tradingEnabled must be boolean")
        session.started = true
        session.tradingEnabled = data.tradingEnabled
        continue
      }

      if (name === EVENT.STOPPED) {
        if (!session.started) throw new Error("harvester.stopped has no preceding harvester.started event")
        if (!["success", "failed"].includes(data.outcome)) throw new TypeError("harvester.stopped outcome must be success or failed")
        requireString({ value: data.reason, field: "harvester.stopped reason" })
        session.stoppedOutcome = data.outcome
        continue
      }

      if ([
        EVENT.SUBMISSION_REQUESTED,
        EVENT.SUBMITTED,
        EVENT.SUBMISSION_FAILED,
        EVENT.CANCEL_REQUESTED,
        EVENT.CANCELLED,
        EVENT.CANCEL_FAILED,
        EVENT.FILL_APPLIED,
        EVENT.RECOVERY_COMPLETED,
        EVENT.STRATEGY_PAUSED,
      ].includes(name)) {
        session.hasTradingActivity = true
      }

      if (name === EVENT.ACCOUNT_SNAPSHOT) {
        if (!["PREFLIGHT", "OPENING", "CLOSING"].includes(data.phase)) throw new TypeError("Account snapshot phase is invalid")
        if (!["COMPLETE", "INCOMPLETE"].includes(data.auditStatus)) throw new TypeError("Account snapshot auditStatus is invalid")
        if (!Number.isSafeInteger(data.sourceTime) || data.sourceTime < 0) throw new TypeError("Account snapshot sourceTime must be a non-negative safe integer")
        if (!Array.isArray(data.balances) || !Array.isArray(data.auditReasons)) throw new TypeError("Account snapshot balances and auditReasons must be arrays")
        const balances = data.balances.map((balance, index) => {
          const asset = requireString({ value: balance?.asset, field: "balances[" + index + "].asset" })
          const free = requireDecimal({ value: balance?.free, field: "balances[" + index + "].free" })
          const locked = requireDecimal({ value: balance?.locked, field: "balances[" + index + "].locked" })
          const total = requireDecimal({ value: balance?.total, field: "balances[" + index + "].total" })
          if (total !== addDecimal({ left: free, right: locked })) {
            throw new Error("Account snapshot total does not equal free plus locked for " + asset)
          }
          return Object.freeze({ asset, free, locked, total })
        })
        if (new Set(balances.map(({ asset }) => asset)).size !== balances.length) {
          throw new Error("Account snapshot contains duplicate asset balances")
        }
        const auditReasons = data.auditReasons.map((reason, index) =>
          requireString({ value: reason, field: "auditReasons[" + index + "]" }),
        )
        if (data.auditStatus === "COMPLETE" && auditReasons.length > 0) {
          throw new Error("COMPLETE account snapshot cannot contain audit reasons")
        }
        if (data.auditStatus === "INCOMPLETE" && auditReasons.length === 0) {
          throw new Error("INCOMPLETE account snapshot requires audit reasons")
        }
        const snapshot = Object.freeze({
          fileName,
          phase: data.phase,
          sourceTime: data.sourceTime,
          auditStatus: data.auditStatus,
          balances: Object.freeze(balances),
          auditReasons: Object.freeze(auditReasons),
        })
        accountSnapshots.push(snapshot)
        if (data.phase === "CLOSING") {
          session.closingSnapshotCount += 1
          if (session.closingSnapshotCount > 1) throw new Error("Journal session contains multiple closing account snapshots")
          session.hasCompleteClosingSnapshot = data.auditStatus === "COMPLETE" && auditReasons.length === 0
        }
        continue
      }

      if (name === EVENT.ACCOUNT_OPEN_ORDERS) {
        if (!["OPENING", "PREFLIGHT"].includes(data.phase)) throw new TypeError("Open-order snapshot phase is invalid")
        if (!Number.isSafeInteger(data.observedAt) || data.observedAt < 0) throw new TypeError("Open-order snapshot observedAt must be a non-negative safe integer")
        if (!["READY", "RECONCILED", "BLOCKED"].includes(data.readiness)) throw new TypeError("Open-order snapshot readiness is invalid")
        if (!Array.isArray(data.orders) || !Array.isArray(data.blockReasons)) throw new TypeError("Open-order snapshot orders and blockReasons must be arrays")
        if (data.orderCount !== data.orders.length) throw new Error("Open-order snapshot orderCount does not match orders")
        const orders = data.orders.map((order, index) => {
          const brokerOrderId = requireString({ value: order?.brokerOrderId, field: "orders[" + index + "].brokerOrderId" })
          const symbol = requireString({ value: order?.symbol, field: "orders[" + index + "].symbol" })
          if (!ORDER_SIDES.has(order?.side)) throw new TypeError("orders[" + index + "].side must be BUY or SELL")
          const type = requireString({ value: order?.type, field: "orders[" + index + "].type" })
          const quantity = requireDecimal({ value: order?.quantity, field: "orders[" + index + "].quantity", positive: true })
          const executedQuantity = requireDecimal({ value: order?.executedQuantity, field: "orders[" + index + "].executedQuantity" })
          const price = order?.price === undefined ? undefined : requireDecimal({ value: order.price, field: "orders[" + index + "].price", positive: true })
          if (compareDecimal({ left: executedQuantity, right: quantity }) > 0) throw new Error("Open-order snapshot executed quantity exceeds original quantity")
          return Object.freeze({
            ...(order?.clientOrderId === undefined ? {} : { clientOrderId: requireString({ value: order.clientOrderId, field: "orders[" + index + "].clientOrderId" }) }),
            brokerOrderId,
            symbol,
            side: order.side,
            type,
            ...(price === undefined ? {} : { price }),
            quantity,
            executedQuantity,
            status: requireString({ value: order.status, field: "orders[" + index + "].status" }),
          })
        })
        const identities = orders.map(({ symbol, brokerOrderId }) => symbol + ":" + brokerOrderId)
        if (new Set(identities).size !== identities.length) throw new Error("Open-order snapshot contains duplicate order identities")
        const blockReasons = data.blockReasons.map((reason, index) =>
          requireString({ value: reason, field: "blockReasons[" + index + "]" }),
        )
        if (data.readiness === "READY" && (orders.length > 0 || blockReasons.length > 0)) {
          throw new Error("READY open-order snapshot requires no orders and no block reasons")
        }
        if (data.readiness === "RECONCILED" && (orders.length === 0 || blockReasons.length > 0)) {
          throw new Error("RECONCILED open-order snapshot requires owned orders and no block reasons")
        }
        if (data.readiness === "BLOCKED" && blockReasons.length === 0) {
          throw new Error("BLOCKED open-order snapshot must contain block reasons")
        }
        openOrderSnapshots.push(Object.freeze({
          fileName,
          phase: data.phase,
          observedAt: data.observedAt,
          readiness: data.readiness,
          orders: Object.freeze(orders),
          blockReasons: Object.freeze(blockReasons),
        }))
        continue
      }

      if (name === EVENT.SUBMISSION_REQUESTED) {
        const intent = requireOrderIntent({ data })
        if (data.status !== "PENDING") throw new Error("Submission intent must record PENDING status")
        const existing = ordersByClientId.get(intent.clientOrderId)
        if (existing) {
          assertSameIntent({ current: existing, next: intent })
          if (existing.submissionRequested) continue
          throw new Error("Conflicting duplicate submission intent for " + intent.clientOrderId)
        }
        const unresolvedCancellation = [...ordersByClientId.values()].find((order) =>
          order.symbol === intent.symbol && ["REQUESTED", "UNKNOWN"].includes(order.cancellationState)
        )
        if (unresolvedCancellation) {
          throw new Error("New order submission is journaled while a prior cancellation remains UNKNOWN for " + intent.symbol)
        }
        ordersByClientId.set(intent.clientOrderId, {
          ...intent,
          submissionSequence: currentSequence,
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
        continue
      }

      if (name === EVENT.SUBMITTED) {
        const intent = requireOrderIntent({ data })
        const order = requireOrder({ clientOrderId: intent.clientOrderId, eventName: name })
        assertSameIntent({ current: order, next: intent })
        const brokerOrderId = requireString({ value: data.brokerOrderId, field: "brokerOrderId" })
        const status = requireString({ value: data.status, field: "status" })
        const existingOwner = clientIdByBrokerId.get(brokerOrderId)
        if (existingOwner && existingOwner !== order.clientOrderId) {
          throw new Error("Broker order ID is assigned to multiple Harvester client order IDs: " + brokerOrderId)
        }
        if (order.brokerOrderId !== undefined && order.brokerOrderId !== brokerOrderId) {
          throw new Error("Journal acknowledgement changed brokerOrderId for " + order.clientOrderId)
        }
        if (order.submissionOutcome === "REJECTED") {
          throw new Error("Rejected submission later received an acknowledgement for " + order.clientOrderId)
        }
        order.brokerOrderId = brokerOrderId
        order.submissionOutcome = "ACKNOWLEDGED"
        order.exchangeStatusHint = status
        order.recoveryStatus = "UNKNOWN"
        order.requiresExchangeReconciliation = true
        clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
        continue
      }

      if (name === EVENT.SUBMISSION_FAILED) {
        const clientOrderId = requireString({ value: data.clientOrderId, field: "clientOrderId" })
        const order = requireOrder({ clientOrderId, eventName: name })
        const intent = requireOrderIntent({ data: { ...data, price: order.price, quantity: order.quantity, type: order.type } })
        assertSameIntent({ current: order, next: intent })
        if (!SUBMISSION_OUTCOMES.has(data.outcome)) throw new TypeError("Invalid order submission outcome")
        if (order.brokerOrderId !== undefined && data.outcome === "REJECTED") {
          throw new Error("Acknowledged order cannot later have a definite submission rejection")
        }
        order.submissionOutcome = data.outcome
        order.recoveryStatus = data.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN"
        order.exchangeStatusHint = data.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN"
        order.requiresExchangeReconciliation = data.outcome !== "REJECTED"
        continue
      }

      if (name === EVENT.CANCEL_REQUESTED) {
        const clientOrderId = requireString({ value: data.clientOrderId, field: "clientOrderId" })
        const order = requireOrder({ clientOrderId, eventName: name })
        const brokerOrderId = requireString({ value: data.brokerOrderId, field: "brokerOrderId" })
        if (order.brokerOrderId === undefined) {
          const existingOwner = clientIdByBrokerId.get(brokerOrderId)
          if (existingOwner && existingOwner !== order.clientOrderId) {
            throw new Error("Cancellation intent brokerOrderId is already owned by another clientOrderId")
          }
          // A durable cancellation intent also proves the submission was
          // acknowledged when the separate acknowledgement event was lost.
          order.brokerOrderId = brokerOrderId
          order.submissionOutcome = "ACKNOWLEDGED"
          order.exchangeStatusHint = "UNKNOWN"
          order.recoveryStatus = "UNKNOWN"
          clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
        } else if (order.brokerOrderId !== brokerOrderId) {
          throw new Error("Cancellation intent brokerOrderId conflicts with submission acknowledgement")
        }
        if (data.symbol !== order.symbol || data.side !== order.side || data.type !== order.type ||
            data.price !== order.price || data.quantity !== order.quantity) {
          throw new Error("Cancellation intent changed immutable order facts")
        }
        if (!["OPEN", "PARTIALLY_FILLED"].includes(data.status)) {
          throw new Error("Cancellation intent must record an active order status")
        }
        const executedQuantity = requireDecimal({ value: data.executedQuantity, field: "executedQuantity" })
        if (compareDecimal({ left: executedQuantity, right: order.quantity }) > 0) {
          throw new Error("Cancellation intent executed quantity exceeds original order quantity")
        }
        if (compareDecimal({ left: executedQuantity, right: order.cumulativeFillQuantity }) < 0) {
          throw new Error("Cancellation intent executed quantity is behind journaled fills")
        }
        order.cancellationState = "REQUESTED"
        order.cancellationReason = requireString({ value: data.reason, field: "cancellation reason" })
        order.cancellationSequence = currentSequence
        order.cancellationExecutedQuantity = executedQuantity
        order.requiresExchangeReconciliation = true
        continue
      }

      if (name === EVENT.CANCELLED) {
        const clientOrderId = requireString({ value: data.clientOrderId, field: "clientOrderId" })
        const order = requireOrder({ clientOrderId, eventName: name })
        if (order.cancellationState !== "REQUESTED") {
          throw new Error("Confirmed cancellation has no preceding durable cancellation intent")
        }
        if (data.brokerOrderId !== order.brokerOrderId || data.symbol !== order.symbol ||
            data.side !== order.side || data.type !== order.type ||
            data.price !== order.price || data.quantity !== order.quantity || data.status !== "CANCELED") {
          throw new Error("Confirmed cancellation conflicts with the owned order identity")
        }
        const executedQuantity = requireDecimal({ value: data.executedQuantity, field: "executedQuantity" })
        if (compareDecimal({ left: executedQuantity, right: order.quantity }) > 0) {
          throw new Error("Confirmed cancellation executed quantity exceeds original order quantity")
        }
        if (compareDecimal({ left: executedQuantity, right: order.cumulativeFillQuantity }) < 0) {
          throw new Error("Confirmed cancellation executed quantity is behind journaled fills")
        }
        order.cancellationState = "CANCELED"
        order.cancellationSequence = currentSequence
        order.cancellationExecutedQuantity = executedQuantity
        order.exchangeStatusHint = "CANCELED"
        order.recoveryStatus = "UNKNOWN"
        order.requiresExchangeReconciliation = true
        continue
      }

      if (name === EVENT.CANCEL_FAILED) {
        const clientOrderId = requireString({ value: data.clientOrderId, field: "clientOrderId" })
        const order = requireOrder({ clientOrderId, eventName: name })
        if (!CANCEL_OUTCOMES.has(data.outcome)) throw new TypeError("Invalid order cancellation outcome")
        if (data.symbol !== order.symbol || data.side !== order.side) {
          throw new Error("Cancellation failure conflicts with the owned order identity")
        }
        if (data.brokerOrderId !== undefined) {
          const brokerOrderId = requireString({ value: data.brokerOrderId, field: "brokerOrderId" })
          if (order.brokerOrderId === undefined) {
            const existingOwner = clientIdByBrokerId.get(brokerOrderId)
            if (existingOwner && existingOwner !== order.clientOrderId) {
              throw new Error("Cancellation failure brokerOrderId is already owned by another clientOrderId")
            }
            order.brokerOrderId = brokerOrderId
            order.submissionOutcome = "ACKNOWLEDGED"
            order.exchangeStatusHint = "UNKNOWN"
            clientIdByBrokerId.set(brokerOrderId, order.clientOrderId)
          } else if (order.brokerOrderId !== brokerOrderId) {
            throw new Error("Cancellation failure changed brokerOrderId")
          }
        }
        order.cancellationState = "UNKNOWN"
        order.cancellationSequence = currentSequence
        order.recoveryStatus = "UNKNOWN"
        order.requiresExchangeReconciliation = true
        continue
      }

      if (name === EVENT.FILL_APPLIED) {
        const fill = requireFill({ data })
        const clientOrderId = fill.clientOrderId ?? clientIdByBrokerId.get(fill.brokerOrderId)
        if (!clientOrderId) throw new Error("Applied fill cannot be assigned to a journaled Harvester order: " + fill.fillId)
        const order = requireOrder({ clientOrderId, eventName: name })
        if (order.submissionOutcome === "REJECTED") {
          throw new Error("Applied fill references a definitively rejected submission: " + fill.fillId)
        }
        if (order.brokerOrderId === undefined) {
          const existingOwner = clientIdByBrokerId.get(fill.brokerOrderId)
          if (existingOwner && existingOwner !== order.clientOrderId) {
            throw new Error("Applied fill brokerOrderId is already owned by another clientOrderId")
          }
          // A fill can reach the Journal before the broker acknowledgement event
          // is durable. The fill's clientOrderId and brokerOrderId then provide
          // the only durable evidence that the submission was accepted.
          order.brokerOrderId = fill.brokerOrderId
          order.submissionOutcome = "ACKNOWLEDGED"
          order.exchangeStatusHint = "UNKNOWN"
          order.recoveryStatus = "UNKNOWN"
          clientIdByBrokerId.set(fill.brokerOrderId, order.clientOrderId)
        }
        if (order.brokerOrderId !== fill.brokerOrderId || order.symbol !== fill.symbol || order.side !== fill.side) {
          throw new Error("Applied fill identity conflicts with its journaled order: " + fill.fillId)
        }
        if (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId) {
          throw new Error("Applied fill clientOrderId conflicts with its journaled order")
        }
        const fingerprint = fillFingerprint({ fill })
        const existing = fillsById.get(fill.fillId)
        if (existing) {
          if (existing.fingerprint !== fingerprint || fill.duplicate !== true) {
            throw new Error("Duplicate execution ID has conflicting or unmarked replay facts: " + fill.fillId)
          }
          continue
        }
        if (fill.duplicate === true) {
          throw new Error("Duplicate fill marker has no original execution record: " + fill.fillId)
        }
        const tradeKey = fill.symbol + ":" + fill.tradeId
        const existingTrade = tradeIdBySymbol.get(tradeKey)
        if (existingTrade && existingTrade !== fill.fillId) {
          throw new Error("Exchange trade ID maps to multiple execution IDs: " + tradeKey)
        }
        const cumulativeFillQuantity = addDecimal({
          left: order.cumulativeFillQuantity,
          right: fill.quantity,
        })
        if (compareDecimal({ left: cumulativeFillQuantity, right: order.quantity }) > 0) {
          throw new Error("Journaled fills exceed original order quantity for " + order.clientOrderId)
        }
        order.cumulativeFillQuantity = cumulativeFillQuantity
        order.fillIds.push(fill.fillId)
        order.requiresExchangeReconciliation = true
        fillsById.set(fill.fillId, { fill, fingerprint, sequence: currentSequence })
        tradeIdBySymbol.set(tradeKey, fill.fillId)
        if (order.side === "BUY") {
          order.lastBuyFillSequence = currentSequence
        }
        if (order.side === "SELL" && compareDecimal({
          left: cumulativeFillQuantity,
          right: order.quantity,
        }) === 0) {
          lastFullyFilledSellBySymbol.set(order.symbol, {
            clientOrderId: order.clientOrderId,
            brokerOrderId: order.brokerOrderId,
            sequence: currentSequence,
          })
        }
        continue
      }

      if (name === EVENT.RECOVERY_COMPLETED) {
        const symbol = requireString({ value: data.symbol, field: "symbol" })
        const marketId = requireString({ value: data.marketId, field: "marketId" })
        const freeQuantity = requireDecimal({ value: data.freeQuantity, field: "freeQuantity", positive: true })
        const realizedNetProfit = requireDecimal({ value: data.realizedNetProfit, field: "realizedNetProfit" })
        const completedSellOrder = lastFullyFilledSellBySymbol.get(symbol)
        if (!completedSellOrder) {
          throw new Error("Recovery-cycle completion has no preceding fully filled Harvester SELL order for " + symbol)
        }
        cycles.push({
          symbol,
          marketId,
          freeQuantity,
          realizedNetProfit,
          completedOrderClientId: completedSellOrder.clientOrderId,
          completedOrderBrokerOrderId: completedSellOrder.brokerOrderId,
          sequence: currentSequence,
        })
        lastFullyFilledSellBySymbol.delete(symbol)
        continue
      }

      if (name === EVENT.STRATEGY_PAUSED) {
        const symbol = requireString({ value: data.symbol, field: "symbol" })
        const reason = requireString({ value: data.reason, field: "reason" })
        pausedMarkets.set(symbol, reason)
      }
    }

    const sessions = [...sessionsByFile.values()].map((session) => Object.freeze({
      ...session,
      uncleanTradingShutdown: (session.tradingEnabled || session.hasTradingActivity) && (
        !session.tradingEnabled ||
        session.stoppedOutcome !== "success" ||
        !session.hasCompleteClosingSnapshot
      ),
    }))
    const orders = [...ordersByClientId.values()].map((order) => Object.freeze({
      ...order,
      fillIds: Object.freeze([...order.fillIds]),
      requiresFillHistoryReconciliation: order.cancellationExecutedQuantity !== undefined &&
        compareDecimal({
          left: order.cancellationExecutedQuantity,
          right: order.cumulativeFillQuantity,
        }) !== 0,
    }))
    const fills = [...fillsById.values()].map(({ fill, sequence }) => Object.freeze({
      ...fill,
      sequence,
      commissions: Object.freeze(fill.commissions.map((commission) => Object.freeze({ ...commission }))),
    }))
    return toResult({
      data: Object.freeze({
        orders: Object.freeze(orders),
        fills: Object.freeze(fills),
        recoveryCycles: Object.freeze(cycles.map((cycle) => Object.freeze({ ...cycle }))),
        pausedMarkets: Object.freeze([...pausedMarkets].map(([symbol, reason]) => Object.freeze({ symbol, reason }))),
        sessions: Object.freeze(sessions),
        accountSnapshots: Object.freeze(accountSnapshots),
        openOrderSnapshots: Object.freeze(openOrderSnapshots),
        requiresExchangeReconciliation: orders.some((order) => order.requiresExchangeReconciliation) ||
          fills.length > 0 || cycles.length > 0 || pausedMarkets.size > 0 ||
          sessions.some((session) => session.tradingEnabled || session.uncleanTradingShutdown),
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
