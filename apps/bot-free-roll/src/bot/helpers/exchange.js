export function getOrderId(order) {
  const id = order?.id ?? order?.orderId ?? order?.orderID
  return id == null ? null : String(id)
}

export function unwrapResult(result, operation) {
  if (!result || result.ok === false || result.error || result.errors?.length) {
    throw new AggregateError(
      result?.errors ?? [result?.error ?? new Error(`${operation}: failed`)],
      `${operation} failed`,
    )
  }

  if (!Object.hasOwn(result, "data")) {
    throw new Error(`${operation}: response has no data`)
  }

  return result.data
}
