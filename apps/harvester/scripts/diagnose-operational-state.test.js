import assert from "node:assert/strict"
import test from "node:test"
import { runOperationalStateDiagnostic } from "./diagnose-operational-state.js"

const identity = {
  application: "harvester-operational-state-diagnostic",
  version: "1.0.001",
  source: {
    commit: "a".repeat(40),
    workingTree: "clean",
    metadataSource: "git",
  },
}

const validStoreResult = () => ({
  ok: true,
  data: {
    records: [
      {
        sequence: "0",
        factType: "LEDGER_INITIALIZED",
        data: { secret: "must-not-print" },
      },
      {
        sequence: "1",
        factType: "PROCESS_STARTED",
        data: { tradingEnabled: true },
      },
    ],
    lastCommittedSequence: "1",
    lastCommittedDigest: "b".repeat(64),
  },
})

const validProjection = () => ({
  ok: true,
  data: {
    candidateOnly: true,
    restorationEnabled: false,
    requiresExchangeReconciliation: true,
    sessions: [{ sessionId: "private-session-id" }],
    orders: [{ clientOrderId: "private-client-order-id" }],
    recoveryCycles: [],
  },
})

const createFakeStore = ({ readAll, calls }) => ({
  readAll: async () => {
    calls.readAll += 1
    return readAll()
  },
  initialize: async () => {
    calls.mutate += 1
    throw new Error("Diagnostic must never initialize the store")
  },
  initializeIfEmpty: async () => {
    calls.mutate += 1
    throw new Error("Diagnostic must never initialize the store")
  },
  append: async () => {
    calls.mutate += 1
    throw new Error("Diagnostic must never append to the store")
  },
})

const createHarness = ({
  readAll = validStoreResult,
  project = validProjection,
} = {}) => {
  const output = []
  const errors = []
  const calls = {
    createStore: 0,
    readAll: 0,
    project: 0,
    mutate: 0,
  }
  const store = createFakeStore({
    readAll,
    calls,
  })
  const dependencies = {
    args: [],
    env: {},
    cwd: "/repo/apps/harvester",
    captureMetadata: () => identity,
    createStore: () => {
      calls.createStore += 1
      return store
    },
    project: (options) => {
      calls.project += 1
      return project(options)
    },
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  }
  return {
    dependencies,
    output,
    errors,
    calls,
  }
}

test("diagnostic verifies the existing store and reports only safe projection summaries", async () => {
  const harness = createHarness()
  const exitCode = await runOperationalStateDiagnostic(harness.dependencies)
  const report = JSON.parse(harness.output[0])

  assert.equal(exitCode, 0, "A verified store with a valid offline candidate projection must return success.")
  assert.equal(report.storeIntegrity.status, "VERIFIED", "A successful readAll verification must be reported as verified.")
  assert.equal(report.storeIntegrity.recordCount, 2, "The report must include the number of verified durable facts.")
  assert.deepEqual(report.storeIntegrity.factTypes, {
    LEDGER_INITIALIZED: 1,
    PROCESS_STARTED: 1,
  }, "The report must summarize fact types without exposing fact payloads.")
  assert.equal(report.projection.status, "CANDIDATE_ONLY", "The report must describe the projector output as a non-restoring candidate.")
  assert.equal(report.projection.restorationEnabled, false, "Diagnostics must never claim automatic restoration is enabled.")
  assert.equal(harness.calls.mutate, 0, "Diagnostics must not call any Operational State Store mutation method.")
  assert.equal(harness.output[0].includes("must-not-print"), false, "The report must never serialize durable fact payloads.")
  assert.equal(harness.output[0].includes("private-client-order-id"), false, "The report must not expose order identifiers from the projection.")
})

test("diagnostic skips projection and reports integrity failure when readAll rejects the store", async () => {
  const harness = createHarness({
    readAll: async () => ({
      ok: false,
      errors: [Object.assign(new Error("Manifest checkpoint does not match the fact stream"), {
        code: "DURABLE_FACTS_INTEGRITY_FAILED",
      })],
    }),
  })
  const exitCode = await runOperationalStateDiagnostic(harness.dependencies)
  const report = JSON.parse(harness.output[0])

  assert.equal(exitCode, 2, "An Operational State Store integrity failure must use the integrity-failure exit code.")
  assert.equal(report.storeIntegrity.status, "FAILED", "The report must identify the store integrity failure.")
  assert.equal(report.projection.status, "SKIPPED", "Projection must not run when the underlying store has not passed verification.")
  assert.equal(harness.calls.project, 0, "The projector must not receive unverified durable facts.")
  assert.equal(harness.calls.mutate, 0, "An integrity failure must not trigger automatic repair or mutation.")
})

test("diagnostic reports a projector failure separately from verified store integrity", async () => {
  const harness = createHarness({
    project: () => ({
      ok: false,
      errors: [new Error("Execution fill has no preceding submission intent")],
    }),
  })
  const exitCode = await runOperationalStateDiagnostic(harness.dependencies)
  const report = JSON.parse(harness.output[0])

  assert.equal(exitCode, 3, "A projection failure after successful integrity verification must have its own exit code.")
  assert.equal(report.storeIntegrity.status, "VERIFIED", "A projector failure must not be misreported as a corrupt store.")
  assert.equal(report.projection.status, "FAILED", "The report must identify the independent projection failure.")
  assert.match(report.projection.errors[0].message, /preceding submission intent/, "The original projection reason must remain actionable.")
  assert.equal(harness.calls.mutate, 0, "Projection failure diagnostics must not repair or rewrite the ledger.")
})

test("diagnostic version mode prints source identity without opening the store", async () => {
  const harness = createHarness()
  harness.dependencies.args = ["--version"]
  const exitCode = await runOperationalStateDiagnostic(harness.dependencies)

  assert.equal(exitCode, 0, "The side-effect-free version command must exit successfully.")
  assert.equal(harness.calls.createStore, 0, "Version output must not open or inspect the Operational State Store.")
  assert.match(harness.output[0], new RegExp(identity.source.commit), "Version output must identify the exact source commit.")
  assert.match(harness.output[0], /workingTree=clean/, "Version output must expose the source worktree state.")
})
