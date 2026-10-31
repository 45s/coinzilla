import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createGridStateStore,
  validateGridStateSnapshot,
} from "./grid-state-store.js"

async function createTemporaryStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-grid-state-"))
  return {
    directory,
    store: createGridStateStore({ directory }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

function createSnapshot({ revision = 0, pairs = {} } = {}) {
  return {
    schemaVersion: 1,
    revision,
    pairs,
  }
}

test("validates the versioned Grid snapshot contract", () => {
  const snapshot = createSnapshot({
    pairs: {
      DOGEFDUSD: {
        cycles: [],
        pendingOrderIntents: [],
      },
    },
  })

  assert.equal(validateGridStateSnapshot({ snapshot }).ok, true)
  assert.equal(validateGridStateSnapshot({ snapshot: null }).ok, false)
  assert.equal(validateGridStateSnapshot({
    snapshot: { ...snapshot, schemaVersion: 2 },
  }).ok, false)
  assert.equal(validateGridStateSnapshot({
    snapshot: { ...snapshot, revision: -1 },
  }).ok, false)
  assert.equal(validateGridStateSnapshot({
    snapshot: { ...snapshot, pairs: [] },
  }).ok, false)
  assert.equal(validateGridStateSnapshot({
    snapshot: { ...snapshot, pairs: { DOGEFDUSD: null } },
  }).ok, false)
})

test("rejects non-JSON state, undefined values, and circular references", () => {
  const withMap = createSnapshot({ pairs: { DOGEFDUSD: { cycles: new Map() } } })
  const withUndefined = createSnapshot({ pairs: { DOGEFDUSD: { order: undefined } } })
  const circular = createSnapshot()
  circular.pairs.DOGEFDUSD = {}
  circular.pairs.DOGEFDUSD.self = circular

  assert.equal(validateGridStateSnapshot({ snapshot: withMap }).ok, false)
  assert.equal(validateGridStateSnapshot({ snapshot: withUndefined }).ok, false)
  assert.equal(validateGridStateSnapshot({ snapshot: circular }).ok, false)
})

test("reads a missing snapshot as an explicit empty state", async () => {
  const fixture = await createTemporaryStore()
  try {
    const result = await fixture.store.read()
    assert.equal(result.ok, true)
    assert.equal(result.data, null)
  } finally {
    await fixture.cleanup()
  }
})

test("writes atomically and reads the exact committed snapshot", async () => {
  const fixture = await createTemporaryStore()
  try {
    const snapshot = createSnapshot({
      revision: 0,
      pairs: {
        DOGEFDUSD: {
          cycles: [{ id: "cycle-1", remainingQuantity: "100" }],
          pendingOrderIntents: [],
        },
      },
    })
    assert.equal((await fixture.store.read()).data, null)

    const written = await fixture.store.write({ snapshot })
    const restored = await fixture.store.read()
    const files = await readdir(fixture.directory)
    const fileContent = await readFile(fixture.store.filePath, "utf8")

    assert.equal(written.ok, true)
    assert.equal(written.data.revision, 0)
    assert.deepEqual(restored.data, snapshot)
    assert.equal(fileContent.endsWith("\n"), true)
    assert.deepEqual(files, ["grid-state.json"])
  } finally {
    await fixture.cleanup()
  }
})

test("requires an initial read and strictly increasing snapshot revisions", async () => {
  const fixture = await createTemporaryStore()
  try {
    const initial = createSnapshot()
    const beforeRead = await fixture.store.write({ snapshot: initial })
    assert.equal(beforeRead.ok, false)

    await fixture.store.read()
    assert.equal((await fixture.store.write({ snapshot: initial })).ok, true)
    assert.equal((await fixture.store.write({ snapshot: initial })).ok, false)
    assert.equal((await fixture.store.write({
      snapshot: createSnapshot({ revision: 2 }),
    })).ok, false)
    assert.equal((await fixture.store.write({
      snapshot: createSnapshot({ revision: 1 }),
    })).ok, true)
  } finally {
    await fixture.cleanup()
  }
})

test("serializes concurrent writes in revision order", async () => {
  const fixture = await createTemporaryStore()
  try {
    await fixture.store.read()
    const writes = await Promise.all([
      fixture.store.write({ snapshot: createSnapshot({ revision: 0 }) }),
      fixture.store.write({ snapshot: createSnapshot({ revision: 1 }) }),
      fixture.store.write({ snapshot: createSnapshot({ revision: 2 }) }),
    ])
    const restored = await fixture.store.read()

    assert.deepEqual(writes.map((result) => result.ok), [true, true, true])
    assert.equal(restored.data.revision, 2)
  } finally {
    await fixture.cleanup()
  }
})

test("fails closed on a corrupted persisted snapshot", async () => {
  const fixture = await createTemporaryStore()
  try {
    await fixture.store.read()
    await fixture.store.write({ snapshot: createSnapshot() })
    await writeFile(fixture.store.filePath, "{invalid json", "utf8")

    const restored = await fixture.store.read()
    assert.equal(restored.ok, false)
    assert.match(restored.errors[0].message, /invalid JSON/)
  } finally {
    await fixture.cleanup()
  }
})

test("rejects path traversal in the configured snapshot filename", async () => {
  for (const fileName of ["../state.json", "..\\state.json", "nested/state.json"]) {
    assert.throws(
      () => createGridStateStore({ directory: "/tmp", fileName }),
      /file name/,
    )
  }
})
