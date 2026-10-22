import { defaultLogger as logger } from "@coinzilla/utils"
import {
  generateSignQuery,
  generateSignature,
  send,
} from "../../shared/index.js"

/**
 * {@link https://binance-docs.github.io/apidocs/spot/en/#cancel-order-trade}
 */
export async function cancelOrder(input) {
  const query = Object.entries(input)
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const fullQuery = `${query}&${generateSignQuery()}`
  const r = await send({
    method: "DELETE",
    path: `order?${fullQuery}&signature=${generateSignature(fullQuery)}`,
  })
  if ("msg" in r) {
    logger.error(r)
    throw r
  }
  return r
}
