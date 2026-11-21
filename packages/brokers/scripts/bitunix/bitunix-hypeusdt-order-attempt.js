import { createInterface } from "node:readline/promises"
import { resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { Broker } from "../../src/index.js"
import { parseBitunixApiCredentials, redactBitunixApiSecrets } from "./helpers/operator-credentials.js"
import { assertBitunixOperatorInteractiveTerminal } from "./helpers/operator-order-validation.js"
import { createOneShotMarker, runBitunixOperatorOrderAttempt } from "./workflows/bitunix-operator-order-attempt.js"

const markerPath = fileURLToPath(new URL(
  "../../.diagnostics/bitunix-hypeusdt-buy-limit-attempt.json",
  import.meta.url,
))


function createBitunixBroker({ credentials, allowLiveOrderMutations }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations,
    },
  })
}


async function askForBitunixOrderConfirmation({ confirmationPhrase }) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const answer = await readline.question(
      `Type exactly "${confirmationPhrase}" to submit one LIVE order: `,
    )
    return answer === confirmationPhrase
  } finally {
    readline.close()
  }
}

async function main() {
  assertBitunixOperatorInteractiveTerminal({
    stdin: process.stdin,
    stdout: process.stdout,
  })
  const credentials = parseBitunixApiCredentials({
    env: process.env,
  })
  process.stdout.write(
    "WARNING: this command can submit one real Bitunix Spot LIVE order. Review every preflight value before confirming.\n",
  )
  const readBroker = createBitunixBroker({
    credentials,
    allowLiveOrderMutations: false,
  })
  const result = await runBitunixOperatorOrderAttempt({
    readBroker,
    createOrderBroker: () => createBitunixBroker({
      credentials,
      allowLiveOrderMutations: true,
    }),
    confirm: askForBitunixOrderConfirmation,
    createMarker: ({ preflight }) => createOneShotMarker({
      markerPath,
      preflight,
    }),
    writeLine: (message) => process.stdout.write(
      `${redactBitunixApiSecrets({
        message,
        secrets: [credentials.apiKey, credentials.apiSecret],
      })}\n`,
    ),
  })
  if (result.declined) {
    return
  }
  if (result.ok !== true || result.mutationOutcome !== "CONFIRMED") {
    process.exitCode = 1
  }
}

function reportBitunixOperatorFailure({ error }) {
  const message = redactBitunixApiSecrets({
    message: error?.message ?? error,
    secrets: [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET],
  })
  process.stderr.write(`Bitunix operator order attempt stopped: ${message}\n`)
  process.stderr.write(
    "If the one-shot marker exists or dispatch may have started, do not rerun; reconcile manually first.\n",
  )
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  main().catch((error) => {
    reportBitunixOperatorFailure({
      error,
    })
    process.exitCode = 1
  })
}
