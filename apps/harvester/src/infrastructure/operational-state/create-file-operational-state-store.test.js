import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import * as fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "./create-file-store.js"

const createDirectory = () => mkdtemp(path.join(os.tmpdir(), "harvester-Operational State Store records-"))
const createStore = (...parameters) => {
  const [directory, options = {}] = parameters
  return createFileOperationalStateStore({
  directory,
  runtimeSessionId: "runtime-session-1",
  now: () => new Date("2026-11-11T12:00:00.000Z"),
  ...options,
  })
}
const operatorPause = (overrides = {}) => ({
  factId: "operator-control:request-1",
  factType: "OPERATOR_MARKET_PAUSED",
  data: { requestId: "request-1",
actorId: "telegram-actor-1",
symbol: "BTCUSDT" },
  ...overrides,
})
const canonicalize = (value) => {
  if (Array.isArray(value)) {return value.map(canonicalize)}
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}
const canonicalStringify = (value) => JSON.stringify(canonicalize(value))
const digestRecord = (record) => {
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest"))
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex")
}
const readLines = async (filePath) => (await readFile(filePath, "utf8")).trimEnd().split("\n")
const readManifestRecords = async (directory) => (await readLines(path.join(directory, "manifest.jsonl"))).map(JSON.parse)

test("normal verification and append never initialize a missing Operational State Store", async (t) => {
  const directory = path.join(os.tmpdir(), `harvester-Operational State Store records-missing-${  process.pid  }-${  Date.now()}`)
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  const append = await store.append(operatorPause())
  assert.equal(append.ok, false)
  await assert.rejects(readdir(directory), { code: "ENOENT" })
})

test("explicit initialization writes a genesis fact and committed-head manifest checkpoint", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
    data: { requestId: "request-2",
actorId: "telegram-actor-1",
symbol: "ETHUSDT" },
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append(operatorPause())).ok, true)
  const conflict = await store.append(operatorPause({
    data: { requestId: "request-1",
actorId: "telegram-actor-1",
symbol: "ETHUSDT" },
  }))
  assert.equal(conflict.ok, false)
  assert.match(conflict.errors[0].message, /record ID.*different payload|identity.*payload/i)
})

test("serializes concurrent appends across multiple store instances in one process", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  const secondStore = createStore(directory, { runtimeSessionId: "runtime-session-2" })
  await store.initialize()
  const appendOperations = []
  for (let index = 0; index < 8; index += 1) {
    const writer = index % 2 === 0 ? store : secondStore
    appendOperations.push(writer.append({
      factId: `operator-control:concurrent-${index}`,
      factType: "OPERATOR_MARKET_PAUSED",
      data: {
        requestId: `concurrent-${index}`,
        actorId: "actor-1",
        symbol: "BTCUSDT",
      },
    }))
  }
  const results = await Promise.all(appendOperations)
  assert.equal(results.every(({ ok, data }) => ok && data.durable), true)
  const read = await store.readAll()
  assert.deepEqual(read.data.records.map(({ sequence }) => sequence), ["0", "1", "2", "3", "4", "5", "6", "7", "8"])
  const manifests = await readManifestRecords(directory)
  assert.deepEqual(manifests.map(({ sequence }) => sequence), ["0", "1", "2", "3", "4", "5", "6", "7", "8"])
})

