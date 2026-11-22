import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Broker } from "../../../src/index.js"
import { parseApiCredentials, redactApiSecrets } from "../helpers/api-credentials.js"

export const EXISTING_HYPE_ORDER = Object.freeze({
  symbol: "HYPEUSDT",
  orderId: "2124329325141426176",
})

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

function formatOrder({ order }) {
  return [
    `Order ID: ${order.id}`,
    `Symbol: ${order.symbol}`,
    `Status: ${order.status}`,
    `Side / type: ${order.side} / ${order.type}`,
    `Price: ${order.originalPrice ?? order.price}`,
    `Original quantity: ${order.originalQuantity ?? "unknown"}`,
    `Executed quantity: ${order.executedQuantity ?? "unknown"}`,
    `Remaining quantity: ${order.remainingQuantity ?? "unknown"}`,
    `Created: ${order.createdAt ?? "unknown"}`,
    `Updated: ${order.updatedAt ?? "unknown"}`,
  ]
}

export async function runExistingHypeOrderVerification({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  brokerFactory = createBroker,
} = {}) {
  const credentials = parseApiCredentials({ env })
  const broker = brokerFactory({ credentials })
  stdout.write("READ-ONLY Bitunix Spot check: fetching current HYPEUSDT pending orders. No order mutations will be sent.\n")

  const result = await broker.getOpenOrders({ symbol: EXISTING_HYPE_ORDER.symbol })
  if (!result || result.ok !== true || !Array.isArray(result.data)) {
    const error = result?.errors?.[0] ?? new Error("getOpenOrders returned an invalid result")
    stderr.write(`Order fetch failed: ${redactApiSecrets({
      message: error.message,
      secrets: [credentials.apiKey, credentials.apiSecret],
    })}\n`)
    return 1
  }

  const order = result.data.find((candidate) =>
    candidate.id === EXISTING_HYPE_ORDER.orderId &&
    candidate.symbol === EXISTING_HYPE_ORDER.symbol)

  stdout.write(`Fetched ${result.data.length} current HYPEUSDT pending order(s).\n`)
  if (!order) {
    stdout.write(`Exact order NOT FOUND: ${EXISTING_HYPE_ORDER.orderId}. No mutation was attempted.\n`)
    return 2
  }

  stdout.write("Exact existing HYPEUSDT order FOUND:\n")
  stdout.write(`${formatOrder({ order }).join("\n")}\n`)
  stdout.write("No order mutation was attempted.\n")
  return 0
}

async function main() {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  try {
    loadEnvFile(resolve(packageRoot, ".env.development"))
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Create packages/brokers/.env.development with BITUNIX_API_KEY and BITUNIX_API_SECRET")
    }
    throw error
  }
  process.exitCode = await runExistingHypeOrderVerification()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const secrets = [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET]
    process.stderr.write(`Bitunix HYPE order verification failed: ${redactApiSecrets({
      message: error?.message ?? error,
      secrets,
    })}\n`)
    process.exitCode = 1
  })
}
