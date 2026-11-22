import { createInterface } from "node:readline"
import { resolve } from "node:path"
import { Broker } from "../../../src/index.js"
import {
  createCaptureRestClientFactory,
  createProbeMarker,
  runBitunixOrderProbeAttempt,
} from "./order-probe-attempt.js"
import { assertInteractiveTerminal } from "../helpers/validate-order-attempt.js"
import {
  parseApiCredentials,
  redactApiSecrets,
} from "../helpers/api-credentials.js"
import { getBitunixOrderProbe } from "./order-probe-matrix.js"
import { assertBitunixOrderProbeMatrixCanContinue } from "./order-probe-matrix-guard.js"

function createBroker({ credentials, allowLiveOrderMutations, capture }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations,
      ...(capture === undefined ? {} : {
        dependencies: {
          restClientFactory: createCaptureRestClientFactory({
            capture,
          }),
        },
      }),
    },
  })
}

function askForOrderProbeConfirmation({ probe, stdin, stdout }) {
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
      `Press ENTER to submit this LIVE ${probe.side} ${probe.type} HYPEUSDT probe "${probe.id}", or type anything to decline: `,
      (answer) => finish(answer === ""),
    )
  })
}

/**
 * Run one selected, human-confirmed Bitunix Spot LIVE order probe.
 *
 * @param {{env: NodeJS.ProcessEnv, brokersRoot: string, probeId: string, stdin?: NodeJS.ReadStream, stdout?: NodeJS.WriteStream}} input
 * @returns {Promise<object>} Broker result or explicit NOT_SENT decline result.
 */
export async function runOperatorOrderProbeCommand({
  env,
  brokersRoot,
  probeId,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  assertInteractiveTerminal({
    stdin,
    stdout,
  })
  const probe = getBitunixOrderProbe({
    probeId,
  })
  const credentials = parseApiCredentials({
    env,
  })
  const secrets = [credentials.apiKey, credentials.apiSecret]
  const capture = {}
  stdout.write(
    "WARNING: this command can submit one real Bitunix Spot LIVE order. Each probe is a separate one-shot operation.\n",
  )
  return runBitunixOrderProbeAttempt({
    probeId,
    readBroker: createBroker({
      credentials,
      allowLiveOrderMutations: false,
    }),
    createOrderBroker: () => createBroker({
      credentials,
      allowLiveOrderMutations: true,
      capture,
    }),
    confirm: ({ preflight }) => askForOrderProbeConfirmation({
      probe: preflight.probe,
      stdin,
      stdout,
    }),
    createMarker: ({ preflight }) => createProbeMarker({
      markerPath: resolve(brokersRoot, `.diagnostics/bitunix-order-probe-${probe.id}.json`),
      preflight,
    }),
    assertMatrixCanContinue: () => assertBitunixOrderProbeMatrixCanContinue({
      diagnosticsDirectory: resolve(brokersRoot, ".diagnostics"),
    }),
    writeLine: (message) => stdout.write(`${redactApiSecrets({
      message,
      secrets,
    })}\n`),
    capture,
    secrets,
  })
}

/**
 * Print a credential-redacted failure without exposing a raw stack trace.
 *
 * @param {{error: unknown, env: NodeJS.ProcessEnv, stderr?: NodeJS.WriteStream}} input
 */
export function reportOrderProbeFailure({
  error,
  env,
  stderr = process.stderr,
} = {}) {
  const secrets = [
    env.BITUNIX_API_KEY,
    env.BITUNIX_API_SECRET,
  ]
  const message = redactApiSecrets({
    message: error?.message ?? error,
    secrets,
  })
  stderr.write(`Bitunix order probe stopped: ${message}\n`)
  for (const [label, value] of [
    ["Broker error code", error?.code],
    ["Bitunix exchange code", error?.exchangeCode],
    ["HTTP status", error?.status],
    ["Error kind", error?.kind],
  ]) {
    if (value !== undefined && value !== null) {
      stderr.write(`${label}: ${redactApiSecrets({
        message: String(value),
        secrets,
      })}\n`)
    }
  }
  stderr.write(
    "If the probe marker exists or dispatch may have started, do not rerun this probe. Inspect its local marker and investigate before another order attempt.\n",
  )
}
