import { compareDecimal } from "./helpers/decimal.js"

const LEDGER_FIELDS = Object.freeze([
  "id",
  "orderId",
  "symbol",
  "side",
  "price",
  "quantity",
  "quoteQuantity",
  "commissionAmount",
  "commissionAsset",
  "isMaker",
])

function failure(reason) {
  return { ok: false, reason }
}

function nullableString(value) {
  return value === undefined || value === null ? null : String(value)
}

// Snapshot only immutable execution facts and stable source identifiers.
// All financial values are retained as decimal strings.
export function createFillLedgerEntry({ fill } = {}) {
  if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
    return failure("Fill ledger entry requires a fill object")
  }

  const id = String(fill.id ?? "")
  const orderId = String(fill.orderId ?? "")
  if (
    !id ||
    id === "-1" ||
    id === "undefined" ||
    !orderId ||
    orderId === "undefined"
  ) {
    return failure("Fill ledger entry requires stable trade and order IDs")
  }

  const commissionAmount = nullableString(fill.commissionAmount)
  let commissionAsset = nullableString(fill.commissionAsset)
  if (commissionAmount !== null) {
    try {
      if (compareDecimal({ left: commissionAmount, right: "0" }) === 0) {
        commissionAsset = null
      }
    } catch {
      // Preserve malformed reported facts; the accounting transition fails closed.
    }
  }

  return {
    ok: true,
    entry: Object.freeze({
      id,
      orderId,
      symbol: nullableString(fill.symbol),
      side: nullableString(fill.side),
      price: nullableString(fill.price),
      quantity: nullableString(fill.quantity),
      quoteQuantity: nullableString(fill.quoteQuantity),
      commissionAmount,
      commissionAsset,
      isMaker: typeof fill.isMaker === "boolean" ? fill.isMaker : null,
    }),
  }
}

const IDENTITY_FIELDS = Object.freeze([
  "id",
  "orderId",
  "symbol",
  "side",
  "commissionAsset",
  "isMaker",
])
const DECIMAL_FIELDS = Object.freeze([
  "price",
  "quantity",
  "quoteQuantity",
  "commissionAmount",
])

function hasSameDecimalFact(left, right) {
  if (left === right) return true
  if (left === null || right === null) return false

  try {
    return compareDecimal({ left, right }) === 0
  } catch {
    return false
  }
}

function hasSameFillFacts(left, right) {
  const identityMatches = IDENTITY_FIELDS.every((field) => left?.[field] === right[field])
  return identityMatches &&
    DECIMAL_FIELDS.every((field) => hasSameDecimalFact(left[field], right[field]))
}

// Append without mutating prior entries. Repeated identical trade IDs are
// idempotent; the same ID with different facts is an accounting discrepancy.
export function appendFillLedgerEntry({ entries, fill } = {}) {
  if (!Array.isArray(entries)) {
    return failure("Fill ledger entries must be an array")
  }

  const created = createFillLedgerEntry({ fill })
  if (!created.ok) return created

  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    return failure("Fill ledger contains an invalid entry")
  }

  const allEntriesFrozen = entries.every((entry) => Object.isFrozen(entry))
  const currentEntries = Object.isFrozen(entries) && allEntriesFrozen
    ? entries
    : Object.freeze(entries.map((entry) =>
        Object.isFrozen(entry) ? entry : Object.freeze({ ...entry }),
      ))
  const existing = currentEntries.find((entry) => entry.id === created.entry.id)

  if (existing) {
    if (!hasSameFillFacts(existing, created.entry)) {
      return failure(`Conflicting facts for trade ${created.entry.id}`)
    }

    return { ok: true, duplicate: true, entries: currentEntries }
  }

  return {
    ok: true,
    duplicate: false,
    entry: created.entry,
    entries: Object.freeze([...currentEntries, created.entry]),
  }
}
