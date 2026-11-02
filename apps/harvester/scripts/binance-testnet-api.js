import { createHmac } from "node:crypto"

const TESTNET_BASE_URL = "https://testnet.binance.vision"
const RECV_WINDOW = 5000
const REQUEST_TIMEOUT_MS = 15000

export const createSignedQuery = ({ params = {}, timestamp, apiSecret }) => {
  if (!apiSecret) {
    throw new Error("Binance API secret is required to sign a TESTNET request")
  }

  const query = new URLSearchParams({
    ...params,
    recvWindow: String(RECV_WINDOW),
    timestamp: String(timestamp),
  })

  const signature = createHmac("sha256", apiSecret)
    .update(query.toString())
    .digest("hex")

  query.set("signature", signature)

  return { query: query.toString() }
}

const getCredentials = () => {
  const apiKey = process.env.BINANCE_API_KEY
  const apiSecret = process.env.BINANCE_API_SECRET_KEY

  if (!apiKey || !apiSecret) {
    throw new Error(
      "Missing BINANCE_API_KEY or BINANCE_API_SECRET_KEY. Set TESTNET credentials in apps/harvester/.env.development.",
    )
  }

  return { apiKey, apiSecret }
}

export const binanceTestnetRequest = async ({
  method,
  path,
  params = {},
}) => {
  const { apiKey, apiSecret } = getCredentials()
  const { query } = createSignedQuery({
    params,
    timestamp: Date.now(),
    apiSecret,
  })

  const url = `${TESTNET_BASE_URL}${path}?${query}`
  const response = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const responseText = await response.text()
  let data

  try {
    data = JSON.parse(responseText)
  } catch {
    throw new Error(
      `Binance TESTNET returned a non-JSON response (HTTP ${response.status})`,
    )
  }

  if (!response.ok) {
    throw new Error(
      `Binance TESTNET API error (HTTP ${response.status}, code ${data.code ?? "unknown"}): ${data.msg ?? "Request failed"}`,
    )
  }

  return { data }
}

export const getOpenOrders = async () => {
  const { data } = await binanceTestnetRequest({
    method: "GET",
    path: "/api/v3/openOrders",
  })

  if (!Array.isArray(data)) {
    throw new Error("Binance TESTNET returned an invalid open-orders response")
  }

  return { orders: data }
}

export const cancelOpenOrdersForSymbol = async ({ symbol }) => {
  if (!symbol || typeof symbol !== "string") {
    throw new Error("A valid symbol is required to cancel open orders")
  }

  const { data } = await binanceTestnetRequest({
    method: "DELETE",
    path: "/api/v3/openOrders",
    params: { symbol },
  })

  return { result: data }
}

export const getAccountBalances = async () => {
  const { data } = await binanceTestnetRequest({
    method: "GET",
    path: "/api/v3/account",
  })

  if (!data || typeof data !== "object" || !Array.isArray(data.balances)) {
    throw new Error("Binance TESTNET returned an invalid account response")
  }

  return { balances: data.balances }
}
