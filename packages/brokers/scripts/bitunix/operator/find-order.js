import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runFindBitunixSpotOrder } from "./find-order-command.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../../..")
const envPath = resolve(brokersRoot, ".env.development")

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:find-order --order-id=<exact-order-id>",
    "",
    "Enumerates every active Bitunix Spot market, fetches pending orders, and reads each order detail.",
    "Records every Broker API and REST diagnostic event plus complete sanitized results in .diagnostics/.",
    "This command is read-only. It cannot place or cancel orders.",
    "An order missing from all pending lists may have filled or otherwise left the pending set.",
    "",
  ].join("\n"))
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    printHelp()
    return 0
  }
  if (args.length !== 1 || !args[0].startsWith("--order-id=")) {
    printHelp()
    process.stderr.write("ERROR: provide exactly one --order-id=<exact-order-id> argument.\n")
    return 1
  }
  const orderId = args[0].slice("--order-id=".length)
  try {
    loadEnvFile(envPath)
  } catch {
    process.stderr.write("ERROR: create packages/brokers/.env.development with BITUNIX_API_KEY and BITUNIX_API_SECRET.\n")
    return 1
  }
  process.stdout.write("WARNING: scanning all active markets on the configured LIVE Bitunix Spot account. This makes multiple sequential read-only requests. No order mutation will be performed.\n")
  const result = await runFindBitunixSpotOrder({
    env: process.env,
    orderId,
  })
  return result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      process.stderr.write(`ERROR: ${error?.message ?? String(error)}\n`)
      process.exitCode = 1
    })
}
