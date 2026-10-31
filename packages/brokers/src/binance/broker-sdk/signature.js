import { createHmac } from "node:crypto"

function normalizeValue(key, value) {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)

  throw new TypeError(
    `Binance signed parameter "${key}" must be a string, finite number, or boolean`,
  )
}

export function buildBinanceSignaturePayload(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Binance signature params must be an object")
  }

  return Object.keys(params)
    .filter((key) => key !== "signature")
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((key) => `${key}=${normalizeValue(key, params[key])}`)
    .join("&")
}

export function signBinanceParams(params, apiSecret) {
  if (typeof apiSecret !== "string" || apiSecret.length === 0) {
    throw new TypeError("Binance API secret is required for signed requests")
  }

  const payload = buildBinanceSignaturePayload(params)
  return createHmac("sha256", apiSecret).update(payload, "utf8").digest("hex")
}

export function createSignedBinanceParams(params, {
  apiKey,
  apiSecret,
  timestamp = Date.now(),
  recvWindow,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new TypeError("Binance API key is required for signed requests")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("Binance request timestamp must be a non-negative safe integer")
  }
  if (recvWindow !== undefined &&
      (typeof recvWindow !== "number" || !Number.isFinite(recvWindow) ||
       recvWindow <= 0 || recvWindow > 60_000 || Number((recvWindow % 1).toFixed(3)) !== recvWindow % 1)) {
    throw new RangeError("Binance recvWindow must be greater than 0 and at most 60000 ms with up to 3 decimals")
  }

  const unsigned = {
    ...params,
    apiKey,
    timestamp,
    ...(recvWindow === undefined ? {} : { recvWindow }),
  }
  delete unsigned.signature

  return {
    ...unsigned,
    signature: signBinanceParams(unsigned, apiSecret),
  }
}
