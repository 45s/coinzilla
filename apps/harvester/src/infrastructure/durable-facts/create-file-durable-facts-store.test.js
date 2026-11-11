import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import * as fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "./create-file-durable-facts-store.js"

const createDirectory = () => mkdtemp(path.join(os.tmpdir(), "harvester-durable-facts-"))
const createStore = (directory, options = {}) => createFileDurableFactsStore({
  directory,
  runtimeSessionId: "runtime-session-1",
  now: () => new Date("2026-11-11T12:00:00.000Z"),
  ...options,
})
const operatorPause = (overrides = {}) => ({
  factId: "operator-control:request-1",
  factType: "OPERATOR_MARKET_PAUSED",
  data: { requestId: "request-1", actorId: "telegram-actor-1", symbol: "BTCUSDT" },
  ...overrides,
})
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}
const canonicalStringify = (value) => JSON.stringify(canonicalize(value))
const digestRecord = (record) => {
  const { digest, ...body } = record
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex")
}
const readLines = async (filePath) => (await readFile(filePath, "utf8")).trimEnd().split("\n")
const readManifestRecords = async (directory) => (await readLines(path.join(directory, "manifest.jsonl"))).map(JSON.parse)

test("normal verification and append never initialize a missing durable-fact store", async (t) => {
  const directory = path.join(os.tmpdir(), "harvester-durable-facts-missing-" + process.pid + "-" + Date.now())
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  const append = await store.append(operatorPause())
  assert.equal(append.ok, false)
  await assert.rejects(readdir(directory), { code: "ENOENT" })
})

test("explicit initialization writes a genesis fact and committed-head manifest checkpoint", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true)
  assert.equal(initialized.data.durable, true)
  const records = await store.readAll()
  assert.equal(records.ok, true)
  assert.equal(records.data.records.length, 1)
  assert.equal(records.data.records[0].sequence, "0")
  assert.equal(records.data.records[0].factType, "LEDGER_INITIALIZED")
  const manifests = await readManifestRecords(directory)
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].sequence, "0")
  assert.equal(manifests[0].lastCommittedDigest, records.data.records[0].digest)
  assert.equal(manifests[0].digest, digestRecord(manifests[0]))
  const directoryMode = (await fsPromises.lstat(directory)).mode & 0o777
  const logMode = (await fsPromises.lstat(path.join(directory, "facts.jsonl"))).mode & 0o777
  const manifestMode = (await fsPromises.lstat(path.join(directory, "manifest.jsonl"))).mode & 0o777
  if (process.platform !== "win32") {
    assert.equal(directoryMode & 0o077, 0)
    assert.equal(logMode & 0o077, 0)
    assert.equal(manifestMode & 0o077, 0)
  }
  const verification = await store.verify()
  assert.equal(verification.ok, true)
  assert.equal(verification.data.lastCommittedSequence, "0")
  assert.equal(verification.data.durableWriteSupported, true)
})

test("initialization is explicit and cannot overwrite an existing ledger", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  assert.equal((await store.initialize()).ok, true)
  const beforeFacts = await readFile(path.join(directory, "facts.jsonl"), "utf8")
  const beforeManifest = await readFile(path.join(directory, "manifest.jsonl"), "utf8")
  const second = await store.initialize()
  assert.equal(second.ok, false)
  assert.equal(await readFile(path.join(directory, "facts.jsonl"), "utf8"), beforeFacts)
  assert.equal(await readFile(path.join(directory, "manifest.jsonl"), "utf8"), beforeManifest)
})

test("appends exact facts with global monotonic sequences across runtime sessions", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const firstStore = createStore(directory)
  await firstStore.initialize()
  const first = await firstStore.append(operatorPause())
  assert.equal(first.ok, true)
  assert.equal(first.data.durable, true)
  assert.equal(first.data.record.sequence, "1")
  assert.equal(first.data.record.runtimeSessionId, "runtime-session-1")
  const secondStore = createStore(directory, { runtimeSessionId: "runtime-session-2" })
  const second = await secondStore.append({
    factId: "operator-control:request-2",
    factType: "OPERATOR_MARKET_PAUSED",
    data: { requestId: "request-2", actorId: "telegram-actor-1", symbol: "ETHUSDT" },
  })
  assert.equal(second.ok, true)
  assert.equal(second.data.durable, true)
  assert.equal(second.data.record.sequence, "2")
  assert.equal(second.data.record.runtimeSessionId, "runtime-session-2")
  const read = await secondStore.readAll()
  assert.deepEqual(read.data.records.map(({ sequence }) => sequence), ["0", "1", "2"])
  const manifests = await readManifestRecords(directory)
  assert.deepEqual(manifests.map(({ sequence }) => sequence), ["0", "1", "2"])
})

