import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { FileSystemJournalStore } from "./filesystem-journal-store.js"

test("owns the lock and session handles across append, sync, read, and release", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-"))
  const directory = path.join(rootDirectory, "nested", "journal")
  const store = new FileSystemJournalStore({ directory })
  const event = { id: "adapter-record", name: "journal.adapter_verified" }
  const line = `${JSON.stringify(event)}\n`
  const lockFileName = ".coinzilla-journal.lock"

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    const lockContent = await readFile(path.join(directory, lockFileName), "utf8")
    const lockMetadata = JSON.parse(lockContent)
    assert.equal(typeof lockMetadata.pid, "number", "The owned directory lock must record the acquiring process ID for operator diagnostics.")
    assert.equal(typeof lockMetadata.startedAt, "string", "The owned directory lock must record its acquisition timestamp for operator diagnostics.")

    const { filePath } = await store.createSession()
    const sessionFileName = path.basename(filePath)
    assert.match(sessionFileName, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/, "The adapter must create an exclusively named timestamped JSONL session file.")
    await store.append(line)
    await store.sync()

    const sessionEntries = await store.listSessions()
    assert.equal(sessionEntries.some((entry) => entry.name === sessionFileName && entry.isFile), true, "Session discovery must expose the active JSONL file as a regular file entry.")
    const fileStats = await store.statSession(sessionFileName)
    assert.equal(fileStats.size, Buffer.byteLength(line), "Session stat must report the exact byte length written to the JSONL file.")
    const storedContent = await store.readSession(sessionFileName)
    assert.equal(storedContent.toString("utf8"), line, "Session reads must return the original JSONL bytes without parsing, repairing, or rewriting history.")

    await store.closeSession()
    assert.equal(store.sessionHandle, null, "Closing the session must release the file handle owned by this adapter.")
    await store.releaseWriter()
    assert.equal(store.lockFileHandle, null, "Releasing writer ownership must close the lock handle owned by this adapter.")
    assert.equal(store.lockFilePath, null, "Releasing writer ownership must clear only this adapter’s lock path after unlink succeeds.")
    assert.equal((await readdir(directory)).includes(lockFileName), false, "A successful release must remove the lock file acquired by this adapter.")
  } finally {
    await store.closeSession()
    await store.releaseWriter()
    await rm(rootDirectory, { recursive: true, force: true })
  }
})

test("preserves a pre-existing lock when another adapter cannot acquire ownership", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-contended-"))
  const lockFilePath = path.join(directory, ".coinzilla-journal.lock")
  const existingLock = `${JSON.stringify({ pid: 98765, startedAt: "2026-11-08T00:00:00.000Z" })}\n`
  const store = new FileSystemJournalStore({ directory })

  try {
    await writeFile(lockFilePath, existingLock, { flag: "wx" })
    await store.ensureDirectory()
    await assert.rejects(store.acquireWriter(), { code: "JOURNAL_DIRECTORY_LOCKED" }, "A second adapter must fail with the stable lock-contention code instead of stealing an existing writer lock.")
    assert.equal(await readFile(lockFilePath, "utf8"), existingLock, "A failed contender must preserve the other writer’s lock bytes exactly.")
    await store.releaseWriter()
    assert.equal(await readFile(lockFilePath, "utf8"), existingLock, "Releasing an adapter that never acquired ownership must not unlink another writer’s lock.")
    assert.equal((await readdir(directory)).some((entry) => entry.endsWith(".jsonl")), false, "A lock contender must not create a session file before acquiring exclusive directory ownership.")
  } finally {
    await store.closeSession()
    await store.releaseWriter()
    await rm(directory, { recursive: true, force: true })
  }
})
