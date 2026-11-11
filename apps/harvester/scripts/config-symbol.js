import { createInterface } from "node:readline/promises"
import { stdin, stdout, stderr } from "node:process"
import { pathToFileURL, fileURLToPath } from "node:url"
import { normalizeSymbolInput, normalizeTradingEnvironment, parseDecimalInput, normalizePairInputs, createPairConfig } from "./config-symbol/configuration.js"
import { fetchBinanceSpotMetadata } from "./config-symbol/binance-client.js"
import { writePairConfigAtomically } from "./config-symbol/write-config.js"
import { loadAppConfig } from "../src/infrastructure/config/load-app-config.js"

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../config.json", import.meta.url))

/**
 * Run the interactive operator flow; all external effects are injected or isolated at this boundary.
 *
 * @param {object} options
 * @param {(question: string) => Promise<string>} options.ask - Terminal prompt function.
 * @param {(line: string) => void} [options.writeLine] - Operator-facing output function.
 * @param {typeof fetch} [options.fetchImpl] - Public metadata transport.
 * @param {Function} [options.metadataFetcher] - Binance metadata adapter.
 * @param {string} [options.configPath] - Canonical Harvester config path.
 * @param {Function} [options.loadConfig] - Existing app-config loader.
 * @param {Function} [options.writeConfig] - Atomic pair-config writer.
 * @returns {Promise<object>} Generated pair and whether the operator confirmed persistence.
 * @throws {Error|TypeError|RangeError} If input, existing config, metadata, or persistence is invalid.
 */
export async function runConfigSymbol({
  ask,
  writeLine = () => {},
  fetchImpl = globalThis.fetch,
  metadataFetcher = fetchBinanceSpotMetadata,
  configPath = DEFAULT_CONFIG_PATH,
  defaultEnvironment = process.env.TRADING_MODE === "live" ? "live" : "testnet",
  loadConfig = loadAppConfig,
  writeConfig = writePairConfigAtomically,
} = {}) {
  if (typeof ask !== "function") {
    throw new TypeError("runConfigSymbol requires an interactive ask function")
  }

  writeLine("Harvester — add a Binance Spot trading pair")
  writeLine("Exchange filters and precision are fetched automatically. This command never places or cancels orders.")
  const symbol = normalizeSymbolInput(await ask("Trading symbol (for example ADAFDUSD): "))
  const environment = normalizeTradingEnvironment(defaultEnvironment)
  const inputs = normalizePairInputs({
    investment: parseDecimalInput(await ask("Total investment / quote budget for this pair: "), "investment", { exclusiveMin: true }),
    orderQuantity: parseDecimalInput(await ask("Quantity per individual order (base asset): "), "orderQuantity", { exclusiveMin: true }),
    keepQuantity: parseDecimalInput(await ask("keepQuantity (base asset): "), "keepQuantity"),
    makerPercent: parseDecimalInput(await ask("Maker commission percent (for example 0): "), "makerPercent"),
    takerPercent: parseDecimalInput(await ask("Taker commission percent (for example 0.1): "), "takerPercent"),
    minProfit: parseDecimalInput(
      await ask("Minimum profit per recovery cycle in quote asset: "),
      "minProfit",
      { exclusiveMin: true },
    ),
    priceStepPercent: parseDecimalInput(
      await ask("Price step percent: "),
      "priceStepPercent",
      { exclusiveMin: true },
    ),
  })

  const existingConfig = await loadConfig(configPath)
  const existingSymbol = Object.keys(existingConfig.strategies.CG_coinGrabber.pairs)
    .find((candidate) => candidate.trim().toUpperCase() === symbol)
  if (existingSymbol) {
    throw new Error("Pair " + symbol + " already exists in config.json; refusing to overwrite it")
  }

  writeLine("Fetching current public Binance Spot exchange information...")
  const metadata = await metadataFetcher({ symbol, environment, fetchImpl })
  if (metadata?.symbol !== symbol || metadata?.environment !== environment) {
    throw new Error("Binance metadata symbol/environment does not match the operator selection")
  }
  const pairConfig = createPairConfig({ inputs, metadata })
  writeLine("")
  writeLine("Configuration preview — config.json pair entry:")
  writeLine(JSON.stringify({ [symbol]: pairConfig }, null, 2))

  const confirmation = (await ask("Add this pair to apps/harvester/config.json? [Y/n]: ")).trim().toLowerCase()
  if (confirmation !== "" && confirmation !== "y" && confirmation !== "yes") {
    writeLine("Cancelled. No configuration file was changed.")
    return Object.freeze({ written: false, symbol, pairConfig })
  }

  const writtenPath = await writeConfig({ configPath, symbol, pairConfig })
  writeLine("Pair configuration added successfully: " + writtenPath)
  writeLine("The pair was added with enabled: true.")
  return Object.freeze({ written: true, symbol, pairConfig, path: writtenPath })
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("config:symbol requires an interactive terminal; run it from Git Bash or a terminal window")
  }
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    await runConfigSymbol({
      ask: (question) => terminal.question(question),
      writeLine: (line) => stdout.write(line + "\n"),
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
    stderr.write("config:symbol failed: " + (error?.message ?? String(error)) + "\n")
    process.exitCode = 1
  }
}
