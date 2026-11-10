import test from "node:test"
import assert from "node:assert/strict"
import { createHarvesterProcessIdentity } from "./create-harvester-process-identity.js"

const availableBuildMetadata = {
  application: "harvester",
  version: "1.0.001",
  source: {
    branch: "develop",
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shortCommit: "aaaaaaaa",
    commitMessage: "feat: process identity",
    commitDate: "2026-11-09T09:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
  },
}

test("captures package and runtime identity once using the process-entry timestamp", () => {
  const operations = []
  const environment = { COINZILLA_BUILD_BRANCH: "ignored-when-git-is-available" }
  const identity = createHarvesterProcessIdentity({
    env: environment,
    cwd: "/workspace/coinzilla",
    processId: 12345,
    now: () => {
      operations.push("clock")
      return new Date("2026-11-09T10:15:30.000Z")
    },
    generateRuntimeSessionId: () => {
      operations.push("session")
      return "runtime-session-123"
    },
    captureBuildMetadata: (input) => {
      operations.push("build")
      assert.deepEqual(input, {
        application: "harvester",
        version: "1.0.001",
        cwd: "/workspace/coinzilla",
        env: environment,
      }, "build provenance capture must receive only explicit application, package, directory and environment inputs")
      return availableBuildMetadata
    },
  })

  assert.deepEqual(operations, ["clock", "session", "build"], "process time and runtime identity must be captured before the one-time Git inspection")
  assert.deepEqual(identity, {
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId: "runtime-session-123",
    processId: 12345,
    startedAt: "2026-11-09T10:15:30.000Z",
    source: availableBuildMetadata.source,
  }, "the process identity must combine package provenance with the original runtime start facts")
  assert.ok(Object.isFrozen(identity), "the process identity snapshot must be immutable")
  assert.ok(Object.isFrozen(identity.source), "the nested build provenance must be immutable")
})

test("preserves explicit unavailable metadata when build provenance capture fails", () => {
  const identity = createHarvesterProcessIdentity({
    processId: 54321,
    now: () => new Date("2026-11-09T10:15:30.000Z"),
    generateRuntimeSessionId: () => "runtime-session-fallback",
    captureBuildMetadata: () => {
      throw new Error("git metadata unavailable")
    },
  })

  assert.equal(identity.runtimeSessionId, "runtime-session-fallback", "Git inspection failure must not discard the independently captured runtime identity")
  assert.deepEqual(identity.source, {
    branch: null,
    commit: null,
    shortCommit: null,
    commitMessage: null,
    commitDate: null,
    workingTree: "unknown",
    metadataSource: "unavailable",
  }, "failed build metadata capture must produce explicit unknown values rather than preventing process startup")
})

test("rejects invalid process identity dependencies before returning a misleading snapshot", () => {
  assert.throws(
    () => createHarvesterProcessIdentity({ processId: 0 }),
    /processId/,
    "an invalid process identifier must not be recorded as a real operating-system process",
  )
  assert.throws(
    () => createHarvesterProcessIdentity({ now: () => new Date("invalid") }),
    /timestamp/,
    "an invalid process-entry clock result must not be serialized as a valid UTC timestamp",
  )
})

test("uses the development runner shared timestamp and runtime session ID when supplied", () => {
  const identity = createHarvesterProcessIdentity({
    env: { COINZILLA_PROCESS_STARTED_AT: "2026-11-09T10:15:30.000Z", COINZILLA_RUNTIME_SESSION_ID: "shared-session-123" },
    processId: 67890,
    now: () => { throw new Error("runner-provided timestamp must avoid a second clock read") },
    generateRuntimeSessionId: () => { throw new Error("runner-provided session ID must avoid a second ID") },
    captureBuildMetadata: () => availableBuildMetadata,
  })
  assert.equal(identity.startedAt, "2026-11-09T10:15:30.000Z", "process provenance must retain the timestamp shared with log session filenames")
  assert.equal(identity.runtimeSessionId, "shared-session-123", "process provenance must retain the session ID shared with log session filenames")
})