test("preserves exact decimal strings and canonical key ordering", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  const appended = await store.append({
    factId: "execution-fill-applied:binance:BTCUSDT:trade-1",
    factType: "EXECUTION_FILL_APPLIED",
    data: {
      fillId: "binance:BTCUSDT:trade-1",
      tradeId: "trade-1",
      brokerOrderId: "broker-order-1",
      clientOrderId: null,
      marketId: "binance:BTCUSDT",
      venue: "binance",
      symbol: "BTCUSDT",
      baseAssetId: "binance:BTC",
      quoteAssetId: "binance:USDT",
      side: "BUY",
      quantity: "0.0100",
      price: "67234.50",
      quoteQuantity: "672.345000",
      liquidityRole: "UNKNOWN",
      executedAt: null,
      commissionStatus: "UNKNOWN",
      commissions: [],
    },
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append({ ...operatorPause(),
factType: "UNKNOWN_FACT" })).ok, false)
  const unsafeNumber = await store.append(operatorPause({
    data: { requestId: "r2",
actorId: "a",
symbol: "BTCUSDT",
quantity: 0.01 },
  }))
  assert.equal(unsafeNumber.ok, false)
  const secret = await store.append(operatorPause({
    data: { requestId: "r3",
actorId: "a",
symbol: "BTCUSDT",
apiKey: "must-not-persist" },
  }))
  assert.equal(secret.ok, false)
  const oversized = await store.append(operatorPause({
    data: { requestId: "r4",
actorId: "a",
symbol: "BTCUSDT",
note: "x".repeat(70_000) },
  }))
  assert.equal(oversized.ok, false)
  const sparse = await store.append(operatorPause({
    data: { requestId: "r5",
actorId: "a",
symbol: "BTCUSDT",
items: new Array(1) },
  }))
  assert.equal(sparse.ok, false)
  const accessorData = { requestId: "r6",
symbol: "BTCUSDT" }
  Object.defineProperty(accessorData, "actorId", { enumerable: true,
get: () => "actor-1" })
  const accessor = await store.append(operatorPause({ data: accessorData }))
  assert.equal(accessor.ok, false)
})

test("detects tampered fact-record digests", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  await unlink(path.join(directory, "manifest.jsonl"))
  assert.equal((await store.verify()).ok, false)
  await unlink(path.join(directory, "facts.jsonl"))
  assert.equal((await store.readAll()).ok, false)
})

test("detects a validly re-digested fact sequence gap", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const logPath = path.join(directory, "facts.jsonl")
  const lines = await readLines(logPath)
  const record = JSON.parse(lines[1])
  record.sequence = "2"
  record.digest = digestRecord(record)
  lines[1] = canonicalStringify(record)
  await writeFile(logPath, `${lines.join("\n")  }\n`)
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /sequence|gap|integrity/i)
})

test("detects partial or torn final records in either append-only stream", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  const factPath = path.join(directory, "facts.jsonl")
  const factLog = await readFile(factPath, "utf8")
  await writeFile(factPath, `${factLog  }{`)
  assert.equal((await store.verify()).ok, false)
  await writeFile(factPath, factLog)
  const manifestPath = path.join(directory, "manifest.jsonl")
  const manifestLog = await readFile(manifestPath, "utf8")
  await writeFile(manifestPath, `${manifestLog  }{`)
  const freshStore = createStore(directory)
  assert.equal((await freshStore.verify()).ok, false)
})

test("rejects unknown fact and manifest fields even when their JSON remains canonical", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
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
  await writeFile(factPath, `${factLines.join("\n")  }\n`)
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
  await writeFile(manifestPath, `${manifestLines.join("\n")  }\n`)
  assert.equal((await freshStore.verify()).ok, false)
})

test("detects a broken committed-head manifest digest chain", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const manifestPath = path.join(directory, "manifest.jsonl")
  const lines = await readLines(manifestPath)
  const second = JSON.parse(lines[1])
  second.previousManifestDigest = "0".repeat(64)
  second.digest = digestRecord(second)
  lines[1] = canonicalStringify(second)
  await writeFile(manifestPath, `${lines.join("\n")  }\n`)
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest.*chain|previous.*manifest/i)
})

