import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAppConfig } from "../../../src/infrastructure/config/load-app-config.mjs"

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
  }
}

function createConfigModule(config) {
  return "export const appConfig = " + JSON.stringify(config, null, 2) + ";\n"
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
      assert.ok(Object.hasOwn(pair, key), "Each pair must contain the required setting " + key + ".")
    }
  }
}

test("loads and validates the default named ESM app config export", async () => {
  const config = await loadAppConfig()
  assertAppConfigStructure(config)
})

test("loads a named appConfig export from a supplied JavaScript path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  const path = join(directory, "config.mjs")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, createConfigModule(createValidConfig()), "utf8")

  const config = await loadAppConfig(path)
  assertAppConfigStructure(config)
})

test("loads a named appConfig export from a supplied file URL", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  const path = join(directory, "config.mjs")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, createConfigModule(createValidConfig()), "utf8")

  const config = await loadAppConfig(new URL("file://" + path))
  assertAppConfigStructure(config)
})

test("reports the source path and preserves the syntax cause for malformed JavaScript", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  const path = join(directory, "invalid.mjs")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, "export const appConfig = {", "utf8")

  await assert.rejects(
    loadAppConfig(path),
    (error) => error instanceof SyntaxError
      && error.message.includes(path)
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
  const path = join(directory, "missing-export.mjs")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, "export const otherConfig = {};", "utf8")

  await assert.rejects(
    loadAppConfig(path),
    /must export a named appConfig/i,
    "A module without the required named appConfig export must fail clearly instead of being treated as an empty configuration.",
  )
})

test("rejects structurally invalid named appConfig exports", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "app-config-"))
  const path = join(directory, "invalid-shape.mjs")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, createConfigModule({ strategies: {} }), "utf8")

  await assert.rejects(
    loadAppConfig(path),
    /CG_coinGrabber/,
    "An ESM module with an invalid appConfig shape must fail runtime validation before startup.",
  )
})
