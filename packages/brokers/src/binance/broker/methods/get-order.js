import { defaultLogger as logger } from "@coinzilla/utils"
import {
  generateSignQuery,
  send,
  generateSignature,
  adaptOrder,
} from "../../shared/index.js"

/**
 * @see {@link https://binance-docs.github.io/apidocs/spot/en/#query-order-user_data}
 */
export async function getOrder({ orderId, symbol }) {
  const query = Object.entries({
    symbol,
    orderId,
  })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")
  const fullQuery = `${query}&${generateSignQuery()}`
  const path = `order?${fullQuery}&signature=${generateSignature(fullQuery)}`

  const r = await send({ path })
  if ("msg" in r) {
    logger.error(r)
    throw r
  }
  return adaptOrder(r)
}