test("fails closed after the fact stream is synced but before its manifest checkpoint is appended", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  let loseFactSyncAcknowledgement = false
  const factPath = path.join(directory, "facts.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
      const [target, ...args] = parameters
      const handle = await fsPromises.open(target, ...args)
      if (loseFactSyncAcknowledgement && target === factPath && args[0] === "a") {
        const sync = handle.sync.bind(handle)
        Object.defineProperty(handle, "sync", {
          value: async () => {
            await sync()
            throw new Error("simulated lost acknowledgement after successful fact sync")
          },
        })
      }
      return handle
    },
  }
  const originalStore = createStore(directory, { fileSystem })
  const initialized = await originalStore.initialize()
  assert.equal(initialized.ok, true, "The isolated store must be initialized before fault injection.")
  loseFactSyncAcknowledgement = true

  const uncertainAppend = await originalStore.append(operatorPause())
  assert.equal(uncertainAppend.ok, false, "The append must not claim success after its fact-sync acknowledgement is lost.")
  assert.equal(
    uncertainAppend.errors[0].code,
    "DURABLE_FACTS_COMMIT_UNCERTAIN",
    "A fact written without a committed manifest checkpoint must remain an uncertain commit.",
  )
  assert.notEqual(uncertainAppend.data?.durable, true, "The uncertain append must never claim durable success.")
  const repeatedAppend = await originalStore.append(operatorPause())
  assert.equal(repeatedAppend.ok, false, "The original store instance must remain fenced.")
  assert.equal(
    repeatedAppend.errors[0].code,
    "DURABLE_FACTS_COMMIT_UNCERTAIN",
    "A genuinely uncertain append must retain its commit-uncertain classification when fenced.",
  )

  const persistedFacts = await readLines(factPath)
  const persistedManifest = await readManifestRecords(directory)
  assert.equal(persistedFacts.length, 2, "The fixture must contain the synced genesis and uncheckpointed fact.")
  assert.equal(persistedManifest.length, 1, "The manifest must remain at genesis when the fact checkpoint was not appended.")

  const restartedStore = createStore(directory)
  const verification = await restartedStore.verify()
  assert.equal(verification.ok, false, "A fresh process must reject a fact stream that is ahead of its manifest.")
  assert.match(
    verification.errors[0].message,
    /Operational State record exists beyond the committed-head manifest journal/,
    "Restart verification must identify the exact fact-beyond-manifest inconsistency.",
  )
  assert.equal(
    (await restartedStore.append(operatorPause())).ok,
    false,
    "An uncommitted fact must not be silently adopted by a retry after restart.",
  )
})

test("classifies ledger integrity failures separately from uncertain append acknowledgements", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const initializedStore = createStore(directory)
  const initialized = await initializedStore.initialize()
  assert.equal(initialized.ok, true, "The isolated store must initialize before its manifest is made stale.")
  const appended = await initializedStore.append(operatorPause())
  assert.equal(appended.ok, true, "The fixture must contain one committed non-genesis fact.")

  const manifestPath = path.join(directory, "manifest.jsonl")
  const manifestLines = await readLines(manifestPath)
  await writeFile(manifestPath, `${manifestLines[0]}\\n`)

  const verificationStore = createStore(directory)
  const verification = await verificationStore.verify()
  assert.equal(verification.ok, false, "Verification must reject a fact stream that is ahead of its manifest.")
  assert.equal(
    verification.errors[0].code,
    "DURABLE_FACTS_INTEGRITY_FAILED",
    "A fresh verifier must report ledger inconsistency, not misclassify it as this process's uncertain append.",
  )
  const fencedAppend = await verificationStore.append(operatorPause())
  assert.equal(fencedAppend.ok, false, "A store that failed integrity verification must remain write-fenced.")
  assert.equal(
    fencedAppend.errors[0].code,
    "DURABLE_FACTS_INTEGRITY_FAILED",
    "The write fence must preserve the integrity failure instead of reporting an uncertain append.",
  )

  const historyStore = createStore(directory)
  const history = await historyStore.readAll()
  assert.equal(history.ok, false, "History reads must reject the same uncommitted fact.")
  assert.equal(
    history.errors[0].code,
    "DURABLE_FACTS_INTEGRITY_FAILED",
    "A fresh history reader must preserve the integrity-failure classification.",
  )
  const fencedRead = await historyStore.readAll()
  assert.equal(fencedRead.ok, false, "The same history reader must remain fenced after failed verification.")
  assert.equal(
    fencedRead.errors[0].code,
    "DURABLE_FACTS_INTEGRITY_FAILED",
    "The read fence must preserve the integrity failure on subsequent operations.",
  )

  const appendStore = createStore(directory)
  const blockedAppend = await appendStore.append(operatorPause())
  assert.equal(blockedAppend.ok, false, "Append preflight must reject an inconsistent ledger before writing.")
  assert.equal(
    blockedAppend.errors[0].code,
    "DURABLE_FACTS_INTEGRITY_FAILED",
    "Append preflight must not misclassify a detected integrity failure as an uncertain new commit.",
  )
})