test("treats an exact duplicate fact identity and payload as idempotent across runtime sessions", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const first = await store.append(operatorPause())
  const restartedStore = createStore(directory, { runtimeSessionId: "runtime-session-2" })
  const duplicate = await restartedStore.append(operatorPause())
  assert.equal(first.ok, true)
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.durable, true)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.record.sequence, "1")
  assert.equal((await readManifestRecords(directory)).length, 2)
})

test("rejects reuse of a fact identity with changed economic or control payload", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append(operatorPause())).ok, true)
  const conflict = await store.append(operatorPause({
    data: { requestId: "request-1", actorId: "telegram-actor-1", symbol: "ETHUSDT" },
  }))
  assert.equal(conflict.ok, false)
  assert.match(conflict.errors[0].message, /factId.*different payload|identity.*payload/i)
})

test("serializes concurrent appends across multiple store instances in one process", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  const secondStore = createStore(directory, { runtimeSessionId: "runtime-session-2" })
  await store.initialize()
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => {
    const writer = index % 2 === 0 ? store : secondStore
    return writer.append({
      factId: "operator-control:concurrent-" + index,
      factType: "OPERATOR_MARKET_PAUSED",
      data: { requestId: "concurrent-" + index, actorId: "actor-1", symbol: "BTCUSDT" },
    })
  }))
  assert.equal(results.every(({ ok, data }) => ok && data.durable), true)
  const read = await store.readAll()
  assert.deepEqual(read.data.records.map(({ sequence }) => sequence), ["0", "1", "2", "3", "4", "5", "6", "7", "8"])
  const manifests = await readManifestRecords(directory)
  assert.deepEqual(manifests.map(({ sequence }) => sequence), ["0", "1", "2", "3", "4", "5", "6", "7", "8"])
})

test("preserves exact decimal strings and canonical key ordering", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const appended = await store.append({
    factId: "execution:binance:BTCUSDT:trade-1",
    factType: "EXECUTION_FILL_APPLIED",
    data: { quantity: "0.0100", price: "67234.50", symbol: "BTCUSDT", side: "BUY" },
  })
  assert.equal(appended.ok, true)
  const lines = await readLines(path.join(directory, "facts.jsonl"))
  const record = JSON.parse(lines[1])
  assert.equal(record.data.quantity, "0.0100")
  assert.equal(record.data.price, "67234.50")
  assert.equal(lines[1], canonicalStringify(record))
  assert.equal(record.digest, digestRecord(record))
})

test("rejects unknown fact types, unsafe numeric amounts, secrets, sparse arrays, accessors, and oversized payloads", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append({ ...operatorPause(), factType: "UNKNOWN_FACT" })).ok, false)
  const unsafeNumber = await store.append(operatorPause({
    data: { requestId: "r2", actorId: "a", symbol: "BTCUSDT", quantity: 0.01 },
  }))
  assert.equal(unsafeNumber.ok, false)
  const secret = await store.append(operatorPause({
    data: { requestId: "r3", actorId: "a", symbol: "BTCUSDT", apiKey: "must-not-persist" },
  }))
  assert.equal(secret.ok, false)
  const oversized = await store.append(operatorPause({
    data: { requestId: "r4", actorId: "a", symbol: "BTCUSDT", note: "x".repeat(70_000) },
  }))
  assert.equal(oversized.ok, false)
  const sparse = await store.append(operatorPause({
    data: { requestId: "r5", actorId: "a", symbol: "BTCUSDT", items: new Array(1) },
  }))
  assert.equal(sparse.ok, false)
  const accessorData = { requestId: "r6", symbol: "BTCUSDT" }
  Object.defineProperty(accessorData, "actorId", { enumerable: true, get: () => "actor-1" })
  const accessor = await store.append(operatorPause({ data: accessorData }))
  assert.equal(accessor.ok, false)
})

test("detects tampered fact-record digests", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const logPath = path.join(directory, "facts.jsonl")
  const original = await readFile(logPath, "utf8")
  await writeFile(logPath, original.replace("BTCUSDT", "ETHUSDT"))
  assert.equal((await store.verify()).ok, false)
})

test("detects missing committed-head manifests and missing fact logs", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await unlink(path.join(directory, "manifest.jsonl"))
  assert.equal((await store.verify()).ok, false)
  await unlink(path.join(directory, "facts.jsonl"))
  assert.equal((await store.readAll()).ok, false)
})

test("detects a validly re-digested fact sequence gap", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const logPath = path.join(directory, "facts.jsonl")
  const lines = await readLines(logPath)
  const record = JSON.parse(lines[1])
  record.sequence = "2"
  record.digest = digestRecord(record)
  lines[1] = canonicalStringify(record)
  await writeFile(logPath, lines.join("\n") + "\n")
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /sequence|gap|integrity/i)
})

