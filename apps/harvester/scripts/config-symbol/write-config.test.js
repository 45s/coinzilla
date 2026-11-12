import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writePairConfigAtomically } from "./write-config.js"

const createAppConfig = () => ({
  notifications: { telegram: { enabled: true, profile: "trader", markets: [], events: {} } },
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

const generatedPair = {
  enabled: false,
  enableVolatilityProtection: true,
  investment: 100,
  orderQuantity: 200,
  keepQuantity: 0.1,
  minProfit: 0.01,
  priceStepPercent: 0.05,
  pricePrecision: 4,
  quantityPrecision: 1,
  makerPercent: 0,
  takerPercent: 0.1,
}

async function withConfigFile(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-config-symbol-"))
  const configPath = path.join(directory, "config.json")
  await writeFile(configPath, JSON.stringify(createAppConfig(), null, 2) + "\n", "utf8")
  try {
    await run({ directory, configPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("atomically merges a new pair while preserving existing app settings and cleaning temporary files", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const result = await writePairConfigAtomically({
      configPath,
      symbol: "ADAFDUSD",
      pairConfig: generatedPair,
    })
    const written = JSON.parse(await readFile(configPath, "utf8"))
    const files = await readdir(directory)

    assert.equal(result, configPath, "The writer must return the exact configuration path it updated.")
    assert.deepEqual(written.strategies.CG_coinGrabber.pairs.ADAFDUSD, generatedPair, "The new pair must be persisted under the canonical pair map.")
    assert.deepEqual(written.strategies.CG_coinGrabber.pairs.LINKFDUSD, createAppConfig().strategies.CG_coinGrabber.pairs.LINKFDUSD, "Existing pairs must remain unchanged.")
    assert.deepEqual(written.notifications, createAppConfig().notifications, "Unrelated app configuration must be preserved.")
    assert.deepEqual(files, ["config.json"], "Successful writes must remove the lock and temporary files.")
  })
})

test("cleans abandoned temporary files only after acquiring the generator lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const staleTemporaryPath = path.join(directory, ".config.json.abandoned.tmp")
    await writeFile(staleTemporaryPath, "partial configuration", "utf8")
    await writePairConfigAtomically({
      configPath,
      symbol: "ADAFDUSD",
      pairConfig: generatedPair,
    })
    assert.deepEqual(await readdir(directory), ["config.json"], "A subsequent locked generation must remove only abandoned generator temporary files.")
  })
})

test("refuses to overwrite an existing pair and leaves the original file byte-for-byte unchanged", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({
        configPath,
        symbol: "LINKFDUSD",
        pairConfig: generatedPair,
      }),
      /already exists/i,
      "A pre-existing pair must never be replaced by the generator.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A rejected overwrite must leave the original configuration untouched.")
    assert.deepEqual(await readdir(directory), ["config.json"], "A rejected write must clean up its lock file.")
  })
})

test("fails closed when another generator already owns the configuration lock", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    const lockPath = configPath + ".config-symbol.lock"
    await writeFile(lockPath, "owned", "utf8")
    const before = await readFile(configPath, "utf8")
    await assert.rejects(
      writePairConfigAtomically({
        configPath,
        symbol: "ADAFDUSD",
        pairConfig: generatedPair,
      }),
      /configuration lock/i,
      "Concurrent generators must not race while replacing config.json.",
    )
    assert.equal(await readFile(configPath, "utf8"), before, "A lock conflict must not modify configuration.")
    assert.deepEqual((await readdir(directory)).sort(), ["config.json", "config.json.config-symbol.lock"], "A lock owned by another process must not be removed.")
  })
})

test("rejects malformed existing configuration without replacing it", async () => {
  await withConfigFile(async ({ directory, configPath }) => {
    await writeFile(configPath, "{ invalid", "utf8")
    await assert.rejects(
      writePairConfigAtomically({
        configPath,
        symbol: "ADAFDUSD",
        pairConfig: generatedPair,
      }),
      /not valid JSON/i,
      "The generator must not repair or overwrite malformed operator configuration implicitly.",
    )
    assert.equal(await readFile(configPath, "utf8"), "{ invalid", "Malformed existing configuration must remain untouched for operator repair.")
    assert.deepEqual(await readdir(directory), ["config.json"], "Failed validation must release the lock and leave no temporary file.")
  })
})
