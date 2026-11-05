/**
 * Cancel all open Spot TESTNET orders, grouped by symbol, and verify the
 * account-wide result. The caller must explicitly invoke this destructive
 * operator workflow.
 *
 * @param {object} dependencies
 * @param {() => Promise<{ orders: object[] }>} dependencies.getOpenOrders
 * @param {(input: { symbol: string }) => Promise<{ result: unknown }>} dependencies.cancelOpenOrdersForSymbol
 * @param {{ info: Function, warn: Function, error: Function, success: Function }} dependencies.logger
 * @returns {Promise<{ exitCode: 0 | 1 }>}
 */
export const cancelAllOpenOrders = async ({
  getOpenOrders,
  cancelOpenOrdersForSymbol,
  logger,
}) => {
  const { orders } = await getOpenOrders()

  logger.info({
    message: "Binance Spot TESTNET — Cancel All Open Orders",
    orders: orders.map((order) => ({
      symbol: order.symbol,
      orderId: order.orderId,
      side: order.side,
      price: order.price,
      quantity: order.origQty,
      executed: order.executedQty,
      status: order.status,
    })),
  })

  if (orders.length === 0) {
    logger.info({ message: "No open orders found. Nothing to cancel." })
    return { exitCode: 0 }
  }

  const symbols = [...new Set(orders.map((order) => order.symbol))]

  logger.warn({
    message: "WARNING: This cancels every open order on every listed symbol.",
    orderCount: orders.length,
    symbols,
    warning: "Orders created manually or by other applications are included.",
    instruction: "Stop Harvester and any other trading process before continuing.",
  })
  logger.warn({
    message: "Proceeding automatically on Binance Spot TESTNET...",
  })

  let cancellationFailed = false

  for (const symbol of symbols) {
    try {
      const { result } = await cancelOpenOrdersForSymbol({ symbol })
      logger.info({
        message: `Cancellation requested for ${symbol}.`,
        symbol,
        exchangeResponse: result,
      })
    } catch (error) {
      cancellationFailed = true
      logger.error({
        message: `Cancellation failed for ${symbol}.`,
        symbol,
        error,
      })
    }
  }

  // Verify exchange state; a successful cancel response alone is not proof.
  const { orders: remainingOrders } = await getOpenOrders()

  logger.info({
    message: "Final TESTNET open-orders check",
    remainingOrders: remainingOrders.map((order) => ({
      symbol: order.symbol,
      orderId: order.orderId,
      side: order.side,
      quantity: order.origQty,
      executed: order.executedQty,
      status: order.status,
    })),
  })

  if (remainingOrders.length === 0) {
    logger.success({
      message: "SUCCESS: No open orders remain.",
    })
  } else {
    logger.warn({
      message: `Remaining open orders: ${remainingOrders.length}`,
      remainingOrders,
    })
  }

  if (cancellationFailed || remainingOrders.length > 0) {
    logger.error({
      message: "Cancellation was not fully verified.",
      cancellationFailed,
      remainingOrderCount: remainingOrders.length,
    })
    return { exitCode: 1 }
  }

  return { exitCode: 0 }
}
