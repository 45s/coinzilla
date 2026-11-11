import test from "node:test"
import assert from "node:assert/strict"
import { runConfigSymbol } from "./config-symbol.js"

const createAppConfig = () => ({
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        LINKFDUSD: {
          enabled: true,
          investment: 200,
          orderQuantity: 2,
          keepQuantity: 0.01,
          minProfit: 0.01,
          priceStepPercent: 0.3,
          pricePrecision: 3,
          quantityPrecision: 2,
          makerPercent: 0,
          takerPercent: 0.075,
        },
      },
    },
  },
})

const metadata = {
  symbol: "ADAFDUSD",
  baseAsset: "ADA",
  quoteAsset: "FDUSD",
  price: "0.5",
  tickSize: "0.0001",
  stepSize: "0.1",
  minQuantity: "0.1",
  maxQuantity: "100000",
  minNotional: "5",
  supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
}

const createAsk = (answers) => {
  const remaining = [...answers]
  return async () => {
    assert.ok(remaining.length > 0, "The CLI must not ask for more values than the documented interactive flow.")
    return remaining.shift()
  }
}

test("prompts for strategy values, fetches metadata, previews the pair, and writes only after confirmation", async () => {
  const output = []
  const metadataCalls = []
  const writes = []
  const result = await runConfigSymbol({
    ask: createAsk([" adafdusd ", "100", "0.1", "0", "0.1", "", "", ""]),
    writeLine: (line) => output.push(line),
    loadConfig: async () => createAppConfig(),
    metadataFetcher: async (args) => {
      metadataCalls.push(args)
      return metadata
    },
    writeConfig: async (args) => {
      writes.push(args)
      return "/repo/apps/harvester/config.json"
    },
    configPath: "/repo/apps/harvester/config.json",
  })

  assert.equal(metadataCalls.length, 1, "Valid operator input must trigger one public exchange metadata lookup.")
  assert.equal(metadataCalls[0].symbol, "ADAFDUSD", "The normalized symbol must be sent to Binance.")
  assert.equal(writes.length, 1, "An affirmative default confirmation must write exactly once.")
  assert.equal(writes[0].symbol, "ADAFDUSD", "The generated configuration must use the normalized symbol.")
  assert.equal(writes[0].pairConfig.enabled, false, "The generated pair must remain disabled until an operator enables it.")
  assert.equal(writes[0].pairConfig.minProfit, 0.01, "The documented minimum-profit default must be applied.")
  assert.equal(writes[0].pairConfig.priceStepPercent, 0.05, "The documented price-step default must be applied.")
  assert.equal(result.written, true, "The CLI result must report a successful write only after the writer resolves.")
  assert.ok(output.some((line) => line.includes("Configuration preview")), "The operator must see the generated configuration before confirming.")
  assert.ok(output.some((line) => line.includes("maxNotional")), "The preview must expose any active maximum-notional exchange filter.")
  assert.ok(output.some((line) => line.includes("Account-specific myFilters")), "The operator must be told that account-specific exchange constraints are checked later by Harvester at startup.")
})

test("rejects invalid operator input before making any Binance request", async () => {
  let metadataCalls = 0
  let writes = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk(["ADAFDUSD", "100", "0.1", "100", "0.1", "", "", ""]),
      loadConfig: async () => createAppConfig(),
      metadataFetcher: async () => {
        metadataCalls += 1
        return metadata
      },
      writeConfig: async () => {
        writes += 1
      },
    }),
    /makerPercent.*less than 100/i,
    "Invalid commission percentages must fail before external metadata is requested.",
  )
  assert.equal(metadataCalls, 0, "Invalid input must not make a Binance API request.")
  assert.equal(writes, 0, "Invalid input must not change the configuration file.")
})

test("refuses an existing symbol before making an exchange request", async () => {
  let metadataCalls = 0
  const config = createAppConfig()
  config.strategies.CG_coinGrabber.pairs.ADAFDUSD = config.strategies.CG_coinGrabber.pairs.LINKFDUSD
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk(["ADAFDUSD", "100", "0.1", "0", "0.1", "", "", ""]),
      loadConfig: async () => config,
      metadataFetcher: async () => {
        metadataCalls += 1
        return metadata
      },
    }),
    /already exists/i,
    "An existing pair must be detected before contacting Binance or offering a replacement.",
  )
  assert.equal(metadataCalls, 0, "An existing symbol must not trigger unnecessary external requests.")
})

test("detects a case-insensitive existing pair before calling Binance", async () => {
  const config = createAppConfig()
  config.strategies.CG_coinGrabber.pairs.adafdusd = config.strategies.CG_coinGrabber.pairs.LINKFDUSD
  let metadataCalls = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk(["ADAFDUSD", "100", "0.1", "0", "0.1", "", "", ""]),
      loadConfig: async () => config,
      metadataFetcher: async () => {
        metadataCalls += 1
        return metadata
      },
    }),
    /already exists/i,
    "The CLI must not create a second pair whose symbol differs only by case.",
  )
  assert.equal(metadataCalls, 0, "Case-insensitive duplicates must be rejected before contacting Binance.")
})

test("cancels safely when the operator declines the configuration preview", async () => {
  let writes = 0
  const result = await runConfigSymbol({
    ask: createAsk(["ADAFDUSD", "100", "0.1", "0", "0.1", "", "", "n"]),
    loadConfig: async () => createAppConfig(),
    metadataFetcher: async () => metadata,
    writeConfig: async () => {
      writes += 1
    },
  })
  assert.equal(result.written, false, "Declining the preview must return an explicit cancelled result.")
  assert.equal(writes, 0, "Declining the preview must not write or mutate configuration.")
})

test("does not write configuration when Binance metadata lookup fails", async () => {
  let writes = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk(["ADAFDUSD", "100", "0.1", "0", "0.1", "", "", ""]),
      loadConfig: async () => createAppConfig(),
      metadataFetcher: async () => {
        throw new Error("Binance unavailable")
      },
      writeConfig: async () => {
        writes += 1
      },
    }),
    /Binance unavailable/,
    "An exchange metadata failure must be visible to the operator.",
  )
  assert.equal(writes, 0, "An exchange metadata failure must never create a pair configuration.")
})
