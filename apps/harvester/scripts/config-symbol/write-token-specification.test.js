import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writeTokenSpecificationAtomically } from "./write-token-specification.js"

const metadata = (overrides = {}) => ({
  symbol: "LINKUSDT",
  baseAsset: "LINK",
  quoteAsset: "USDT",
  tickSize: "0.001",
  stepSize: "0.01",
  ...overrides,
})

async function withSpecification({ run, initial = {} }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-token-specification-"))
  const specificationPath = path.join(directory, "token-specification.json")
  await writeFile(specificationPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8")
  try {
    await run({ directory, specificationPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("atomically adds a market under its base token and preserves other specifications", async () => {
  const initial = {
    POL: {
      baseAsset: "POL",
      markets: {
        POLUSDT: { quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1 },
      },
    },
  }
  await withSpecification({
    run: async ({ directory, specificationPath }) => {
      const result = await writeTokenSpecificationAtomically({ specificationPath, metadata: metadata() })
      const written = JSON.parse(await readFile(specificationPath, "utf8"))
      assert.equal(result, specificationPath, "The writer must return the exact token specification path it updated.")
      assert.deepEqual(written.LINK.markets.LINKUSDT, {
        quoteAsset: "USDT",
        pricePrecision: 3,
        quantityPrecision: 2,
      }, "The new market must be persisted beneath its base token.")
      assert.deepEqual(written.POL, initial.POL, "Existing token metadata must remain unchanged.")
      assert.deepEqual((await readdir(directory)).sort(), ["token-specification.json"], "Successful writes must clean lock and temporary files.")
    },
    initial,
  })
})

test("updates one existing market without replacing sibling markets", async () => {
  const initial = {
    LINK: {
      baseAsset: "LINK",
      markets: {
        LINKUSDT: { quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 },
        LINKFDUSD: { quoteAsset: "FDUSD", pricePrecision: 3, quantityPrecision: 2 },
      },
    },
  }
  await withSpecification({
    run: async ({ specificationPath }) => {
      await writeTokenSpecificationAtomically({
        specificationPath,
        metadata: metadata({ tickSize: "0.0001" }),
      })
      const written = JSON.parse(await readFile(specificationPath, "utf8"))
      assert.equal(written.LINK.markets.LINKUSDT.pricePrecision, 4, "The requested market's metadata must be refreshed.")
      assert.deepEqual(written.LINK.markets.LINKFDUSD, initial.LINK.markets.LINKFDUSD, "A refresh must preserve sibling markets.")
    },
    initial,
  })
})

test("fails closed when another metadata generator owns the registry lock", async () => {
  await withSpecification({
    run: async ({ directory, specificationPath }) => {
      const lockPath = `${specificationPath}.config-symbol.lock`
      await writeFile(lockPath, "owned", "utf8")
      const before = await readFile(specificationPath, "utf8")
      await assert.rejects(
        writeTokenSpecificationAtomically({ specificationPath, metadata: metadata() }),
        /token specification lock/i,
        "Concurrent token registry updates must not race.",
      )
      assert.equal(await readFile(specificationPath, "utf8"), before, "A lock conflict must not change the registry.")
      assert.deepEqual((await readdir(directory)).sort(), ["token-specification.json", "token-specification.json.config-symbol.lock"], "A lock owned by another process must not be removed.")
    },
  })
})

test("creates a missing registry and removes stale temporary files while holding the lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-token-specification-"))
  const specificationPath = path.join(directory, "token-specification.json")
  const staleTemporaryPath = path.join(directory, ".token-specification.json.stale.tmp.json")
  try {
    await writeFile(staleTemporaryPath, "stale", "utf8")
    await writeTokenSpecificationAtomically({ specificationPath, metadata: metadata() })
    const written = JSON.parse(await readFile(specificationPath, "utf8"))
    assert.deepEqual(written.LINK.markets.LINKUSDT, {
      quoteAsset: "USDT",
      pricePrecision: 3,
      quantityPrecision: 2,
    }, "The writer must create a valid registry when the target file does not exist.")
    assert.deepEqual(await readdir(directory), ["token-specification.json"], "Stale temporary files and the active lock must be removed after an atomic write.")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects an empty specification path before acquiring a lock", async () => {
  await assert.rejects(
    writeTokenSpecificationAtomically({ specificationPath: " ", metadata: metadata() }),
    /specificationPath.*non-empty/i,
    "The writer must reject an invalid destination before filesystem changes."
  )
})

test("rejects malformed existing JSON without replacing the operator's file", async () => {
  await withSpecification({
    run: async ({ specificationPath }) => {
      await writeFile(specificationPath, "{", "utf8")
      await assert.rejects(
        writeTokenSpecificationAtomically({ specificationPath, metadata: metadata() }),
        /unable to read|valid JSON/i,
        "Malformed registry JSON must be surfaced rather than silently replaced.",
      )
      assert.equal(await readFile(specificationPath, "utf8"), "{", "A malformed registry must remain untouched for manual repair.")
    },
  })
})
