import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { loadAppConfig } from "../../../src/infrastructure/config/load-app-config.js"

function createValidConfig() {
  return {
    notifications: {
      telegram: {
        enabled: true,
        profile: "trader",
        markets: [],
        events: {},
      },
    },
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
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 200,
            orderQuantity: 2,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.3,
            makerPercent: 0,
            takerPercent: 0.075,
          },
        },
      },
    },
  }
}

function createConfigModule(config) {
  return `export const appConfig = ${JSON.stringify(config, null, 2)};\n`
}

function createTokenSpecifications() {
  return {
    LINK: {
      baseAsset: "LINK",
      markets: {
        LINKFDUSD: {
          quoteAsset: "FDUSD",
          pricePrecision: 3,
          quantityPrecision: 2,
        },
      },
    },
  }
}

function assertAppConfigStructure(config) {
  assert.ok(config && typeof config === "object" && !Array.isArray(config), "The named appConfig export must be an object.")
  assert.ok(config.strategies && typeof config.strategies === "object", "The app config must contain strategy-owned settings.")
  assert.ok(config.strategies.CG_coinGrabber, "The app config must contain the CG_coinGrabber strategy.")
  assert.equal(Object.hasOwn(config, "runtime"), false, "Exchange-mode profiles must not be stored in the app config module.")

  const strategy = config.strategies.CG_coinGrabber
  assert.equal(typeof strategy.enabled, "boolean", "The strategy must expose its enabled state.")
  assert.ok(strategy.settings && typeof strategy.settings === "object", "The strategy must contain its settings.")
  assert.ok(strategy.pairs && typeof strategy.pairs === "object" && !Array.isArray(strategy.pairs), "The strategy must contain a pair map.")
  assert.ok(Object.keys(strategy.pairs).length > 0, "The strategy must contain at least one pair.")

  for (const pair of Object.values(strategy.pairs)) {
    assert.ok(pair && typeof pair === "object" && !Array.isArray(pair), "Each market pair must be an object.")
    assert.equal(typeof pair.enabled, "boolean", "Each pair must expose its enabled state.")
    assert.ok(["testnet", "live", "both"].includes(pair.tradingEnvironment), "Each pair must declare its explicit trading environment.")
    for (const key of [
      "investment",
      "orderQuantity",
      "keepQuantity",
      "priceStepPercent",
      "pricePrecision",
      "quantityPrecision",
      "makerPercent",
      "takerPercent",
    ]) {
      assert.ok(Object.hasOwn(pair, key), `The effective runtime pair must contain ${key}.`)
    }
  }
}

async function writeTokenSpecifications({ directory, specifications = createTokenSpecifications() }) {
  const path = join(directory, "token-specification.json")
  await writeFile(path, `${JSON.stringify(specifications, null, 2)}\n`, "utf8")
  return path
}

test("loads the default config and resolves pair precision from the shared token registry", async () => {
  const config = await loadAppConfig()
  assertAppConfigStructure(config)
  assert.equal(config.strategies.CG_coinGrabber.pairs.LINKFDUSD.pricePrecision, 3, "The default market price precision must come from token-specification.json.")
  assert.equal(config.strategies.CG_coinGrabber.pairs.LINKFDUSD.quantityPrecision, 2, "The default market quantity precision must come from token-specification.json.")
})

test("loads a named appConfig module and applies a supplied token registry", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory })

  const config = await loadAppConfig({ source: configPath, tokenSpecificationsPath })
  assertAppConfigStructure(config)
})

test("loads a named appConfig module from a file URL", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory })

  const config = await loadAppConfig({ source: pathToFileURL(configPath), tokenSpecificationsPath })
  assertAppConfigStructure(config)
})

test("fails closed when a configured market has no token specification", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory, specifications: {} })

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    /missing token specification.*LINKFDUSD/i,
    "A configured market without authoritative precision metadata must not reach runtime validation.",
  )
})

test("rejects malformed token registry JSON with its source path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  const tokenSpecificationsPath = join(directory, "token-specification.json")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")
  await writeFile(tokenSpecificationsPath, "{", "utf8")

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    (error) => error instanceof Error && error.message.includes(tokenSpecificationsPath),
    "Malformed token metadata must identify the file that prevented startup.",
  )
})

test("preserves the one-argument filesystem path API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")

  const config = await loadAppConfig(configPath)
  assertAppConfigStructure(config)
})

test("reports a missing token registry path before configuration validation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "config.mjs")
  const tokenSpecificationsPath = join(directory, "missing-token-specification.json")
  await writeFile(configPath, createConfigModule(createValidConfig()), "utf8")

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    (error) => error instanceof Error && error.message.includes(tokenSpecificationsPath),
    "A missing token registry must identify its expected path."
  )
})

test("rejects invalid loader options before importing the config module", async () => {
  await assert.rejects(
    loadAppConfig(null),
    /options.*file URL, path, or options object/i,
    "Invalid loader input must fail with a clear options error."
  )
  await assert.rejects(
    loadAppConfig({ tokenSpecificationsPath: 42 }),
    /tokenSpecificationsPath.*non-empty/i,
    "The registry path must be a non-empty string."
  )
})

test("reports the source path and preserves the syntax cause for malformed JavaScript", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "invalid.mjs")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory })
  await writeFile(configPath, "export const appConfig = {", "utf8")

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    (error) => error instanceof SyntaxError
      && error.message.includes(configPath)
      && error.cause instanceof SyntaxError,
    "Malformed ESM configuration must identify its source path and preserve the module parser cause.",
  )
})

test("reports a useful error when the config module does not exist", async () => {
  const missingPath = join(tmpdir(), "missing-harvester-config.mjs")
  await assert.rejects(
    loadAppConfig(missingPath),
    (error) => error instanceof Error && error.message.includes(missingPath),
    "A missing ESM config module must produce a path-specific load error.",
  )
})

test("rejects a module that does not export the named appConfig value", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "missing-export.mjs")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory })
  await writeFile(configPath, "export const otherConfig = {};", "utf8")

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    /must export a named appConfig/i,
    "A module without the required named appConfig value must fail clearly.",
  )
})

test("rejects structurally invalid named appConfig exports", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, "invalid-shape.mjs")
  const tokenSpecificationsPath = await writeTokenSpecifications({ directory })
  await writeFile(configPath, createConfigModule({ strategies: {} }), "utf8")

  await assert.rejects(
    loadAppConfig({ source: configPath, tokenSpecificationsPath }),
    /CG_coinGrabber/,
    "An ESM module with an invalid appConfig shape must fail runtime validation before startup.",
  )
})