test("does not acknowledge a fact when its manifest checkpoint cannot be appended", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  let failManifestAppend = false
  const manifestPath = path.join(directory, "manifest.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
        const [target, ...args] = parameters
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
  t.after(() => rm(directory, { recursive: true,
force: true }))
  let failManifestSync = false
  const manifestPath = path.join(directory, "manifest.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
        const [target, ...args] = parameters
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

test("recovers idempotently when the manifest is synced but the append acknowledgement is lost", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  let loseManifestAcknowledgement = false
  const manifestPath = path.join(directory, "manifest.jsonl")
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
      const [target, ...args] = parameters
      const handle = await fsPromises.open(target, ...args)
      if (loseManifestAcknowledgement && target === manifestPath && args[0] === "a") {
        const sync = handle.sync.bind(handle)
        Object.defineProperty(handle, "sync", {
          value: async () => {
            await sync()
            throw new Error("simulated lost acknowledgement after successful manifest sync")
          },
        })
      }
      return handle
    },
  }
  const originalStore = createStore(directory, { fileSystem })
  const initialized = await originalStore.initialize()
  assert.equal(initialized.ok, true, "The isolated ledger must be initialized before simulating a lost append acknowledgement.")
  loseManifestAcknowledgement = true

  const uncertainAppend = await originalStore.append(operatorPause())
  assert.equal(uncertainAppend.ok, false, "The caller must not receive success when the manifest sync acknowledgement is lost.")
  assert.equal(uncertainAppend.errors[0].code, "DURABLE_FACTS_COMMIT_UNCERTAIN", "A lost post-sync acknowledgement must remain classified as an uncertain commit.")
  assert.notEqual(uncertainAppend.data?.durable, true, "An uncertain append must never claim durable success.")
  assert.equal((await originalStore.append(operatorPause())).ok, false, "The original store instance must remain fenced after the uncertain result.")

  const restartedStore = createStore(directory)
  const verification = await restartedStore.verify()
  assert.equal(verification.ok, true, "A fresh process instance must verify both streams after the manifest was successfully synced.")
  assert.equal(verification.data.lastCommittedSequence, "1", "The recovered checkpoint must contain exactly one appended fact.")

  const idempotentRetry = await restartedStore.append(operatorPause())
  assert.equal(idempotentRetry.ok, true, "Retrying the same stable fact identity after verification must be safe.")
  assert.equal(idempotentRetry.data.durable, true, "The verified existing fact must be reported durable.")
  assert.equal(idempotentRetry.data.duplicate, true, "The retry must resolve as the existing committed fact, not append a duplicate.")
  assert.equal(idempotentRetry.data.record.sequence, "1", "Idempotent recovery must preserve the original committed sequence.")
  assert.equal((await restartedStore.readAll()).data.records.length, 2, "The ledger must contain genesis plus one committed control fact.")
})

test("verification flushes both committed streams before declaring the ledger valid", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const syncPaths = []
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
        const [target, ...args] = parameters
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


test("fails closed when the fact log is truncated below the committed-head journal", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const factPath = path.join(directory, "facts.jsonl")
  const lines = await readLines(factPath)
  await writeFile(factPath, `${lines[0]  }\n`)
  const verification = await createStore(directory).verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest.*ahead|truncated|fact log/i)
})


test("accepts a verified market-history coverage fact with exact durable evidence", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  const appended = await store.append({
    factId: "market-history-coverage:BTCUSDT:baseline-1",
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    data: {
      symbol: "BTCUSDT",
      coveredFromTime: 1_700_000_000_000,
      verifiedAt: 1_700_000_100_000,
      evidenceDigest: "a".repeat(64),
      verifiedBy: "operator:trader",
    },
  })

  assert.equal(appended.ok, true, appended.errors?.map(({ message }) => message).join("; "))
  assert.equal(appended.data.durable, true)
  assert.equal(appended.data.record.factType, "MARKET_HISTORY_COVERAGE_CONFIRMED")
  assert.equal(appended.data.record.data.coveredFromTime, 1_700_000_000_000)
})

