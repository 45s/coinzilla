export function formatOrderPreflightSummary({ preflight }) {
  const { order } = preflight
  return [
    "BITUNIX SPOT — LIVE OPERATOR ORDER ATTEMPT",
    "Provider: Bitunix Spot",
    "Endpoint: https://openapi.bitunix.com (LIVE)",
    `Order: ${order.side} ${order.type} ${order.symbol}`,
    `Limit price: ${order.price} USDT`,
    `Base quantity: ${order.quantity} HYPE`,
    `Order notional: ${order.notional} USDT`,
    `Exchange minimum quantity (minVolume): ${preflight.minimumQuantity} HYPE`,
    `Exchange minimum notional (minPrice): ${preflight.minimumNotional} USDT`,
    `Provisional local notional floor: ${preflight.provisionalNotionalFloor} USDT (not an exchange guarantee)`,
    `USDT balance: free ${preflight.freeQuoteBalance}; locked ${preflight.lockedQuoteBalance}`,
    `HYPEUSDT open orders returned by the symbol-scoped query: ${preflight.openOrderCount}`,
    "Open-order response completeness is not established; an empty result is not proof of account-wide absence.",
    "Price tick and quantity step remain UNKNOWN; the exchange may reject the submitted price or quantity.",
    "The balance is a point-in-time response without an authoritative source timestamp and may change before dispatch.",
    "Bonuses, transfers, other assets, account settings, or exchange behavior may still affect acceptance.",
    "This balance observation does NOT guarantee an insufficient-balance rejection.",
    "A successful or rejected LIVE response is one observation, not a production-readiness guarantee.",
    "If accepted, the 30 USDT limit may be marketable and could fill immediately at the live ask.",
    "Exactly one placement call will be made. No retry, cancel, transfer, or second mutation will follow.",
  ].join("\n")
}

function formatErrorMetadata(error) {
  if (!error || typeof error !== "object") {
    return []
  }
  return [
    ...(error.code !== undefined ? [`Broker error code: ${String(error.code)}`] : []),
    ...(error.exchangeCode !== undefined ? [`Bitunix exchange code: ${String(error.exchangeCode)}`] : []),
    ...(error.status !== undefined ? [`HTTP status: ${String(error.status)}`] : []),
    ...(error.kind !== undefined ? [`Error kind: ${String(error.kind)}`] : []),
  ]
}

export function formatOrderMutationResult({ result }) {
  const outcome = result?.mutationOutcome ?? "UNREPORTED"
  const orderId = result?.data?.id
  const error = result?.errors?.[0]
  const errorMessage = error?.message
  return [
    `Broker result: ${result?.ok === true ? "success" : "not successful"}; mutation outcome: ${outcome}.`,
    ...(orderId ? [`Exchange order ID: ${orderId}`] : []),
    ...formatErrorMetadata(error),
    ...(errorMessage ? [`Broker message: ${errorMessage}`] : []),
    ...(outcome === "OUTCOME_UNKNOWN"
      ? ["WARNING: outcome is unknown. Do not retry; reconcile manually before any further action."]
      : []),
  ].join("\n")
}

export function formatOrderMutationError({ error }) {
  return [
    "Broker call threw instead of returning a placement result.",
    ...formatErrorMetadata(error),
    ...(error?.message ? [`Broker message: ${error.message}`] : []),
    "Mutation outcome: OUTCOME_UNKNOWN. Do not retry; reconcile manually before any further action.",
  ].join("\n")
}
