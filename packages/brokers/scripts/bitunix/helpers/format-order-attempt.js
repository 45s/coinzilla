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

export function formatOrderMutationResult({ result }) {
  const outcome = result?.mutationOutcome ?? "UNREPORTED"
  const orderId = result?.data?.id
  const errorMessage = result?.errors?.[0]?.message
  return [
    `Broker result: ${result?.ok === true ? "success" : "not successful"}; mutation outcome: ${outcome}.`,
    ...(orderId ? [`Exchange order ID: ${orderId}`] : []),
    ...(errorMessage ? [`Broker message: ${errorMessage}`] : []),
    ...(outcome === "OUTCOME_UNKNOWN"
      ? ["WARNING: outcome is unknown. Do not retry; reconcile manually before any further action."]
      : []),
  ].join("\n")
}
