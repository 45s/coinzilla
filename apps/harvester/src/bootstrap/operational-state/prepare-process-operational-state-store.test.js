import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import * as fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createFileOperationalStateStore } from "../../infrastructure/operational-state/create-file-store.js"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { DEFAULT_OPERATIONAL_STATE_DIRECTORY } from "../../infrastructure/operational-state/resolve-directory.js"
import { prepareProcessOperationalStateStore } from "./prepare-process-operational-state-store.js"

const config = ({
  recovery = false,
  operator = false,
  recoverySeller = false,
  recoverySellerPairEnabled = recoverySeller,
} = {}) => ({
  strategies: {
    [StrategyId.COIN_GRABBER]: { settings: { recovery: { enabled: recovery } } },
    [StrategyId.RECOVERY_SELLER]: {
      enabled: recoverySeller,
      pairs: {
        LINEAUSDT: { enabled: recoverySellerPairEnabled },
      },
    },
  },
  operatorControl: { telegram: { enabled: operator } },
})
const store = () => ({
  initializeIfEmpty: async () => ({
    ok: true,
    data: {
      ready: true,
      initialized: false,
    },
  }),
  verify: async () => ({
    ok: true,
    data: {
      valid: true,
      durableWriteSupported: true,
    },
  }),
})

test("skips store creation when neither strategy requires durable operational state", async () => {
  let calls = 0
  assert.equal(await prepareProcessOperationalStateStore({
    appConfig: config({ operator: true }),
    runtimeSessionId: "session",
    createOperationalStateStore: () => { calls += 1 },
  }), undefined)
  assert.equal(calls, 0, "Telegram-only operator control must not create the Operational State Store")
})

test("prepares the verified store for enabled RS markets without enabling CG restart recovery", async () => {
  let options
  const expected = store()
  const actual = await prepareProcessOperationalStateStore({
    appConfig: config({ recoverySeller: true }),
    env: {},
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return expected },
  })
  assert.strictEqual(actual, expected, "enabled RS must receive its verified durable STOP store")
  assert.equal(options.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY, "RS must use the canonical package-local ledger")
  assert.equal(options.runtimeSessionId, "session", "the store must be bound to the current process session")
})

test("constructs only one store when both CG restart recovery and RS are enabled", async () => {
  let calls = 0
  const expected = store()
  const actual = await prepareProcessOperationalStateStore({
    appConfig: config({
      recovery: true,
      recoverySeller: true,
    }),
    runtimeSessionId: "session",
    createOperationalStateStore: () => {
      calls += 1
      return expected
    },
  })
  assert.strictEqual(actual, expected, "both strategies must share the process-owned Operational State Store")
  assert.equal(calls, 1, "the process must construct the shared store exactly once")
})

test("does not prepare the store for globally disabled RS or RS without enabled markets", async () => {
  let calls = 0
  const createOperationalStateStore = () => { calls += 1; return store() }
  assert.equal(await prepareProcessOperationalStateStore({
    appConfig: config({ recoverySeller: false }),
    runtimeSessionId: "session",
    createOperationalStateStore,
  }), undefined, "globally disabled RS must not require the store")
  assert.equal(await prepareProcessOperationalStateStore({
    appConfig: config({
        recoverySeller: true,
        recoverySellerPairEnabled: false,
      }),
    runtimeSessionId: "session",
    createOperationalStateStore,
  }), undefined, "RS without enabled markets must not require the store")
  assert.equal(calls, 0, "inactive RS configuration must not construct the store")
})

test("uses the documented default directory when restart recovery is enabled", async () => {
  let options
  const expected = store()
  const actual = await prepareProcessOperationalStateStore({
    appConfig: config({ recovery: true }),
    env: {},
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return expected },
  })
  assert.strictEqual(actual, expected)
  assert.equal(options.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
  assert.equal(path.basename(options.directory), "recovery-facts")
  assert.ok(options.directory.endsWith(path.join("apps", "harvester", "recovery-facts")))
  assert.equal(options.runtimeSessionId, "session")
})

test("honors a valid absolute OPERATIONAL_STATE_DIRECTORY", async () => {
  let options
  await prepareProcessOperationalStateStore({
    appConfig: config({ recovery: true }),
    env: { OPERATIONAL_STATE_DIRECTORY: path.resolve("ledger") },
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, path.resolve("ledger"))
})

test("rejects malformed OPERATIONAL_STATE_DIRECTORY before calling the factory", async () => {
  let calls = 0
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      env: { OPERATIONAL_STATE_DIRECTORY: "relative/path" },
      runtimeSessionId: "session",
      createOperationalStateStore: () => { calls += 1 },
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_DIRECTORY_INVALID" &&
      error.message.includes("OPERATIONAL_STATE_DIRECTORY"),
  )
  assert.equal(calls, 0)
})

test("wraps store factory failures with stage, path and original cause", async () => {
  const cause = new Error("disk unavailable")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      env: {},
      runtimeSessionId: "session",
      createOperationalStateStore: () => { throw cause },
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_STORE_CREATE_FAILED" &&
      error.cause === cause &&
      error.message.includes("recovery-facts"),
  )
})

test("rejects invalid stores and stores without verification support", async () => {
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: () => null,
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_STORE_INVALID",
  )
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: () => ({
        initializeIfEmpty: async () => ({
          ok: true,
          data: {
            ready: true,
            initialized: false,
          },
        }),
      }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFY_UNAVAILABLE",
  )
})

