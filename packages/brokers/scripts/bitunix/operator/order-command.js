import { createInterface } from "node:readline/promises"
import { resolve } from "node:path"
import { Broker } from "../../../src/index.js"
import { createOneShotMarker, runBitunixOperatorOrderAttempt } from "./order-attempt.js"

function readBitunixApiCredentials({ env }) {
  const apiKey = env.BITUNIX_API_KEY?.trim()
  const apiSecret = env.BITUNIX_API_SECRET?.trim()
  if (!apiKey || !apiSecret) {
    throw new Error("Set BITUNIX_API_KEY and BITUNIX_API_SECRET in packages/brokers/.env.development")
  }
  return { apiKey, apiSecret }
}

function createBitunixBroker({ credentials, allowLiveOrderMutations }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: { allowLiveOrderMutations },
  })
}

function redactBitunixApiSecrets({ message, secrets }) {
  let safeMessage = String(message)
  for (const secret of secrets) {
    if (secret) {
      safeMessage = safeMessage.replaceAll(secret, "[REDACTED]")
    }
  }
  return safeMessage
}

async function askForBitunixOrderConfirmation({ order, stdin, stdout }) {
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await readline.question(
      `Press ENTER to submit this LIVE ${order.side} ${order.type} ${order.symbol} order (${order.quantity} HYPE at ${order.price} USDT; ${order.notional} USDT notional), or type anything to decline: `,
    )
    return answer === ""
  } finally {
    readline.close()
  }
}

/**
 * Execute the existing fixed HYPEUSDT operator workflow through the public Broker facade.
 *
 * @param {{env: NodeJS.ProcessEnv, brokersRoot: string, stdin?: NodeJS.ReadStream, stdout?: NodeJS.WriteStream}} input
 * @returns {Promise<object>} Broker result or explicit NOT_SENT decline result.
 */
export async function runBitunixOperatorOrderCommand({
  env,
  brokersRoot,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  const credentials = readBitunixApiCredentials({ env })
  stdout.write(
    "WARNING: this command can submit one real Bitunix Spot LIVE order. Review every preflight value before pressing ENTER.\n",
  )
  const readBroker = createBitunixBroker({
    credentials,
    allowLiveOrderMutations: false,
  })
  return runBitunixOperatorOrderAttempt({
    readBroker,
    createOrderBroker: () => createBitunixBroker({
      credentials,
      allowLiveOrderMutations: true,
    }),
    confirm: ({ order }) => askForBitunixOrderConfirmation({
      order,
      stdin,
      stdout,
    }),
    createMarker: ({ preflight }) => createOneShotMarker({
      markerPath: resolve(brokersRoot, ".diagnostics/bitunix-hypeusdt-buy-limit-attempt.json"),
      preflight,
    }),
    writeLine: (message) => stdout.write(`${redactBitunixApiSecrets({
      message,
      secrets: [credentials.apiKey, credentials.apiSecret],
    })}\n`),
  })
}

/**
 * Print a credential-redacted local operator failure without a raw stack trace.
 *
 * @param {{error: unknown, env: NodeJS.ProcessEnv, stderr?: NodeJS.WriteStream}} input
 */
export function reportBitunixOperatorFailure({
  error,
  env,
  stderr = process.stderr,
} = {}) {
  const message = redactBitunixApiSecrets({
    message: error?.message ?? error,
    secrets: [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET],
  })
  stderr.write(`Bitunix operator order attempt stopped: ${message}\n`)
  stderr.write(
    "If the one-shot marker exists or dispatch may have started, do not rerun; reconcile manually first.\n",
  )
}
