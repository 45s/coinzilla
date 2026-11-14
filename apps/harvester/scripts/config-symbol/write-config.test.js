import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writePairConfigAtomically } from "./write-config.js"
import { EXTERNAL_ORDERS_POLICIES } from "../../src/domain/external-orders-policy.js"
import { TRADING_ENVIRONMENTS } from "../../src/domain/trading-environment.js"

const generatedPair = {
  enabled: true,
  tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
  enableVolatilityProtection: true,
  externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE,
  investment: 100,
  orderQuantity: 20,
  keepQuantity: 0.1,
  minProfit: 0.01,
  priceStepPercent: 0.05,
  pricePrecision: 4,
  quantityPrecision: 1,
  makerPercent: 0,
  takerPercent: 0.1,
}
const existingPair = {
  ...generatedPair,
  enabled: true,
  investment: 200,
  orderQuantity: 2,
  keepQuantity: 0.01,
  priceStepPercent: 0.3,
  pricePrecision: 3,
  quantityPrecision: 2,
  takerPercent: 0.075,
}
const createConfigSource = () => {
  const environmentImport = new URL("../../src/domain/trading-environment.js", import.meta.url).href
  const policyImport = new URL("../../src/domain/external-orders-policy.js", import.meta.url).href
  const existingPairSource = JSON.stringify(existingPair, null, 2)
    .replace('"tradingEnvironment": "both"', "tradingEnvironment: TRADING_ENVIRONMENTS.BOTH")
    .replace('"externalOrdersPolicy": "ignore"', "externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE")
  return [
    `import { TRADING_ENVIRONMENTS } from "${environmentImport}"`,
    `import { EXTERNAL_ORDERS_POLICIES } from "${policyImport}"`,
    "// This operator-maintained comment must survive pair generation.",
    "export const tradingPairs = {",
    `  LINKFDUSD: ${existingPairSource.replaceAll("\n", "\n  ")},`,
    "};",
    "",
  ].join("\n")
}

async function withConfigFile(run, { source = createConfigSource() } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-config-symbol-"))
  const configPath = path.join(directory, "cg-coin-grabber.mjs")
  await writeFile(configPath, source, "utf8")
  try {
    await run({ directory, configPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function readConfig(configPath) {
  const url = pathToFileURL(configPath)
  url.searchParams.set("test-load", randomUUID())
  return (await import(url.href)).tradingPairs
}

test("atomically adds a pair while preserving the existing map and cleaning temporary files", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const result = await writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair })
    const writtenSource = await readFile(configPath, "utf8")
    const written = await readConfig(configPath)
    assert.equal(result, configPath, "The writer must return the exact external config path it updated.")
    assert.deepEqual(written.ADAFDUSD, generatedPair, "The new pair must be persisted under its symbol in tradingPairs.")
    assert.deepEqual(written.LINKFDUSD, existingPair, "The existing pair must remain unchanged after another symbol is added.")
    assert.ok(writtenSource.includes("export const tradingPairs"), "The external module must retain its named tradingPairs export.")
    assert.ok(writtenSource.includes("// This operator-maintained comment must survive pair generation."), "Operator comments must survive generation.")
    assert.deepEqual((await readdir(directory)).sort(), ["cg-coin-grabber.mjs"], "Successful writes must clean lock and temporary files.")
  })
})

test("refuses to overwrite an existing symbol without changing the external config", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "LINKFDUSD", pairConfig: generatedPair }),
      /already exists/i,
      "The generator must never overwrite an existing market configuration.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A rejected duplicate must leave the source byte-for-byte unchanged.")
    assert.deepEqual((await readdir(directory)).sort(), ["cg-coin-grabber.mjs"], "A rejected duplicate must release its lock.")
  })
})

test("fails closed when another generator owns the configuration lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const lockPath = `${configPath}.config-symbol.lock`
    await writeFile(lockPath, "owned", "utf8")
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /configuration lock/i,
      "Concurrent pair generation must fail rather than race on the same external config.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A lock conflict must not modify the external config.")
    assert.deepEqual((await readdir(directory)).sort(), ["cg-coin-grabber.mjs", "cg-coin-grabber.mjs.config-symbol.lock"], "A lock owned by another process must not be removed.")
  })
})

test("rejects malformed JavaScript without replacing the operator's original source", async () => {
  await withConfigFile(async ({ configPath }) => {
    await writeFile(configPath, "export const tradingPairs = {", "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /unable to load|syntax|parse/i,
      "Malformed external configuration must be rejected before a replacement is written.",
    )
    assert.equal(await readFile(configPath, "utf8"), "export const tradingPairs = {", "Malformed operator config must remain untouched for manual repair.")
  })
})
