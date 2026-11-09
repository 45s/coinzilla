import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
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

test("closes the owned session handle when a legacy compatibility override is installed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-override-"))
  const store = new FileSystemJournalStore({ directory })
  let overrideClosed = false

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    await store.createSession()
    const ownedHandle = store.ownedSessionHandle
    store.sessionHandle = {
      writeFile: async () => {},
      sync: async () => {},
      close: async () => { overrideClosed = true },
    }

    await store.closeSession()
    assert.equal(
      overrideClosed,
      true,
      "Closing the adapter must close the compatibility handle used by legacy failure-injection tests.",
    )
    assert.equal(
      store.sessionHandle,
      null,
      "Closing the adapter must clear the compatibility override and expose no active handle.",
    )
    assert.equal(
      store.ownedSessionHandle,
      null,
      "Closing the adapter must also release the original filesystem handle it continues to own.",
    )
    await assert.rejects(
      ownedHandle.stat(),
      { code: "EBADF" },
      "Replacing the visible handle must not leak the original open filesystem descriptor.",
    )
  } finally {
    await store.closeSession()
    await store.releaseWriter()
    await rm(directory, { recursive: true, force: true })
  }
})


test("retains an owned session handle when close fails and releases it on retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-close-retry-"))
  const store = new FileSystemJournalStore({ directory })
  const closeError = new Error("simulated owned session close failure")
  let closeAttempts = 0
  let ownedHandle

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    await store.createSession()
    ownedHandle = store.ownedSessionHandle
    const originalClose = ownedHandle.close.bind(ownedHandle)
    ownedHandle.close = async () => {
      closeAttempts += 1
      if (closeAttempts === 1) throw closeError
      return originalClose()
    }

    await assert.rejects(
      store.closeSession(),
      (error) => error === closeError,
      "A failed owned-handle close must preserve the original close error for the caller.",
    )
    assert.equal(store.ownedSessionHandle, ownedHandle, "The adapter must retain ownership of a session handle when close rejects so cleanup can retry it.")
    assert.equal(store.sessionHandle, ownedHandle, "The active session view must continue to expose the handle whose close did not complete.")

    await store.closeSession()
    assert.equal(closeAttempts, 2, "A second cleanup attempt must retry the same owned handle exactly once.")
    assert.equal(store.ownedSessionHandle, null, "A successfully closed owned handle must be released from adapter state.")
    assert.equal(store.sessionHandle, null, "A successfully closed session must no longer be exposed as active.")
  } finally {
    await store.closeSession().catch(() => {})
    if (ownedHandle && store.ownedSessionHandle !== ownedHandle) await ownedHandle.close().catch(() => {})
    await store.releaseWriter().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test("retains only a failed compatibility handle while closing the owned session handle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-override-retry-"))
  const store = new FileSystemJournalStore({ directory })
  const closeError = new Error("simulated compatibility handle close failure")
  let overrideCloseAttempts = 0
  const overrideHandle = {
    writeFile: async () => {},
    sync: async () => {},
    close: async () => {
      overrideCloseAttempts += 1
      if (overrideCloseAttempts === 1) throw closeError
    },
  }

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    await store.createSession()
    const ownedHandle = store.ownedSessionHandle
    store.sessionHandle = overrideHandle

    await assert.rejects(store.closeSession(), (error) => error === closeError, "A failed compatibility-handle close must remain visible as the original cleanup failure.")
    assert.equal(store.sessionHandle, overrideHandle, "The adapter must retain the failed compatibility handle rather than clearing its only retry reference.")
    assert.equal(store.ownedSessionHandle, null, "A different owned session handle that closed successfully must not remain retained.")
    await assert.rejects(ownedHandle.stat(), { code: "EBADF" }, "Successful cleanup of the owned filesystem handle must close its descriptor even when the override fails.")

    await store.closeSession()
    assert.equal(overrideCloseAttempts, 2, "A later cleanup attempt must retry only the failed compatibility handle.")
    assert.equal(store.sessionHandle, null, "The adapter must clear the compatibility handle after its close succeeds.")
  } finally {
    await store.closeSession().catch(() => {})
    await store.releaseWriter().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test("retains the writer lock handle when closing it fails and retries lock release", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-lock-close-retry-"))
  const store = new FileSystemJournalStore({ directory })
  const closeError = new Error("simulated lock handle close failure")
  let closeAttempts = 0

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    const lockHandle = store.lockFileHandle
    const lockPath = store.lockFilePath
    const originalClose = lockHandle.close.bind(lockHandle)
    lockHandle.close = async () => {
      closeAttempts += 1
      if (closeAttempts === 1) throw closeError
      return originalClose()
    }

    await assert.rejects(store.releaseWriter(), (error) => error === closeError, "A failed lock-handle close must be returned without being hidden by later cleanup.")
    assert.equal(store.lockFileHandle, lockHandle, "The adapter must retain the lock handle until its close operation succeeds.")
    assert.equal(store.lockFilePath, lockPath, "The adapter must retain the owned lock path while the lock handle is still open.")
    assert.ok(await readFile(lockPath, "utf8"), "A failed lock close must not unlink the still-owned lock file.")

    await store.releaseWriter()
    assert.equal(closeAttempts, 2, "A later release attempt must retry closing the same lock handle.")
    assert.equal(store.lockFileHandle, null, "A successfully closed lock handle must be released from adapter state.")
    assert.equal(store.lockFilePath, null, "A successfully released lock must clear its owned path.")
    assert.equal((await readdir(directory)).includes(".coinzilla-journal.lock"), false, "A successful retry must remove the lock file.")
  } finally {
    await store.releaseWriter().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test("retains the owned lock path when unlink fails and retries unlink after restoration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-unlink-retry-"))
  const movedDirectory = `${directory}-moved`
  const store = new FileSystemJournalStore({ directory })

  try {
    await store.ensureDirectory()
    await store.acquireWriter()
    const lockPath = store.lockFilePath
    await rename(directory, movedDirectory)

    await assert.rejects(store.releaseWriter(), { code: "ENOENT" }, "A missing lock path must surface the unlink failure rather than pretending writer ownership was released.")
    assert.equal(store.lockFileHandle, null, "The lock handle that closed successfully must not be retained after unlink fails.")
    assert.equal(store.lockFilePath, lockPath, "The adapter must retain the exact owned lock path so unlink can be retried.")
    await rename(movedDirectory, directory)

    await store.releaseWriter()
    assert.equal(store.lockFilePath, null, "A successful unlink retry must clear the retained lock path.")
    assert.equal((await readdir(directory)).includes(".coinzilla-journal.lock"), false, "The retry must remove only the lock file originally acquired by this adapter.")
  } finally {
    await store.releaseWriter().catch(() => {})
    await rm(directory, { recursive: true, force: true })
    await rm(movedDirectory, { recursive: true, force: true })
  }
})

