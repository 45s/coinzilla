import test from "node:test"
import assert from "node:assert/strict"
import { runConfigSymbol } from "./config-symbol.js"
import { TRADING_ENVIRONMENTS } from "../src/domain/trading-environment.js"

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
          tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
          enableVolatilityProtection: true,
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
  environment: TRADING_ENVIRONMENTS.TESTNET,
  baseAsset: "ADA",
  quoteAsset: "FDUSD",
  price: "0.5",
  tickSize: "0.0001",
  stepSize: "0.1",
  minQuantity: "0.1",
  maxQuantity: "100000",
  minNotional: "5",
  maxNotional: "50",
  supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
}

const createAsk = ({ answers, prompts = [], pairTradingEnvironment = TRADING_ENVIRONMENTS.BOTH }) => {
  const remaining = [answers[0], pairTradingEnvironment, ...answers.slice(1)]
  return async (question) => {
    prompts.push(question)
    assert.ok(remaining.length > 0, "The CLI must not ask for more values than the documented interactive flow.")
    return remaining.shift()
  }
}

test("prompts for strategy values, fetches metadata, previews the pair, and writes only after confirmation", async () => {
  const output = []
  const metadataCalls = []
  const writes = []
  const prompts = []
  const result = await runConfigSymbol({
    ask: createAsk({ answers: [" adafdusd ", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""], prompts }),
    writeLine: (line) => output.push(line),
    loadConfig: async () => createAppConfig(),
    metadataFetcher: async (args) => {
      metadataCalls.push(args)
      return metadata
    },
    writeConfig: async (args) => {
      writes.push(args)
      return "/repo/apps/harvester/cg-coin-grabber.js"
    },
    configPath: "/repo/apps/harvester/cg-coin-grabber.js",
  })

  assert.equal(metadataCalls.length, 1, "Valid operator input must trigger one public exchange metadata lookup.")
  assert.equal(metadataCalls[0].symbol, "ADAFDUSD", "The normalized symbol must be sent to Binance.")
  assert.equal(metadataCalls[0].environment, TRADING_ENVIRONMENTS.TESTNET, "Exchange metadata must be fetched from the selected trading environment.")
  assert.ok(prompts.some((question) => /pair trading environment/i.test(question)), "The CLI must require a pair-level tradingEnvironment selection.")
  assert.equal(writes.length, 1, "An affirmative default confirmation must write exactly once.")
  assert.equal(writes[0].symbol, "ADAFDUSD", "The generated configuration must use the normalized symbol.")
  assert.equal(writes[0].pairConfig.enabled, true, "The generated pair must match the enabled config entry expected by the operator.")
  assert.equal(writes[0].pairConfig.tradingEnvironment, TRADING_ENVIRONMENTS.BOTH, "The generated pair must retain the explicitly selected environment eligibility.")
  assert.equal(writes[0].pairConfig.orderQuantity, 20, "The operator-selected quantity must be used for each individual order.")
  assert.equal(writes[0].pairConfig.minProfit, 0.01, "The operator-supplied minimum profit must be preserved.")
  assert.equal(writes[0].pairConfig.priceStepPercent, 0.05, "The operator-supplied price step must be preserved.")
  assert.equal(result.written, true, "The CLI result must report a successful write only after the writer resolves.")
  assert.ok(output.some((line) => line.includes("Configuration preview")), "The operator must see the generated configuration before confirming.")
  assert.ok(output.some((line) => line.includes("cg-coin-grabber.js")), "The operator preview must identify the canonical ESM config module.")
  assert.ok(output.some((line) => line.includes("cg-coin-grabber.js")), "The operator preview must identify the canonical ESM config module.")
  assert.ok(output.some((line) => line.includes('"ADAFDUSD"')), "The preview must be a copyable symbol-keyed config entry.")
  assert.ok(output.some((line) => line.includes('"enabled": true')), "The preview must show the generated pair as enabled.")
  assert.ok(!output.some((line) => line.includes("unvalidatedConstraints") || line.includes("myFilters")), "Internal exchange diagnostics must not clutter the pair-config preview.")
})

test("rejects invalid operator input before making any Binance request", async () => {
  let metadataCalls = 0
  let writes = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "100", "0.1", "0.01", "0.05", ""] }),
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
      ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""] }),
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
      ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""] }),
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

test("uses TRADING_MODE for metadata and separately asks for pair eligibility", async () => {
  const metadataCalls = []
  const result = await runConfigSymbol({
    defaultEnvironment: TRADING_ENVIRONMENTS.LIVE,
    ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", "n"], pairTradingEnvironment: TRADING_ENVIRONMENTS.TESTNET }),
    loadConfig: async () => createAppConfig(),
    metadataFetcher: async (args) => {
      metadataCalls.push(args)
      return { ...metadata, environment: TRADING_ENVIRONMENTS.LIVE }
    },
  })
  assert.equal(metadataCalls.length, 1)
  assert.equal(metadataCalls[0].environment, TRADING_ENVIRONMENTS.LIVE, "TRADING_MODE must continue to select the Binance metadata host independently of pair eligibility.")
  assert.equal(result.pairConfig.tradingEnvironment, TRADING_ENVIRONMENTS.TESTNET, "The pair selector must preserve the separately selected TESTNET eligibility.")
})

test("cancels safely when the operator declines the configuration preview", async () => {
  let writes = 0
  const result = await runConfigSymbol({
    ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", "n"] }),
    loadConfig: async () => createAppConfig(),
    metadataFetcher: async () => metadata,
    writeConfig: async () => {
      writes += 1
    },
  })
  assert.equal(result.written, false, "Declining the preview must return an explicit cancelled result.")
  assert.equal(writes, 0, "Declining the preview must not write or mutate configuration.")
})

test("refuses metadata for a different symbol or exchange environment", async () => {
  for (const invalidMetadata of [
    { ...metadata, symbol: "OTHER" },
    { ...metadata, environment: "live" },
  ]) {
    let writes = 0
    await assert.rejects(
      runConfigSymbol({
        ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""] }),
        loadConfig: async () => createAppConfig(),
        metadataFetcher: async () => invalidMetadata,
        writeConfig: async () => {
          writes += 1
        },
      }),
      /metadata symbol\/environment does not match/i,
      "The generator must not combine operator input with exchange metadata for a different symbol or environment.",
    )
    assert.equal(writes, 0, "Mismatched metadata must never be written into cg-coin-grabber.js.")
  }
})

test("does not write configuration when Binance metadata lookup fails", async () => {
  let writes = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""] }),
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


test("rejects an invalid existing TRADING_MODE instead of silently selecting TESTNET", async () => {
  const previousTradingMode = process.env.TRADING_MODE
  process.env.TRADING_MODE = "paper"
  let metadataCalls = 0
  try {
    await assert.rejects(
      runConfigSymbol({
        ask: createAsk({ answers: ["ADAFDUSD", "100", "20", "0.1", "0", "0.1", "0.01", "0.05", ""] }),
        loadConfig: async () => createAppConfig(),
        metadataFetcher: async () => {
          metadataCalls += 1
          return metadata
        },
      }),
      /environment.*testnet or live/i,
      "An invalid configured runtime mode must not silently generate TESTNET-derived pair settings.",
    )
    assert.equal(metadataCalls, 0, "Invalid TRADING_MODE must fail before any Binance metadata request.")
  } finally {
    if (previousTradingMode === undefined) {
      delete process.env.TRADING_MODE
    } else {
      process.env.TRADING_MODE = previousTradingMode
    }
  }
})
