import { createInterface } from "node:readline/promises"
import { stdin, stdout, stderr } from "node:process"
import { pathToFileURL, fileURLToPath } from "node:url"
import { normalizeSymbolInput, normalizeTradingEnvironment } from "./config-symbol/configuration.js"
import { fetchBinanceSpotMetadata } from "./config-symbol/binance-client.js"
import { writeTokenSpecificationAtomically } from "./config-symbol/write-token-specification.js"
import { createMarketSpecification } from "../src/infrastructure/config/token-specifications.js"
import { TRADING_ENVIRONMENTS } from "../src/domain/trading-environment.js"

const DEFAULT_SPECIFICATION_PATH = fileURLToPath(new URL("../token-specification.json", import.meta.url))

export async function runConfigSymbol({
  ask,
  writeLine = () => {},
  fetchImpl = globalThis.fetch,
  metadataFetcher = fetchBinanceSpotMetadata,
  specificationPath = DEFAULT_SPECIFICATION_PATH,
  defaultEnvironment = process.env.TRADING_MODE ?? TRADING_ENVIRONMENTS.TESTNET,
  writeSpecification = writeTokenSpecificationAtomically,
} = {}) {
  if (typeof ask !== "function") {
    throw new TypeError("runConfigSymbol requires an interactive ask function")
  }
  writeLine("Harvester — update Binance token and market specifications")
  writeLine("This command updates token-specification.json only. It never changes strategy configuration or places/cancels orders.")

  const symbol = normalizeSymbolInput(await ask("Binance Spot market symbol (for example POLUSDT): "))
  const environment = normalizeTradingEnvironment(defaultEnvironment)
  writeLine(`Fetching public Binance Spot exchange information from ${environment}...`)

  const metadata = await metadataFetcher({ symbol, environment, fetchImpl })
  if (metadata?.symbol !== symbol || metadata?.environment !== environment) {
    throw new Error("Binance metadata symbol/environment does not match the operator selection")
  }
  const { baseAsset, market } = createMarketSpecification({ metadata })
  const preview = {
    [baseAsset]: {
      baseAsset,
      markets: {
        [symbol]: market,
      },
    },
  }

  writeLine("")
  writeLine("Token specification preview — apps/harvester/token-specification.json:")
  writeLine(JSON.stringify(preview, null, 2))
  if (Array.isArray(metadata.unvalidatedConstraints) && metadata.unvalidatedConstraints.length > 0) {
    writeLine("Public exchange constraints not evaluated by the generator (diagnostic only):")
    writeLine(JSON.stringify(metadata.unvalidatedConstraints, null, 2))
  }
  const confirmation = (await ask("Add or refresh this market in the shared token specification? [Y/n]: ")).trim().toLowerCase()
  if (confirmation !== "" && confirmation !== "y" && confirmation !== "yes") {
    writeLine("Cancelled. No token specification file was changed.")
    return Object.freeze({ written: false, symbol, baseAsset, marketSpecification: market })
  }

  const writtenPath = await writeSpecification({ specificationPath, metadata })
  writeLine(`Token specification updated successfully: ${writtenPath}`)
  writeLine("Strategy pair configuration was not changed.")
  return Object.freeze({ written: true, symbol, baseAsset, marketSpecification: market, path: writtenPath })
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("config:symbol requires an interactive terminal; run it from Git Bash or a terminal window")
  }
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    await runConfigSymbol({
      ask: (question) => terminal.question(question),
      writeLine: (line) => stdout.write(`${line}\n`),
    })
  } finally {
    terminal.close()
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  try {
    await main()
  } catch (error) {
    stderr.write(`config:symbol failed: ${error?.message ?? String(error)}\n`)
    process.exitCode = 1
  }
}
