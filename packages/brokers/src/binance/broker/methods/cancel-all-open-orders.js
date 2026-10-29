import { defaultLogger as logger, Validator, VR } from "@coinzilla/utils"
import {
  generateSignQuery,
  generateSignature,
  send,
} from "../../shared/index.js"

/**
 * {@link https://developers.binance.com/docs/binance-spot-api-docs/rest-api#cancel-all-open-orders-on-a-symbol-trade}
 */
export async function cancelAllOpenOrders(input = {}) {
  const { ticket } = input
  Validator.validate({
    isSoft: false,
    items: [[input.ticket, [VR.required, VR.notEmptyString]]],
  })
  const query = Object.entries({ symbol: ticket })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")
  const fullQuery = `${query}&${generateSignQuery()}`
  const sendParams = {
    method: "DELETE",
    path: `openOrders?${fullQuery}&signature=${generateSignature(fullQuery)}`,
  }
  const r = await send(sendParams)
  if ("msg" in r) {
    logger.error(r)
    throw r
  }
  return {
    isOk: true,
    data: {
      totalCount: r.length,
      sendParams,
      canceledOrders: r,
    },
  }
}
