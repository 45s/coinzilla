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
  const requestUrl = `${url}/${path}`

  logger.debug({
    where,
    method,
    // Binance signed requests include a timestamp and signature in the query.
    // Keep those credentials out of logs while preserving the endpoint path.
    url: requestUrl.split("?")[0],
  })

  const r = await fetch(requestUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-MBX-APIKEY": apiKey,
      ...headers,
    },
  })
  return r.headers.get("content-type")?.toLowerCase().includes("application/json")
    ? r.json()
    : r.text()
}
