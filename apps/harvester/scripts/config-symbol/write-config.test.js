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
    'import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.mjs";',
    "// This operator-maintained comment must survive pair generation.",
    "export const appConfig = {",
    "  notifications: {",
    "    telegram: {",
    "      enabled: true,",
    "      profile: NOTIFICATIONS_TG_PROFILES.TRADER,",
    "      markets: [],",
    "      events: {},",
    "    },",
    "  },",
    "  strategies: {",
    "    CG_coinGrabber: {",
    "      enabled: true,",
    "      settings: {",
    "        conservative: { enabled: true },",
    "        aggressive: { enabled: false },",
    "      },",
    "      pairs: {",
    "        // BEGIN GENERATED PAIR CONFIGURATION",
    '        "LINKFDUSD": {',
    "          enabled: true,",
    "          enableVolatilityProtection: true,",
    "          investment: 200,",
    "          orderQuantity: 2,",
    "          keepQuantity: 0.01,",
    "          minProfit: 0.01,",
    "          priceStepPercent: 0.3,",
    "          pricePrecision: 3,",
    "          quantityPrecision: 2,",
    "          makerPercent: 0,",
    "          takerPercent: 0.075,",
    "        },",
    "        // END GENERATED PAIR CONFIGURATION",
    "      },",
    "    },",
    "  },",
    "};",
    "",
  ].join("\n")
}

async function withConfigFile(run, { source = createConfigSource() } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-config-symbol-"))
  const configPath = path.join(directory, "index.mjs")
  await writeFile(configPath, source, "utf8")
  await writeFile(
    path.join(directory, "notifications-tg-profiles.mjs"),
    'export const NOTIFICATIONS_TG_PROFILES = Object.freeze({ TRADER: "trader" });\n',
    "utf8",
  )
  try {
    await run({ directory, configPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function readConfig(configPath) {
  const url = pathToFileURL(configPath)
  url.searchParams.set("test-load", randomUUID())
  return (await import(url.href)).appConfig
}

test("atomically merges a pair while preserving imports, comments, unrelated settings, and cleanups", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const result = await writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair })
    const writtenSource = await readFile(configPath, "utf8")
    const written = await readConfig(configPath)
    const files = (await readdir(directory)).sort()

    assert.equal(result, configPath, "The writer must return the exact configuration module path it updated.")
    assert.deepEqual(written.strategies.CG_coinGrabber.pairs.ADAFDUSD, generatedPair, "The new pair must be persisted under the canonical strategy pair map.")
    assert.deepEqual(
      written.strategies.CG_coinGrabber.pairs.LINKFDUSD,
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
    assert.deepEqual(written.notifications.telegram.profile, "trader", "The named profile import must resolve to the original profile identifier.")
    assert.ok(writtenSource.includes('import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.mjs";'), "The profile-module import must remain intact after pair generation.")
    assert.ok(writtenSource.includes("// This operator-maintained comment must survive pair generation."), "Comments outside the generated pair region must remain intact.")
    assert.deepEqual(files, ["index.mjs", "notifications-tg-profiles.mjs"], "Successful writes must remove their lock and temporary module files.")
  })
})

test("cleans abandoned JavaScript temporary modules only after acquiring the generator lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    await writeFile(path.join(directory, ".index.mjs.abandoned.tmp.mjs"), "partial configuration", "utf8")
    await writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair })
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["index.mjs", "notifications-tg-profiles.mjs"],
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
      ["index.mjs", "notifications-tg-profiles.mjs"],
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
      ["index.mjs", "index.mjs.config-symbol.lock", "notifications-tg-profiles.mjs"],
      "A lock owned by another process must not be removed.",
    )
  })
})

test("rejects malformed JavaScript without replacing the operator's original source", async () => {
  await withConfigFile(async ({ configPath }) => {
    await writeFile(configPath, "export const appConfig = {", "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /unable to load|syntax|parse/i,
      "Malformed ESM configuration must be rejected before any replacement is written.",
    )
    assert.equal(
      await readFile(configPath, "utf8"),
      "export const appConfig = {",
      "Malformed operator configuration must remain untouched for manual repair.",
    )
  })
})

test("rejects a missing generated-pair marker without changing the source module", async () => {
  const source = createConfigSource().replace("// BEGIN GENERATED PAIR CONFIGURATION", "// PAIR REGION REMOVED")
  await withConfigFile(async ({ configPath }) => {
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({ configPath, symbol: "ADAFDUSD", pairConfig: generatedPair }),
      /marker/i,
      "The generator must fail closed when the canonical pair-edit region is absent.",
    )
    assert.equal(
      await readFile(configPath, "utf8"),
      before,
      "A missing pair marker must leave the entire configuration source byte-for-byte unchanged.",
    )
  }, { source })
})