test("accepts canonical ISO timestamp strings from the injected clock for market-history coverage", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  let clockCalls = 0
  const recordedAt = "2026-11-13T00:00:00.000Z"
  const store = createStore(directory, {
    now: () => {
      clockCalls += 1
      return recordedAt
    },
  })

  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The Operational State Store must initialize before testing its injected clock.")
  clockCalls = 0

  const appended = await store.append({
    factId: "market-history-coverage:BTCUSDT:string-clock",
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    data: {
      symbol: "BTCUSDT",
      coveredFromTime: 1_700_000_000_000,
      verifiedAt: 1_700_000_100_000,
      evidenceDigest: "a".repeat(64),
      verifiedBy: "operator:trader",
    },
  })

  assert.equal(
    appended.ok,
    true,
    "A canonical ISO timestamp string is a supported injected clock value for coverage facts.",
  )
  assert.equal(clockCalls, 1, "One append must capture the injected clock exactly once.")
  assert.equal(
    appended.data.record.recordedAt,
    recordedAt,
    "The committed fact must use the same canonical timestamp that passed future-time validation.",
  )
})

test("rejects negative zero in Operational State Store record numeric fields before JSON can normalize it to zero", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()

  const appended = await store.append({
    factId: "market-history-coverage:BTCUSDT:negative-zero",
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    data: {
      symbol: "BTCUSDT",
      coveredFromTime: -0,
      verifiedAt: 200,
      evidenceDigest: "a".repeat(64),
      verifiedBy: "operator:trader",
    },
  })

  assert.equal(
    appended.ok,
    false,
    "Negative zero must be rejected rather than persisted as the indistinguishable JSON number zero.",
  )
  assert.match(
    appended.errors[0].message,
    /negative zero/i,
    "The validation error must identify the lossy negative-zero input.",
  )
  const records = await store.readAll()
  assert.equal(
    records.data.records.length,
    1,
    "Rejecting negative zero must leave only the initialized genesis record in the ledger.",
  )
})

function createInvalidMarketHistoryCoverageFacts() {
  return [
    ...createInvalidCoverageEvidenceFacts(),
    ...createInvalidCoverageMetadataFacts(),
  ]
}

function createInvalidCoverageEvidenceFacts() {
  return [
    {
      factId: "coverage:missing-digest",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 100,
        verifiedAt: 200,
        verifiedBy: "operator:trader",
      },
    },
    {
      factId: "coverage:invalid-digest",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 100,
        verifiedAt: 200,
        evidenceDigest: "not-a-sha256",
        verifiedBy: "operator:trader",
      },
    },
    {
      factId: "coverage:future-start",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 201,
        verifiedAt: 200,
        evidenceDigest: "a".repeat(64),
        verifiedBy: "operator:trader",
      },
    },
    {
      factId: "coverage:future-verification",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 1_700_000_000_000,
        verifiedAt: 1_800_000_000_000,
        evidenceDigest: "a".repeat(64),
        verifiedBy: "operator:trader",
      },
    },
  ]
}

function createInvalidCoverageMetadataFacts() {
  return [
    {
      factId: "coverage:bad-symbol",
      data: {
        symbol: "btc/usdt",
        coveredFromTime: 100,
        verifiedAt: 200,
        evidenceDigest: "a".repeat(64),
        verifiedBy: "operator:trader",
      },
    },
    {
      factId: "coverage:missing-verifier",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 100,
        verifiedAt: 200,
        evidenceDigest: "a".repeat(64),
      },
    },
    {
      factId: "coverage:unsupported-field",
      data: {
        symbol: "BTCUSDT",
        coveredFromTime: 100,
        verifiedAt: 200,
        evidenceDigest: "a".repeat(64),
        verifiedBy: "operator:trader",
        apiKey: "must-not-be-stored",
      },
    },
  ]
}

test("rejects malformed market-history coverage facts", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()
  const invalidFacts = createInvalidMarketHistoryCoverageFacts()
  for (const invalid of invalidFacts) {
    const result = await store.append({
      factId: invalid.factId,
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      data: invalid.data,
    })
    assert.equal(result.ok, false, invalid.factId)
  }
})


