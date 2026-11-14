import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writePairConfigAtomically } from "./write-config.js"

const generatedPair = {
  enabled: true,
  enableVolatilityProtection: true,
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

function createConfigSource() {
  return [
    "// This operator-maintained comment must survive pair generation.",
    "export const CG_COIN_GRABBER_CONFIG = {",
    "  enabled: true,",
    "  settings: {",
    "    conservative: { enabled: true },",
    "    aggressive: { enabled: false },",
    "    recovery: { enabled: false },",
    "  },",
    "  pairs: {",
    '    "LINKFDUSD": {',
    "      enabled: true,",
    "      enableVolatilityProtection: true,",
    "      investment: 200,",
    "      orderQuantity: 2,",
    "      keepQuantity: 0.01,",
    "      minProfit: 0.01,",
    "      priceStepPercent: 0.3,",
    "      pricePrecision: 3,",
    "      quantityPrecision: 2,",
    "      makerPercent: 0,",
    "      takerPercent: 0.075,",
    "    },",
    "  },",
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
  return (await import(url.href)).CG_COIN_GRABBER_CONFIG
}

test("atomically merges a pair while preserving imports, comments, unrelated settings, and cleanups", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const result = await writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair })
    const writtenSource = await readFile(configPath, "utf8")
    const written = await readConfig(configPath)
    const files = (await readdir(directory)).sort()

    assert.equal(result, configPath, "The writer must return the exact configuration module path it updated.")
    assert.deepEqual(written.pairs.ADAFDUSD, generatedPair, "The new pair must be persisted under the canonical strategy pair map.")
    assert.deepEqual(
      written.pairs.LINKFDUSD,
      {
        enabled: true,
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
      "The pre-existing pair must remain unchanged after another pair is added.",
    )
    assert.deepEqual(written.settings.recovery.enabled, false, "The extracted strategy module must preserve its disabled recovery setting.")
    assert.ok(writtenSource.includes("export const CG_COIN_GRABBER_CONFIG"), "The named strategy export must remain intact after pair generation.")
    assert.ok(writtenSource.includes("// This operator-maintained comment must survive pair generation."), "Comments outside the pairs object must remain intact.")
    assert.ok(writtenSource.includes('"ADAFDUSD": {'), "The new pair must be inserted directly into the existing pairs object.")
    assert.ok(writtenSource.includes('"LINKFDUSD": {'), "The existing pair source must remain present after insertion.")
    assert.equal(writtenSource.includes("GENERATED PAIR"), false, "Pair generation must not require or introduce marker comments.")
    assert.deepEqual(files, ["cg-coin-grabber.mjs"], "Successful writes must remove their lock and temporary module files.")
  })
})

test("cleans abandoned JavaScript temporary modules only after acquiring the generator lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    await writeFile(path.join(directory, ".cg-coin-grabber.mjs.abandoned.tmp.mjs"), "partial configuration", "utf8")
    await writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair })
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["cg-coin-grabber.mjs"],
      "A successful locked generation must remove abandoned temporary modules without deleting unrelated files.",
    )
  })
})

test("refuses to overwrite an existing pair and leaves the original module byte-for-byte unchanged", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "LINKFDUSD", pairConfig: generatedPair }),
      /already exists/i,
      "A pre-existing pair must never be replaced by the generator.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A rejected overwrite must leave the original configuration source untouched.")
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["cg-coin-grabber.mjs"],
      "A rejected write must release its lock without leaving a temporary module.",
    )
  })
})

test("fails closed when another generator already owns the configuration lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const lockPath = configPath + ".config-symbol.lock"
    await writeFile(lockPath, "owned", "utf8")
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /configuration lock/i,
      "Concurrent generators must not race while replacing the configuration module.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A lock conflict must not modify the source module.")
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["cg-coin-grabber.mjs", "cg-coin-grabber.mjs.config-symbol.lock"],
      "A lock owned by another process must not be removed.",
    )
  })
})

test("rejects malformed JavaScript without replacing the operator's original source", async () => {
  await withConfigFile(async ({ configPath }) => {
    await writeFile(configPath, "export const CG_COIN_GRABBER_CONFIG = {", "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /unable to load|syntax|parse/i,
      "Malformed ESM configuration must be rejected before any replacement is written.",
    )
    assert.equal(
      await readFile(configPath, "utf8"),
      "export const CG_COIN_GRABBER_CONFIG = {",
      "Malformed operator configuration must remain untouched for manual repair.",
    )
  })
})

test("rejects an ambiguous pairs object without changing the original source module", async () => {
  const source = createConfigSource().replace("\n};\n", "\n  pairs: {},\n};\n")
  await withConfigFile(async ({ configPath }) => {
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /ambiguous|exactly one/i,
      "The generator must reject multiple strategy pairs objects instead of choosing one arbitrarily.",
    )
    assert.equal(
      await readFile(configPath, "utf8"),
      before,
      "An ambiguous configuration must remain byte-for-byte unchanged after the rejected generation.",
    )
  }, { source })
})
