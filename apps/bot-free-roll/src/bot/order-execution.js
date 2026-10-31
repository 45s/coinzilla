import {
  calculateSellPlanExact,
  compareDecimal,
  getOrderId,
  maxDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
  unwrapResult,
} from "./helpers/index.js"

// Side-effect boundary for order lifecycle operations.
// Strategy decisions and pair state ownership remain in FreeRollBot.
export function createOrderExecution({
  broker,
  isRunning,
  minProfit,
  publish,
  debug,
  pause,
  reconcileOrderFills,
  handleSellFilled,
}) {
  async function placeBuy({ symbol, state, rawPrice }) {
    if (!isRunning() || state.paused || state.buyOrder) return

    const price = roundDecimalToIncrement({
      value: String(rawPrice),
      increment: String(state.priceTickSize ?? 0),
      direction: "down",
    })
    const quantity = roundDecimalToIncrement({
      value: String(state.settings.orderQuantity),
      increment: String(state.quantityStepSize ?? 0),
      direction: "down",
    })

    if (compareDecimal({ left: quantity, right: "0" }) <= 0) {
      pause(symbol, "BUY quantity is below the exchange quantity step")
      return
    }

    debug(`[${symbol}] Submitting BUY`, { price, quantity })

    try {
      const order = unwrapResult(
        await broker.createOrder({
          symbol,
          side: "BUY",
          type: state.orderType,
          ...(state.orderType === "LIMIT" ? { timeInForce: "GTC" } : {}),
          quantity,
          price: String(price),
        }),
        `create BUY ${symbol}`,
      )
      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: BUY response missing order ID`)

      state.trackedOrderIds.add(id)
      state.buyOrder = { id, side: "BUY", quantity, price: String(price) }
      state.lastAdjustmentPrice = Number(
        (price / (1 - state.settings.priceStepPercent / 100)).toFixed(
          state.settings.pricePrecision,
        ),
      )

      publish("order.created", {
        orderId: id,
        symbol,
        side: "BUY",
        type: state.orderType,
        price,
        quantity,
      })
      debug(`[${symbol}] BUY submitted`, {
        orderId: id,
        price,
        quantity,
        response: order,
      })
    } catch (error) {
      publish("order.create_failed", {
        symbol,
        side: "BUY",
        error: error?.message ?? String(error),
      })
      pause(symbol, "BUY submission failed", error)
    }
  }

  async function replaceTrailingBuy({ symbol, state, price }) {
    const order = state.buyOrder
    if (!isRunning() || !order || state.paused) return

    state.cancelingOrderIds.add(order.id)
    debug(`[${symbol}] Canceling BUY before trailing replacement`, {
      orderId: order.id,
      oldPrice: order.price,
      marketPrice: price,
    })

    try {
      const canceled = unwrapResult(
        await broker.cancelOrder({ symbol, orderId: order.id }),
        `cancel BUY ${symbol} ${order.id}`,
      )
      const remaining =
        canceled?.originalQuantity !== undefined &&
        canceled?.executedQuantity !== undefined
          ? subtractDecimal({
              left: String(canceled.originalQuantity),
              right: String(canceled.executedQuantity),
            })
          : String(canceled?.quantity)
      const status = String(canceled?.status ?? "").toUpperCase()

      if (
        status === "FILLED" ||
        compareDecimal({ left: remaining, right: "0" }) < 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) > 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) < 0
      ) {
        await reconcileOrderFills({ symbol, order })
        state.cancelingOrderIds.delete(order.id)
        pause(
          symbol,
          `BUY ${order.id} may have filled during trailing cancellation; reconciled actual fills and paused before replacing`,
        )
        return
      }

      state.buyOrder = null
      state.cancelingOrderIds.delete(order.id)
      publish("order.cancelled", {
        orderId: order.id,
        symbol,
        side: "BUY",
        remainingQuantity: remaining,
        filledQuantity: 0,
        reason: "trailing_replacement",
      })

      const replacementPrice =
        price * (1 - state.settings.priceStepPercent / 100)
      debug(`[${symbol}] Replacing trailing BUY`, {
        previousOrderId: order.id,
        marketPrice: price,
        replacementPrice,
        priceStepPercent: state.settings.priceStepPercent,
      })

      state.referencePrice = price
      state.highestPrice = price
      await placeBuy({ symbol, state, rawPrice: replacementPrice })
    } catch (error) {
      state.cancelingOrderIds.delete(order.id)
      publish("order.cancel_failed", {
        orderId: order.id,
        symbol,
        side: "BUY",
        error: error?.message ?? String(error),
      })
      pause(symbol, `Could not safely replace BUY ${order.id}`, error)
    }
  }

  async function cancelSell({ symbol, state }) {
    const order = state.sellOrder
    if (!order) return true

    state.cancelingOrderIds.add(order.id)
    debug(`[${symbol}] Canceling old SELL`, order)

    try {
      const canceled = unwrapResult(
        await broker.cancelOrder({ symbol, orderId: order.id }),
        `cancel SELL ${symbol} ${order.id}`,
      )
      const remaining =
        canceled?.originalQuantity !== undefined &&
        canceled?.executedQuantity !== undefined
          ? subtractDecimal({
              left: String(canceled.originalQuantity),
              right: String(canceled.executedQuantity),
            })
          : String(canceled?.quantity)

      if (
        compareDecimal({ left: remaining, right: "0" }) < 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) > 0
      ) {
        throw new Error("Cannot determine a valid remaining quantity after cancel")
      }

      await reconcileOrderFills({ symbol, order })
      const filledQuantity = maxDecimal({
        left: "0",
        right: subtractDecimal({
          left: String(order.quantity),
          right: remaining,
        }),
      })
      const reconciledFilledQuantity =
        state.filledQuantityByOrder.get(order.id) ?? "0"
      if (compareDecimal({
        left: reconciledFilledQuantity,
        right: filledQuantity,
      }) !== 0) {
        throw new Error(
          `SELL ${order.id} history mismatch: fills total ${reconciledFilledQuantity}, expected ${filledQuantity}`,
        )
      }

      state.cancelingOrderIds.delete(order.id)
      if (compareDecimal({ left: remaining, right: "0" }) === 0) {
        await handleSellFilled({ symbol })
      } else {
        state.sellOrder = null
      }

      debug(`[${symbol}] SELL cancellation reconciled`, {
        orderId: order.id,
        remaining,
        filledQuantity,
      })
      publish("order.cancelled", {
        orderId: order.id,
        symbol,
        side: "SELL",
        remainingQuantity: remaining,
        filledQuantity,
      })
      return true
    } catch (error) {
      publish("order.cancel_failed", {
        orderId: order.id,
        symbol,
        side: "SELL",
        error: error?.message ?? String(error),
      })
      pause(symbol, `Could not reconcile SELL ${order.id}`, error)
      return false
    }
  }

  async function placeSell({ symbol, state }) {
    if (!isRunning() || state.paused) return false

    const plan = calculateSellPlanExact({
      activeQuantity: state.activeQuantity,
      keepQuantity: String(state.settings.keepQuantity),
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      minProfit: minProfit(),
      feeRate: state.feeRate,
      priceTickSize: String(state.priceTickSize ?? 0),
      quantityStepSize: String(state.quantityStepSize ?? 0),
    })
    debug(`[${symbol}] SELL plan calculated`, {
      plan,
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      keepQuantity: state.settings.keepQuantity,
    })

    if (
      compareDecimal({ left: plan.quantity, right: "0" }) <= 0 ||
      plan.price === null
    ) return true

    try {
      const order = unwrapResult(
        await broker.createOrder({
          symbol,
          side: "SELL",
          type: state.orderType,
          ...(state.orderType === "LIMIT" ? { timeInForce: "GTC" } : {}),
          quantity: plan.quantity,
          price: plan.price,
        }),
        `create SELL ${symbol}`,
      )
      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: SELL response missing order ID`)

      state.trackedOrderIds.add(id)
      state.sellOrder = {
        id,
        side: "SELL",
        quantity: plan.quantity,
        price: plan.price,
      }
      publish("order.created", {
        orderId: id,
        symbol,
        side: "SELL",
        type: state.orderType,
        price: plan.price,
        quantity: plan.quantity,
      })
      debug(`[${symbol}] Recovery SELL submitted`, {
        ...state.sellOrder,
        plan,
        response: order,
      })
      return true
    } catch (error) {
      publish("order.create_failed", {
        symbol,
        side: "SELL",
        error: error?.message ?? String(error),
      })
      pause(symbol, "Recovery SELL submission failed", error)
      return false
    }
  }

  async function replaceSell({ symbol, state }) {
    if (!isRunning() || state.paused) return false
    if (state.sellOrder && !(await cancelSell({ symbol, state }))) return false
    return placeSell({ symbol, state })
  }

  return {
    cancelSell,
    placeBuy,
    placeSell,
    replaceSell,
    replaceTrailingBuy,
  }
}