test("fails closed when recovery ledger verification fails or throws", async () => {
  const invalid = new Error("corrupt chain")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: () => ({
        initializeIfEmpty: async () => ({
          ok: true,
          data: {
            ready: true,
            initialized: false,
          },
        }),
        verify: async () => ({
          ok: false,
          errors: [invalid],
        }),
      }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED" && error.cause === invalid,
  )
  const thrown = new Error("read EIO")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: () => ({
        initializeIfEmpty: async () => ({
          ok: true,
          data: {
            ready: true,
            initialized: false,
          },
        }),
        verify: async () => { throw thrown },
      }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED" && error.cause === thrown,
  )
})

test("reports invalid session identity and factory dependencies", async () => {
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "",
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_SESSION_ID_INVALID",
  )
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: null,
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_FACTORY_INVALID",
  )
})

test("ignores the removed DURABLE_FACTS_DIRECTORY override", async () => {
  let options
  await prepareProcessOperationalStateStore({
    appConfig: config({ recovery: true }),
    env: { DURABLE_FACTS_DIRECTORY: path.resolve("legacy-recovery-facts") },
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
})

test("uses the canonical override and ignores the removed legacy variable", async () => {
  let options
  const canonicalDirectory = path.resolve("new-store")
  await prepareProcessOperationalStateStore({
    appConfig: config({ recovery: true }),
    env: {
      OPERATIONAL_STATE_DIRECTORY: canonicalDirectory,
      DURABLE_FACTS_DIRECTORY: path.resolve("old-store"),
    },
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, canonicalDirectory)
})

test("initializes an empty store before verifying the process-owned ledger", async () => {
  const operations = []
  const expectedStore = {
    initializeIfEmpty: async () => {
      operations.push("initializeIfEmpty")
      return {
        ok: true,
        data: {
          ready: true,
          initialized: true,
        },
      }
    },
    verify: async () => {
      operations.push("verify")
      return {
        ok: true,
        data: {
          valid: true,
          durableWriteSupported: true,
        },
      }
    },
  }
  await prepareProcessOperationalStateStore({
    appConfig: config({ recoverySeller: true }),
    runtimeSessionId: "session",
    createOperationalStateStore: () => expectedStore,
  })
  assert.deepEqual(operations, ["initializeIfEmpty", "verify"], "Startup must initialize only an empty ledger, then verify it before returning the store.")
})

test("fails closed in real process startup when a synced fact has no manifest checkpoint", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-operational-state-startup-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manifestPath = path.join(directory, "manifest.jsonl")
  let failManifestAppend = false
  const fileSystem = {
    ...fsPromises,
    open: async (...parameters) => {
      const [target, ...args] = parameters
      if (failManifestAppend && target === manifestPath && args[0] === "a") {
        return {
          writeFile: async () => {
            throw new Error("simulated manifest checkpoint append failure")
          },
          sync: async () => {},
          close: async () => {},
        }
      }
      return fsPromises.open(target, ...args)
    },
  }
  const interruptedStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "startup-boundary-session",
    fileSystem,
  })
  const initialized = await interruptedStore.initialize()
  assert.equal(initialized.ok, true, "The isolated real store must initialize before fault injection.")
  failManifestAppend = true
  const interruptedAppend = await interruptedStore.append({
    factId: "operator-control:startup-boundary",
    factType: "OPERATOR_MARKET_PAUSED",
    data: {
      requestId: "startup-boundary",
      actorId: "test-operator",
      symbol: "BTCUSDT",
    },
  })
  assert.equal(interruptedAppend.ok, false, "The interrupted append must not be acknowledged.")
  assert.equal(
    interruptedAppend.errors[0].code,
    "DURABLE_FACTS_COMMIT_UNCERTAIN",
    "The real store must classify the incomplete two-stream commit as uncertain.",
  )

  const factsBeforeStartup = await readFile(path.join(directory, "facts.jsonl"), "utf8")
  const manifestBeforeStartup = await readFile(manifestPath, "utf8")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }),
      env: { OPERATIONAL_STATE_DIRECTORY: directory },
      runtimeSessionId: "startup-after-interruption",
      createOperationalStateStore: (options) => createFileOperationalStateStore(options),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED" &&
      /Operational State record exists beyond the committed-head manifest journal/.test(error.cause?.message ?? ""),
    "Real process startup must reject the uncheckpointed fact before broker-capable startup.",
  )
  assert.equal(
    await readFile(path.join(directory, "facts.jsonl"), "utf8"),
    factsBeforeStartup,
    "Startup verification must not truncate, repair, or otherwise mutate the fact stream.",
  )
  assert.equal(
    await readFile(manifestPath, "utf8"),
    manifestBeforeStartup,
    "Startup verification must not synthesize or otherwise mutate a missing manifest checkpoint.",
  )
})

test("fails closed without verification when an existing partial ledger cannot be initialized safely", async () => {
  const cause = new Error("one ledger stream is missing")
  let verificationCalls = 0
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recoverySeller: true }),
      runtimeSessionId: "session",
      createOperationalStateStore: () => ({
        initializeIfEmpty: async () => ({
          ok: false,
          errors: [cause],
        }),
        verify: async () => {
          verificationCalls += 1
          return {
            ok: true,
            data: {
              valid: true,
              durableWriteSupported: true,
            },
          }
        },
      }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_INITIALIZATION_FAILED" && error.cause === cause,
  )
  assert.equal(verificationCalls, 0, "A partial ledger must fail before ordinary verification or runtime startup.")
})