test("rejects a recovery-cycle NOT_COMPLETED fact without its complete cycle and terminal SELL evidence", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createStore(directory)
  await store.initialize()

  const result = await store.append({
    factId: "recovery-cycle-not-completed:invalid",
    factType: "RECOVERY_CYCLE_NOT_COMPLETED",
    data: { outcome: "BLOCKED" },
  })

  assert.equal(result.ok, false, "NOT_COMPLETED facts must validate the full cycle boundary and exact terminal SELL identity.")
})

test("automatically initializes a missing Operational State Store directory", async (t) => {
  const directory = path.join(os.tmpdir(), `harvester-Operational State Store-auto-missing-${  process.pid  }-${  Date.now()}`)
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createStore(directory)
  const initialized = await store.initializeIfEmpty()
  assert.equal(initialized.ok, true, "A missing ledger directory must be initialized on first startup.")
  assert.equal(initialized.data.initialized, true, "First startup must report that it created genesis.")
  assert.equal((await store.verify()).ok, true, "The automatically created ledger must pass full integrity verification.")
  assert.deepEqual((await readdir(directory)).sort(), ["facts.jsonl", "manifest.jsonl"])
})

test("automatically initializes an existing empty Operational State Store directory", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createStore(directory)
  const initialized = await store.initializeIfEmpty()
  assert.equal(initialized.ok, true, "An existing empty directory is a valid first-start state.")
  assert.equal(initialized.data.initialized, true, "An empty directory must receive genesis exactly once.")
  assert.equal((await store.verify()).ok, true, "The initialized empty directory must contain a verified ledger.")
})

test("verifies an existing complete ledger without changing either stream", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createStore(directory)
  assert.equal((await store.initialize()).ok, true)
  const factsBefore = await readFile(path.join(directory, "facts.jsonl"), "utf8")
  const manifestBefore = await readFile(path.join(directory, "manifest.jsonl"), "utf8")
  const result = await store.initializeIfEmpty()
  assert.equal(result.ok, true, "A complete existing ledger must be accepted.")
  assert.equal(result.data.initialized, false, "An existing ledger must not receive another genesis.")
  assert.equal((await store.verify()).ok, true)
  assert.equal(await readFile(path.join(directory, "facts.jsonl"), "utf8"), factsBefore)
  assert.equal(await readFile(path.join(directory, "manifest.jsonl"), "utf8"), manifestBefore)
})

test("refuses to initialize a partially present ledger and preserves existing files", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(directory, "facts.jsonl")
  await writeFile(factsPath, "partial\n")
  const result = await createStore(directory).initializeIfEmpty()
  assert.equal(result.ok, false, "A directory containing only one ledger stream must fail closed.")
  assert.equal(result.errors[0].code, "DURABLE_FACTS_LEDGER_INCOMPLETE")
  assert.equal(await readFile(factsPath, "utf8"), "partial\n")
  assert.deepEqual(await readdir(directory), ["facts.jsonl"], "The missing manifest must not be created.")
})

test("refuses unexpected existing directory contents without modifying them", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const unexpectedPath = path.join(directory, "operator-backup.txt")
  await writeFile(unexpectedPath, "keep")
  const result = await createStore(directory).initializeIfEmpty()
  assert.equal(result.ok, false, "Unexpected files must never be treated as an empty ledger.")
  assert.equal(result.errors[0].code, "DURABLE_FACTS_LEDGER_INCOMPLETE")
  assert.equal(await readFile(unexpectedPath, "utf8"), "keep")
  assert.deepEqual(await readdir(directory), ["operator-backup.txt"])
})

test("does not repair or replace an existing corrupt ledger", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createStore(directory)
  assert.equal((await store.initialize()).ok, true)
  const factsPath = path.join(directory, "facts.jsonl")
  const original = await readFile(factsPath, "utf8")
  const corrupted = original.replace("LEDGER_INITIALIZED", "CORRUPTED_LEDGER")
  await writeFile(factsPath, corrupted)
  const result = await store.initializeIfEmpty()
  assert.equal(result.ok, true, "The presence of both streams is not permission to repair a corrupt ledger.")
  assert.equal(result.data.initialized, false)
  assert.equal((await store.verify()).ok, false, "Corrupt content must still fail integrity verification.")
  assert.equal(await readFile(factsPath, "utf8"), corrupted, "Startup must preserve the corrupt evidence unchanged.")
})
