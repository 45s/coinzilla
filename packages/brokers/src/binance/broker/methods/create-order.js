import { defaultLogger as logger } from "@coinzilla/utils"
import {
  generateSignQuery,
  generateSignature,
  send,
  adaptOrder,
} from "../../shared/index.js"

/**
 * @param order {
 *  symbol, type, side, price, quantity, clientOrderId
 * }
 * @see {@link https://binance-docs.github.io/apidocs/spot/en/#spot-account-trade}
 */
export async function createOrder({ order }) {
  const { symbol, type, side, price, quantity, clientOrderId } = order
  const query = Object.entries({
    symbol,
    type,
    side,
    price,
    quantity,
    timeInForce: "GTC",
    ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
  })
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const fullQuery = `${query}&${generateSignQuery()}`
  const path = `order?${fullQuery}&signature=${generateSignature(fullQuery)}`
  const createOrderResponse = await send({
    path,
    method: "POST",
  })
  if ("msg" in createOrderResponse) {
    logger.error({
      where: `binance/broker/methods/${createOrder.name}`,
      msg: createOrderResponse.msg,
      createOrderResponse,
    })
    throw createOrderResponse
  }
  return adaptOrder(createOrderResponse)
}