test("detects partial or torn final records in either append-only stream", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const factPath = path.join(directory, "facts.jsonl")
  const factLog = await readFile(factPath, "utf8")
  await writeFile(factPath, factLog + "{")
  assert.equal((await store.verify()).ok, false)
  await writeFile(factPath, factLog)
  const manifestPath = path.join(directory, "manifest.jsonl")
  const manifestLog = await readFile(manifestPath, "utf8")
  await writeFile(manifestPath, manifestLog + "{")
  const freshStore = createStore(directory)
  assert.equal((await freshStore.verify()).ok, false)
})

test("rejects unknown fact and manifest fields even when their JSON remains canonical", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const factPath = path.join(directory, "facts.jsonl")
  const originalFacts = await readFile(factPath, "utf8")
  const factLines = originalFacts.trimEnd().split("\n")
  const fact = JSON.parse(factLines[1])
  fact.unrecognizedEnvelopeField = "must-fail"
  fact.digest = digestRecord(fact)
  factLines[1] = canonicalStringify(fact)
  await writeFile(factPath, factLines.join("\n") + "\n")
  assert.equal((await store.verify()).ok, false)
  await writeFile(factPath, originalFacts)
  const freshStore = createStore(directory)
  const manifestPath = path.join(directory, "manifest.jsonl")
  const originalManifest = await readFile(manifestPath, "utf8")
  const manifestLines = originalManifest.trimEnd().split("\n")
  const manifest = JSON.parse(manifestLines[1])
  manifest.unrecognizedField = true
  manifest.digest = digestRecord(manifest)
  manifestLines[1] = canonicalStringify(manifest)
  await writeFile(manifestPath, manifestLines.join("\n") + "\n")
  assert.equal((await freshStore.verify()).ok, false)
})

test("detects a broken committed-head manifest digest chain", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const manifestPath = path.join(directory, "manifest.jsonl")
  const lines = await readLines(manifestPath)
  const second = JSON.parse(lines[1])
  second.previousManifestDigest = "0".repeat(64)
  second.digest = digestRecord(second)
  lines[1] = canonicalStringify(second)
  await writeFile(manifestPath, lines.join("\n") + "\n")
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest.*chain|previous.*manifest/i)
})

test("does not acknowledge a fact when its manifest checkpoint cannot be appended", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  let failManifestAppend = false
  const manifestPath = path.join(directory, "manifest.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (target, ...args) => {
      if (failManifestAppend && target === manifestPath && args[0] === "a") {
        return {
          writeFile: async () => { throw new Error("simulated manifest append failure") },
          sync: async () => {},
          close: async () => {},
        }
      }
      return fsPromises.open(target, ...args)
    },
  }
  const store = createStore(directory, { fileSystem })
  await store.initialize()
  failManifestAppend = true
  const result = await store.append(operatorPause())
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "DURABLE_FACTS_COMMIT_UNCERTAIN")
  assert.notEqual(result.data?.durable, true)
  const freshStore = createStore(directory)
  const verification = await freshStore.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest.*log|manifest.*fact|committed/i)
})

test("poisons the current store after an uncertain manifest fsync, then verifies from a fresh instance", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  let failManifestSync = false
  const manifestPath = path.join(directory, "manifest.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (target, ...args) => {
      const handle = await fsPromises.open(target, ...args)
      if (failManifestSync && target === manifestPath && args[0] === "a") {
        Object.defineProperty(handle, "sync", {
          value: async () => { throw new Error("simulated manifest fsync failure") },
        })
      }
      return handle
    },
  }
  const store = createStore(directory, { fileSystem })
  await store.initialize()
  failManifestSync = true
  const appended = await store.append(operatorPause())
  assert.equal(appended.ok, false)
  assert.equal(appended.errors[0].code, "DURABLE_FACTS_COMMIT_UNCERTAIN")
  assert.equal((await store.verify()).ok, false)
  assert.equal((await store.append(operatorPause())).ok, false)
  const freshInstance = createStore(directory)
  const verified = await freshInstance.verify()
  assert.equal(verified.ok, true)
  assert.equal(verified.data.lastCommittedSequence, "1")
})

test("verification flushes both committed streams before declaring the ledger valid", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const syncPaths = []
  const fileSystem = {
    ...fsPromises,
    open: async (target, ...args) => {
      const handle = await fsPromises.open(target, ...args)
      const sync = handle.sync.bind(handle)
      Object.defineProperty(handle, "sync", {
        value: async () => {
          syncPaths.push(target)
          return sync()
        },
      })
      return handle
    },
  }
  const store = createStore(directory, { fileSystem })
  await store.initialize()
  syncPaths.length = 0
  const verified = await store.verify()
  assert.equal(verified.ok, true)
  assert.ok(syncPaths.includes(path.join(directory, "facts.jsonl")))
  assert.ok(syncPaths.includes(path.join(directory, "manifest.jsonl")))
})

