import { compareDecimal } from "@coinzilla/utils"
import { OrderHistoryIntegrityError } from "./order-history-errors.js"

const STATUS_PRIORITY = Object.freeze({
  PENDING: 0,
  OPEN: 1,
  PARTIALLY_FILLED: 2,
  UNKNOWN: 3,
  CANCELED: 4,
  EXPIRED: 4,
  REJECTED: 4,
  FILLED: 5,
})

function integrityError({ field, current } = {}) {
  throw new OrderHistoryIntegrityError({
    field,
    providerInstanceId: current.providerInstanceId,
    accountId: current.accountId,
    clientOrderId: current.clientOrderId,
  })
}

function assertEqualField({ current, candidate, field } = {}) {
  if (current[field] !== candidate[field]) {
    integrityError({
      field,
      current,
    })
  }
}

function assertOptionalEqualField({ current, candidate, field } = {}) {
  if (
    current[field] !== undefined &&
    candidate[field] !== undefined &&
    current[field] !== candidate[field]
  ) {
    integrityError({
      field,
      current,
    })
  }
}

function assertImmutableOrderFacts({ current, candidate } = {}) {
  for (const field of [
    "environment",
    "providerInstanceId",
    "providerType",
    "accountId",
    "clientOrderId",
    "symbol",
    "side",
    "type",
    "originalQuantity",
  ]) {
    assertEqualField({
      current,
      candidate,
      field,
    })
  }
  if (JSON.stringify(current.market) !== JSON.stringify(candidate.market)) {
    integrityError({
      field: "market",
      current,
    })
  }
  assertOptionalEqualField({
    current,
    candidate,
    field: "price",
  })
  assertOptionalEqualField({
    current,
    candidate,
    field: "brokerOrderId",
  })
  assertOptionalEqualField({
    current,
    candidate,
    field: "createdAt",
  })
  assertOptionalEqualField({
    current,
    candidate,
    field: "acknowledgedAt",
  })
  if (
    current.ownership !== undefined &&
    candidate.ownership !== undefined &&
    JSON.stringify(current.ownership) !== JSON.stringify(candidate.ownership)
  ) {
    integrityError({
      field: "ownership",
      current,
    })
  }
}

function isStaleOrderHistoryUpdate({ current, candidate } = {}) {
  const executionComparison = compareDecimal({
    left: candidate.executedQuantity,
    right: current.executedQuantity,
  })
  if (executionComparison < 0) {
    return true
  }
  if (
    current.status === "FILLED" &&
    candidate.status !== "FILLED" &&
    executionComparison === 0
  ) {
    return true
  }
  const currentEventTime = Date.parse(current.lastSourceEventTimestamp)
  const candidateEventTime = Date.parse(candidate.lastSourceEventTimestamp)
  if (executionComparison === 0 && candidateEventTime < currentEventTime) {
    return true
  }
  return executionComparison === 0 &&
    candidateEventTime === currentEventTime &&
    (STATUS_PRIORITY[candidate.status] ?? 0) < (STATUS_PRIORITY[current.status] ?? 0)
}

function isDuplicateSourceEvent({ current, candidate } = {}) {
  if (current.lastSourceEventId !== candidate.lastSourceEventId) {
    return false
  }
  if (
    current.executedQuantity !== candidate.executedQuantity ||
    current.status !== candidate.status
  ) {
    integrityError({
      field: "sourceEventId",
      current,
    })
  }
  return true
}

function preserveCumulativeQuoteQuantity({ current, candidate, merged } = {}) {
  if (
    current.cumulativeQuoteQuantity === undefined ||
    candidate.cumulativeQuoteQuantity === undefined
  ) {
    return
  }
  const comparison = compareDecimal({
    left: candidate.cumulativeQuoteQuantity,
    right: current.cumulativeQuoteQuantity,
  })
  if (comparison < 0) {
    merged.cumulativeQuoteQuantity = current.cumulativeQuoteQuantity
  }
}

function createMergedOrderHistoryRecord({ current, candidate } = {}) {
  const merged = {
    ...current,
    ...candidate,
    brokerOrderId: candidate.brokerOrderId ?? current.brokerOrderId,
    ownership: candidate.ownership ?? current.ownership,
    createdAt: current.createdAt ?? candidate.createdAt,
    acknowledgedAt: current.acknowledgedAt ?? candidate.acknowledgedAt,
    firstSeenAt: current.firstSeenAt,
    firstSourceEventId: current.firstSourceEventId,
    lastSeenAt: candidate.lastSeenAt > current.lastSeenAt
      ? candidate.lastSeenAt
      : current.lastSeenAt,
  }
  preserveCumulativeQuoteQuantity({
    current,
    candidate,
    merged,
  })
  return Object.freeze(merged)
}

/**
 * Merge a newer canonical order snapshot without allowing stale events to regress it.
 *
 * @param {{current: object, candidate: object}} input
 * @returns {object} The current record or a new merged snapshot.
 * @throws {OrderHistoryIntegrityError} When immutable identity or order facts conflict.
 */
export function mergeOrderHistoryRecords({ current, candidate } = {}) {
  if (!current || !candidate || typeof current !== "object" || typeof candidate !== "object") {
    throw new TypeError("current and candidate must be order-history records")
  }
  assertEqualField({
    current,
    candidate,
    field: "id",
  })
  assertImmutableOrderFacts({
    current,
    candidate,
  })
  if (isDuplicateSourceEvent({ current, candidate })) {
    return current
  }
  if (isStaleOrderHistoryUpdate({ current, candidate })) {
    return current
  }
  return createMergedOrderHistoryRecord({
    current,
    candidate,
  })
}
