/**
 * Map a broker order request to Binance order.place parameters.
 *
 * @param {{input: Record<string, unknown>, clientOrderId?: string, requireClientOrderId?: boolean}} options
 * @returns {Record<string, unknown>} Binance request parameters with normalized defaults.
 */
export function adaptOrderRequestParams({
  input,
  clientOrderId = input.clientOrderId,
  requireClientOrderId = false,
}) {
  const orderInput = { ...input }
  delete orderInput.clientOrderId
  const { quoteQuantity } = orderInput
  delete orderInput.quoteQuantity
  if (quoteQuantity !== undefined) {
    if (input.type !== "MARKET") {
      throw new TypeError("Binance quoteQuantity is only supported for MARKET orders")
    }
    if (input.quantity !== undefined) {
      throw new TypeError("Cannot specify both quantity and quoteQuantity for a MARKET order")
    }
    if (input.quoteOrderQty !== undefined) {
      throw new TypeError("Specify either quoteQuantity or quoteOrderQty, not both")
    }
    orderInput.quoteOrderQty = quoteQuantity
  }
  const params = {
    ...orderInput,
    ...(requireClientOrderId || clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    side: input.side ?? "BUY",
    type: input.type ?? "LIMIT",
  }

  if (params.type === "LIMIT_MAKER") {
    delete params.timeInForce
  } else {
    params.timeInForce = input.timeInForce ?? "GTC"
  }

  return params
}
