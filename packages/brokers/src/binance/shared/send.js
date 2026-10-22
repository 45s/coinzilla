import { defaultLogger as logger } from "@coinzilla/utils"
import { getBinanceConfig } from "../config.js"

const { baseURL, apiKey } = getBinanceConfig()
const where = "brokers/binance/shared/send.js"

export async function send({
  path,
  url = `${baseURL}/v3`,
  method = "GET",
  headers,
}) {
  logger.debug({
    where,
    method,
    url: `${url}/${path}`,
  })
  const r = await fetch(`${url}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-MBX-APIKEY": apiKey,
      ...headers,
    },
  })
  return r.headers.get("content-type")?.includes("application/json")
    ? r.json()
    : r.text()
}
