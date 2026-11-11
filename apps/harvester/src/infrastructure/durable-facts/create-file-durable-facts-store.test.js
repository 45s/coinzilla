import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import * as fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileDurableFactsStore } from "./create-file-durable-facts-store.js"

const createDirectory = () => mkdtemp(path.join(os.tmpdir(), "harvester-durable-facts-"))
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

test("explicit initialization writes a genesis fact and matching committed-head manifest", async (t) => {
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
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.lastCommittedSequence, "0")
  assert.equal(manifest.lastCommittedDigest, records.data.records[0].digest)
  const verification = await store.verify()
  assert.equal(verification.ok, true)
  assert.equal(verification.data.lastCommittedSequence, "0")
})

test("initialization is explicit and cannot overwrite an existing ledger", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  assert.equal((await store.initialize()).ok, true)
  const before = await readFile(path.join(directory, "facts.jsonl"), "utf8")
  const second = await store.initialize()
  assert.equal(second.ok, false)
  assert.equal(await readFile(path.join(directory, "facts.jsonl"), "utf8"), before)
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
    factType: "OPERATOR_MARKET_RESUMED",
    data: { requestId: "request-2", actorId: "telegram-actor-1", symbol: "BTCUSDT" },
  })
  assert.equal(second.ok, true)
  assert.equal(second.data.durable, true)
  assert.equal(second.data.record.sequence, "2")
  assert.equal(second.data.record.runtimeSessionId, "runtime-session-2")
  const read = await secondStore.readAll()
  assert.deepEqual(read.data.records.map(({ sequence }) => sequence), ["0", "1", "2"])
})

test("treats an exact duplicate fact identity and payload as idempotent", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const first = await store.append(operatorPause())
  const duplicate = await store.append(operatorPause())
  assert.equal(first.ok, true)
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.durable, true)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.record.sequence, "1")
  const records = await store.readAll()
  assert.equal(records.data.records.length, 2)
})

test("rejects reuse of a fact identity with changed economic or control payload", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append(operatorPause())).ok, true)
  const conflict = await store.append(operatorPause({ data: { requestId: "request-1", actorId: "telegram-actor-1", symbol: "ETHUSDT" } }))
  assert.equal(conflict.ok, false)
  assert.match(conflict.errors[0].message, /factId.*different payload|identity.*payload/i)
})

test("serializes concurrent appends into one gap-free global sequence", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => store.append({
    factId: "operator-control:concurrent-" + index,
    factType: "OPERATOR_MARKET_PAUSED",
    data: { requestId: "concurrent-" + index, actorId: "actor-1", symbol: "BTCUSDT" },
  })))
  assert.equal(results.every(({ ok, data }) => ok && data.durable), true)
  const read = await store.readAll()
  assert.deepEqual(read.data.records.map(({ sequence }) => sequence), ["0", "1", "2", "3", "4", "5", "6", "7", "8"])
})

test("preserves exact decimal strings and canonical key ordering", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const fact = {
    factId: "execution:binance:BTCUSDT:trade-1",
    factType: "EXECUTION_FILL_APPLIED",
    data: { quantity: "0.0100", price: "67234.50", symbol: "BTCUSDT", side: "BUY" },
  }
  const appended = await store.append(fact)
  assert.equal(appended.ok, true)
  const lines = (await readFile(path.join(directory, "facts.jsonl"), "utf8")).trimEnd().split("\n")
  const record = JSON.parse(lines[1])
  assert.equal(record.data.quantity, "0.0100")
  assert.equal(record.data.price, "67234.50")
  assert.equal(lines[1], canonicalStringify(record))
  assert.equal(record.digest, digestRecord(record))
})

test("rejects unknown fact types, unsafe numeric amounts, secrets, and oversized payloads", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  assert.equal((await store.append({ ...operatorPause(), factType: "UNKNOWN_FACT" })).ok, false)
  assert.equal((await store.append(operatorPause({ data: { requestId: "r2", actorId: "a", symbol: "BTCUSDT", quantity: 0.01 } })).ok, false)
  assert.equal((await store.append(operatorPause({ data: { requestId: "r3", actorId: "a", symbol: "BTCUSDT", apiKey: "must-not-persist" } })).ok, false)
  assert.equal((await store.append(operatorPause({ data: { requestId: "r4", actorId: "a", symbol: "BTCUSDT", note: "x".repeat(70_000) } })).ok, false)
})

test("detects tampered record digests", async (t) => {
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

test("detects missing committed-head manifests and missing log files", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await unlink(path.join(directory, "manifest.json"))
  assert.equal((await store.verify()).ok, false)
  await unlink(path.join(directory, "facts.jsonl"))
  assert.equal((await store.readAll()).ok, false)
})

test("detects a validly re-digested sequence gap", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const logPath = path.join(directory, "facts.jsonl")
  const lines = (await readFile(logPath, "utf8")).trimEnd().split("\\n")
  const record = JSON.parse(lines[1])
  record.sequence = "2"
  record.digest = digestRecord(record)
  lines[1] = canonicalStringify(record)
  await writeFile(logPath, lines.join("\\n") + "\\n")
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /sequence|gap|integrity/i)
})

test("detects a partial or torn final record", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  const logPath = path.join(directory, "facts.jsonl")
  const original = await readFile(logPath, "utf8")
  await writeFile(logPath, original + "{")
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /partial|torn|canonical|json|newline/i)
})

test("does not acknowledge an append when the manifest commit is uncertain", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  let failManifestRename = false
  const fileSystem = {
    ...fsPromises,
    rename: async (source, destination) => {
      if (failManifestRename && destination.endsWith("manifest.json")) throw new Error("simulated manifest commit failure")
      return fsPromises.rename(source, destination)
    },
  }
  const store = createStore(directory, { fileSystem })
  await store.initialize()
  failManifestRename = true
  const result = await store.append(operatorPause())
  assert.equal(result.ok, false)
  assert.notEqual(result.data?.durable, true)
  failManifestRename = false
  await unlink(path.join(directory, "manifest.json.tmp")).catch(() => {})
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest|committed|sequence|integrity/i)
})

test("fails closed when the log is truncated below the committed manifest head", async (t) => {
  const directory = await createDirectory()
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await store.initialize()
  await store.append(operatorPause())
  const logPath = path.join(directory, "facts.jsonl")
  const lines = (await readFile(logPath, "utf8")).trimEnd().split("\n")
  await writeFile(logPath, lines[0] + "\n")
  const verification = await store.verify()
  assert.equal(verification.ok, false)
  assert.match(verification.errors[0].message, /manifest|committed|sequence|truncated|integrity/i)
})
