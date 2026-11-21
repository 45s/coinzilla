import { createInterface } from "node:readline"
import { resolve } from "node:path"
import { Broker } from "../../../src/index.js"
import {
  assertBitunixOperatorInteractiveTerminal,
  createOneShotMarker,
  runBitunixOperatorOrderAttempt,
} from "./order-attempt.js"
import {
  parseApiCredentials,
  redactApiSecrets,
} from "../helpers/api-credentials.js"

function createBitunixBroker({ credentials, allowLiveOrderMutations }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: { allowLiveOrderMutations },
  })
}

export function askForBitunixOrderConfirmation({ order, stdin, stdout }) {
  const readline = createInterface({
    input: stdin,
    output: stdout,
  })
  return new Promise((resolveAnswer) => {
    let settled = false
    const finish = (approved) => {
      if (settled) {
        return
      }
      settled = true
      readline.close()
      resolveAnswer(approved)
    }
    readline.once("close", () => finish(false))
    readline.question(
      `Press ENTER to submit this LIVE ${order.side} ${order.type} ${order.symbol} order (${order.quantity} HYPE at ${order.price} USDT; ${order.notional} USDT notional), or type anything to decline: `,
      (answer) => finish(answer === ""),
    )
  })
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
  assertBitunixOperatorInteractiveTerminal({
    stdin,
    stdout,
  })
  const credentials = parseApiCredentials({ env })
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
    writeLine: (message) => stdout.write(`${redactApiSecrets({
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
  const message = redactApiSecrets({
    message: error?.message ?? error,
    secrets: [
      env.BITUNIX_API_KEY,
      env.BITUNIX_API_SECRET,
    ],
  })
  stderr.write(`Bitunix operator order attempt stopped: ${message}\n`)
  stderr.write(
    "If the one-shot marker exists or dispatch may have started, do not rerun; reconcile manually first.\n",
  )
}
