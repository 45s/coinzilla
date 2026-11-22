import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createHarvesterArchiveProcessIdentity,
  persistHarvesterArchiveProcessIdentity,
} from "./capture-harvester-archive-process-identity.js"

const PROCESS_STARTED_AT = "2026-11-22T16:45:12.123Z"
const RUNTIME_SESSION_ID = "123e4567-e89b-42d3-a456-426614174000"
const SOURCE_COMMIT = "a".repeat(40)

const source = {
  branch: "feat/harvester-local-dev-reset-archive",
  commit: SOURCE_COMMIT,
  shortCommit: SOURCE_COMMIT.slice(0, 8),
  commitMessage: "feat(harvester): capture archive identity",
  commitDate: "2026-11-22T16:40:00.000Z",
  workingTree: "dirty",
  metadataSource: "git",
}

test("captures an immutable allowlisted TESTNET process identity", () => {
  const identity = createHarvesterArchiveProcessIdentity({
    startedAt: PROCESS_STARTED_AT,
    runtimeSessionId: RUNTIME_SESSION_ID,
    tradingMode: "testnet",
    source,
  })

  assert.deepEqual(identity, {
    formatVersion: 1,
    application: "harvester",
    environment: "testnet",
    startedAt: PROCESS_STARTED_AT,
    runtimeSessionId: RUNTIME_SESSION_ID,
    source,
  }, "the persisted archive identity must contain only the process-start facts needed to identify its source")
  assert.equal(Object.isFrozen(identity), true, "the top-level process identity must be immutable")
  assert.equal(Object.isFrozen(identity.source), true, "the source provenance snapshot must be immutable")
})

test("preserves unavailable startup provenance instead of inventing a commit", () => {
  const identity = createHarvesterArchiveProcessIdentity({
    startedAt: PROCESS_STARTED_AT,
    runtimeSessionId: RUNTIME_SESSION_ID,
    tradingMode: "testnet",
    source: {
      branch: null,
      commit: null,
      shortCommit: null,
      commitMessage: null,
      commitDate: null,
      workingTree: "unknown",
      metadataSource: "unavailable",
    },
  })

  assert.equal(identity.source.commit, null, "missing startup Git provenance must remain explicitly unavailable for the archive command to reject")
  assert.equal(identity.source.workingTree, "unknown", "unknown worktree state must not be presented as clean")
})

test("rejects malformed process-start identity and source commit values", () => {
  assert.throws(
    () => createHarvesterArchiveProcessIdentity({
      startedAt: "not-a-timestamp",
      runtimeSessionId: RUNTIME_SESSION_ID,
      tradingMode: "testnet",
      source,
    }),
    /startedAt/,
    "an invalid process-start timestamp must not be persisted as archive identity",
  )
  assert.throws(
    () => createHarvesterArchiveProcessIdentity({
      startedAt: PROCESS_STARTED_AT,
      runtimeSessionId: "not-a-session-id",
      tradingMode: "testnet",
      source,
    }),
    /runtimeSessionId/,
    "an invalid runtime session identifier must not be persisted as archive identity",
  )
  assert.throws(
    () => createHarvesterArchiveProcessIdentity({
      startedAt: PROCESS_STARTED_AT,
      runtimeSessionId: RUNTIME_SESSION_ID,
      tradingMode: "testnet",
      source: { ...source, commit: "not-a-full-sha" },
    }),
    /commit/,
    "a malformed source commit must be rejected instead of being used in an archive name",
  )
})

test("persists one process identity without overwriting an existing session record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harvester-archive-identity-"))
  const filename = join(directory, "process-identity.json")
  const identity = createHarvesterArchiveProcessIdentity({
    startedAt: PROCESS_STARTED_AT,
    runtimeSessionId: RUNTIME_SESSION_ID,
    tradingMode: "testnet",
    source,
  })

  try {
    await persistHarvesterArchiveProcessIdentity({ filename, identity })
    const persisted = JSON.parse(await readFile(filename, "utf8"))
    assert.deepEqual(persisted, identity, "the session identity file must preserve the exact immutable startup snapshot")
    await assert.rejects(
      persistHarvesterArchiveProcessIdentity({ filename, identity }),
      { code: "EEXIST" },
      "a second launcher must not overwrite the identity already assigned to a process session",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