test("tracks a partially acquired writer lock when writing its metadata fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-partial-lock-"))
  const probeHandle = await open(path.join(directory, "probe"), "w")
  const fileHandlePrototype = Object.getPrototypeOf(probeHandle)
  const originalWriteFile = fileHandlePrototype.writeFile
  const metadataError = new Error("simulated lock metadata write failure")
  const store = new FileSystemJournalStore({ directory })

  try {
    fileHandlePrototype.writeFile = async () => {
      throw metadataError
    }

    await assert.rejects(store.acquireWriter(), (error) => error === metadataError, "A metadata-write failure after exclusive lock creation must preserve the original acquisition error.")
    assert.ok(store.lockFileHandle, "The adapter must retain the lock handle acquired before metadata writing failed.")
    assert.equal(store.lockFilePath, path.join(directory, ".coinzilla-journal.lock"), "The adapter must retain the exact lock path acquired before metadata writing failed.")
    assert.equal((await readdir(directory)).includes(".coinzilla-journal.lock"), true, "Partial acquisition must remain represented on disk until the owning adapter performs rollback.")

    fileHandlePrototype.writeFile = originalWriteFile
    await store.releaseWriter()
    assert.equal(store.lockFileHandle, null, "Rollback must close the partially acquired lock handle.")
    assert.equal(store.lockFilePath, null, "Rollback must clear the lock path only after unlink succeeds.")
    assert.equal((await readdir(directory)).includes(".coinzilla-journal.lock"), false, "Rollback must remove the lock created by the failed acquisition attempt.")
  } finally {
    fileHandlePrototype.writeFile = originalWriteFile
    await probeHandle.close()
    await store.closeSession().catch(() => {})
    await store.releaseWriter().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})
