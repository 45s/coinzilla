import { Broker } from "../../../src/index.js"
import { parseApiCredentials, redactApiSecrets } from "../helpers/api-credentials.js"

const SYMBOL = "HYPEUSDT"

function validateOrderId({ orderId }) {
  if (typeof orderId !== "string" || !/^[0-9]+$/.test(orderId)) {
    throw new TypeError("Bitunix order lookup requires an exact digit-string --order-id value")
  }
  return orderId
}

function createBroker({ credentials }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations: false,
    },
  })
}

function writeSafeError({ error, credentials, stderr }) {
  const message = redactApiSecrets({
    message: error?.message ?? String(error),
    secrets: [credentials?.apiKey, credentials?.apiSecret],
  })
  stderr.write(`ERROR: ${message}\n`)
}

/**
 * Find one exact HYPEUSDT order using the read-only pending-orders endpoint.
 *
 * @param {{env: NodeJS.ProcessEnv, orderId: string, brokerFactory?: Function, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream}} input
 * @returns {Promise<{exitCode: number, found: boolean, order?: object}>}
 */
export async function runFindBitunixSpotOrder({
  env,
  orderId,
  brokerFactory = ({ credentials }) => createBroker({ credentials }),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const normalizedOrderId = validateOrderId({ orderId })
  const credentials = parseApiCredentials({ env })
  const broker = brokerFactory({
    credentials,
    allowLiveOrderMutations: false,
  })
  let connected = false
  try {
    await broker.connect()
    connected = true
    const result = await broker.getOpenOrders({ symbol: SYMBOL })
    if (result?.ok !== true || !Array.isArray(result.data)) {
      const error = result?.errors?.[0] ?? new Error("pending-order query returned no valid order array")
      writeSafeError({ error, credentials, stderr })
      return { exitCode: 1, found: false }
    }

    const matches = result.data.filter((order) =>
      order?.id === normalizedOrderId && order?.symbol === SYMBOL)
    if (matches.length > 1) {
      stderr.write(`ERROR: duplicate exact order identity returned for ${SYMBOL} ${normalizedOrderId}\n`)
      return { exitCode: 1, found: false }
    }
    if (matches.length === 0) {
      stdout.write([
        `NOT FOUND in current ${SYMBOL} pending orders: ${normalizedOrderId}`,
        "This is not proof that the order does not exist; it may have left the pending set.",
        "Do not place or cancel anything. Check order history/detail in the next approved phase.",
        "",
      ].join("\n"))
      return { exitCode: 2, found: false }
    }

    const [order] = matches
    stdout.write([
      `FOUND: ${SYMBOL} order ${normalizedOrderId}`,
      `Status: ${order.status ?? "UNKNOWN"}`,
      `Side: ${order.side ?? "UNKNOWN"}`,
      `Type: ${order.type ?? "UNKNOWN"}`,
      `Price: ${order.originalPrice ?? order.price ?? "UNKNOWN"}`,
      `Original quantity: ${order.originalQuantity ?? "UNKNOWN"}`,
      `Executed quantity: ${order.executedQuantity ?? "UNKNOWN"}`,
      `Remaining quantity: ${order.remainingQuantity ?? "UNKNOWN"}`,
      "Read-only lookup complete. No order mutation was performed.",
      "",
    ].join("\n"))
    return { exitCode: 0, found: true, order }
  } catch (error) {
    writeSafeError({ error, credentials, stderr })
    return { exitCode: 1, found: false }
  } finally {
    if (connected) {
      await broker.disconnect()
    }
  }
}
