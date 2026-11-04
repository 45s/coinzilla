export function adaptOrderRequestParams({
  input,
  clientOrderId = input.clientOrderId,
  requireClientOrderId = false,
}) {
  const { clientOrderId: ignoredClientOrderId, ...orderInput } = input
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
