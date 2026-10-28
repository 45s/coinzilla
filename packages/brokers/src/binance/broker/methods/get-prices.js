import { defaultLogger as logger, Validator, VR } from "@coinzilla/utils"
import { send } from "../../shared/send.js"

export async function getPrices({ tickets } = {}) {
  Validator.validate({
    isSoft: false,
    items: [[tickets, [VR.notEmptyArr], "tickets"]],
  })
  const path = `ticker/price?symbols=${JSON.stringify(tickets)}`
  try {
    const r = await send({
      path,
    })
    if ("msg" in r) {
      logger.error(r)
      throw r
    }
    return r.map((x) => ({ ...x, price: Number(x.price) }))
  } catch (error) {
    logger.error({
      where: "brokers/binance/.../get-prices.js",
      tickets,
      error,
      path,
    })
    throw error
  }
}
