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
      commissionAmount: nullableString(fill.commissionAmount),
      commissionAsset: nullableString(fill.commissionAsset),
      isMaker: typeof fill.isMaker === "boolean" ? fill.isMaker : null,
    }),
  }
}

function hasSameFillFacts(left, right) {
  return LEDGER_FIELDS.every((field) => left?.[field] === right[field])
}

// Append without mutating prior entries. Repeated identical trade IDs are
// idempotent; the same ID with different facts is an accounting discrepancy.
export function appendFillLedgerEntry({ entries, fill } = {}) {
  if (!Array.isArray(entries)) {
    return failure("Fill ledger entries must be an array")
  }

  const created = createFillLedgerEntry({ fill })
  if (!created.ok) return created

  const currentEntries = Object.isFrozen(entries)
    ? entries
    : Object.freeze([...entries])
  const existing = currentEntries.find((entry) => entry?.id === created.entry.id)

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
