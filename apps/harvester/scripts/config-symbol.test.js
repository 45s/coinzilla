import test from "node:test"
import assert from "node:assert/strict"
import { runConfigSymbol } from "./config-symbol.js"

const metadata = {
  symbol: "POLUSDT",
  environment: "testnet",
  baseAsset: "POL",
  quoteAsset: "USDT",
  tickSize: "0.0001",
  stepSize: "0.01",
  unvalidatedConstraints: [{ type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE" }],
}

function createAsk({ answers, prompts = [] }) {
  return async (question) => {
    prompts.push(question)
    assert.ok(answers.length > 0, "The generator must not request strategy settings or other unplanned input.")
    return answers.shift()
  }
}

test("fetches market metadata and writes only the shared token specification after confirmation", async () => {
  const output = []
  const prompts = []
  const metadataCalls = []
  const writes = []
  const result = await runConfigSymbol({
    ask: createAsk({ answers: [" polusdt ", ""], prompts }),
    writeLine: (line) => output.push(line),
    defaultEnvironment: "testnet",
    metadataFetcher: async (args) => {
      metadataCalls.push(args)
      return metadata
    },
    writeSpecification: async (args) => {
      writes.push(args)
      return "/repo/apps/harvester/token-specification.json"
    },
    specificationPath: "/repo/apps/harvester/token-specification.json",
  })

  assert.equal(prompts.length, 2, "The generator should ask only for a market symbol and confirmation.")
  assert.match(prompts[0], /market symbol/i, "The first prompt must request the Binance market symbol.")
  assert.match(prompts[1], /add or refresh.*token specification/i, "The final prompt must confirm a token metadata update.")
  assert.deepEqual(metadataCalls, [{ symbol: "POLUSDT", environment: "testnet", fetchImpl: globalThis.fetch }], "The generator must fetch metadata for the normalized symbol from the selected public endpoint.")
  assert.equal(writes.length, 1, "Confirmation must trigger exactly one token-specification write.")
  assert.equal(writes[0].metadata, metadata, "The writer must receive the original validated exchange metadata.")
  assert.equal(writes[0].specificationPath, "/repo/apps/harvester/token-specification.json", "The writer must target the shared token metadata file.")
  assert.equal(result.written, true, "The result must report a write only after the writer succeeds.")
  assert.equal(result.symbol, "POLUSDT", "The result must retain the normalized market symbol.")
  assert.equal(result.baseAsset, "POL", "The result must identify the base token returned by Binance.")
  assert.equal(result.marketSpecification.pricePrecision, 4, "Price precision must be derived from PRICE_FILTER.tickSize.")
  assert.equal(result.marketSpecification.quantityPrecision, 2, "Quantity precision must be derived from LOT_SIZE.stepSize.")
  assert.ok(output.some((line) => line.includes("token-specification.json")), "The preview must identify the shared token specification file.")
  assert.ok(output.some((line) => line.includes('"POL"')), "The preview must be grouped under the base token.")
  assert.ok(output.some((line) => line.includes("DYNAMIC_PRICE_BAND")), "Public exchange constraints that the generator does not evaluate must remain visible as diagnostics.")
  assert.ok(!output.some((line) => line.includes("investment") || line.includes("makerPercent")), "The metadata generator must not request or generate strategy settings.")
})

test("uses TRADING_MODE only to select the public metadata endpoint", async () => {
  const metadataCalls = []
  await runConfigSymbol({
    ask: createAsk({ answers: ["APEUSDT", "n"] }),
    defaultEnvironment: "live",
    metadataFetcher: async (args) => {
      metadataCalls.push(args)
      return { ...metadata, symbol: "APEUSDT", baseAsset: "APE", environment: "live" }
    },
  })
  assert.equal(metadataCalls[0].environment, "live", "The current trading mode must select the metadata host.")
})

test("cancels without writing when the operator declines the metadata preview", async () => {
  let writes = 0
  const result = await runConfigSymbol({
    ask: createAsk({ answers: ["POLUSDT", "n"] }),
    metadataFetcher: async () => metadata,
    writeSpecification: async () => {
      writes += 1
    },
  })
  assert.equal(result.written, false, "Declining the preview must return an explicit cancelled result.")
  assert.equal(writes, 0, "Declining the preview must leave the token specification file unchanged.")
})

test("rejects invalid symbols before requesting exchange metadata", async () => {
  let metadataCalls = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk({ answers: ["POL/USDT", ""] }),
      metadataFetcher: async () => {
        metadataCalls += 1
        return metadata
      },
    }),
    /symbol/i,
    "Malformed symbols must be rejected before a public metadata request.",
  )
  assert.equal(metadataCalls, 0, "Invalid input must not contact Binance.")
})

test("rejects metadata for another symbol or environment without writing", async () => {
  for (const invalidMetadata of [
    { ...metadata, symbol: "OTHER" },
    { ...metadata, environment: "live" },
  ]) {
    let writes = 0
    await assert.rejects(
      runConfigSymbol({
        ask: createAsk({ answers: ["POLUSDT", ""] }),
        metadataFetcher: async () => invalidMetadata,
        writeSpecification: async () => {
          writes += 1
        },
      }),
      /metadata symbol\/environment does not match/i,
      "Metadata for another market or environment must never enter the registry.",
    )
    assert.equal(writes, 0, "Mismatched metadata must not be persisted.")
  }
})

test("surfaces Binance metadata failures and leaves the registry untouched", async () => {
  let writes = 0
  await assert.rejects(
    runConfigSymbol({
      ask: createAsk({ answers: ["POLUSDT", ""] }),
      metadataFetcher: async () => { throw new Error("Binance unavailable") },
      writeSpecification: async () => { writes += 1 },
    }),
    /Binance unavailable/,
    "Public metadata failures must remain visible to the operator.",
  )
  assert.equal(writes, 0, "Failed metadata retrieval must not modify the token registry.")
})
