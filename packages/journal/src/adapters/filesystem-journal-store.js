import { mkdir, open, opendir, readFile, stat, unlink } from "node:fs/promises"
import path from "node:path"

const JOURNAL_DIRECTORY_LOCK_FILE = ".coinzilla-journal.lock"

/**
 * Own all Node filesystem resources used by one Journal directory.
 * The Journal service owns lifecycle policy and write ordering; this adapter owns
 * session/lock handles and the filesystem operations used for bounded recovery.
 *
 * @param {{ directory: string }} options
 */
export class FileSystemJournalStore {
  constructor({ directory } = {}) {
    this.directory = directory
    this.ownedSessionHandle = null
    this.sessionHandleOverride = null
    this.lockFileHandle = null
    this.lockFilePath = null
  }

  /**
   * Create the journal directory when it does not already exist.
   * @returns {Promise<void>}
   */
 /**
   * Compatibility view used only by the deprecated Journal.fileHandle accessor.
   * The adapter continues to own both the real and any replacement handle.
   *
   * @returns {object|null} Active session handle.
   */
  get sessionHandle() {
    return this.sessionHandleOverride ?? this.ownedSessionHandle
  }

  /**
   * Install or clear a legacy test override without discarding the owned handle.
   *
   * @param {object|null} handle - Replacement handle or null to clear the override.
   * @returns {void}
   */
  set sessionHandle(handle) {
    this.sessionHandleOverride = handle
  }



  async ensureDirectory() {
    await mkdir(this.directory, { recursive: true })
  }

  /**
   * Acquire exclusive writer ownership before creating a session file.
   * Existing locks are never removed or rewritten by a contender.
   * @returns {Promise<void>}
   * @throws {Error} With code JOURNAL_DIRECTORY_LOCKED when another lock exists.
   */
  async acquireWriter() {
    const lockFilePath = path.join(this.directory, JOURNAL_DIRECTORY_LOCK_FILE)
    let lockFileHandle
    try {
      lockFileHandle = await open(lockFilePath, "wx", 0o600)
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause
      const error = new Error(`Journal directory is already locked: ${this.directory}. Verify that no writer is active before removing ${lockFilePath}.`)
      error.code = "JOURNAL_DIRECTORY_LOCKED"
      error.details = { directory: this.directory, lockFilePath }
      error.cause = cause
      throw error
    }
    this.lockFileHandle = lockFileHandle
    this.lockFilePath = lockFilePath
    const metadata = { pid: process.pid, startedAt: new Date().toISOString() }
    await lockFileHandle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8")
  }

  /**
   * Create a timestamped, exclusively-created JSONL session file.
   * @returns {Promise<{ filePath: string }>} Created session path.
   */
  async createSession() {
    const timestamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
    for (let index = 0; ; index += 1) {
      const suffix = index === 0 ? "" : `-${String(index).padStart(3, "0")}`
      const filePath = path.join(this.directory, `${timestamp}${suffix}.jsonl`)
      try {
        const sessionHandle = await open(filePath, "wx")
        this.ownedSessionHandle = sessionHandle
        return { filePath }
      } catch (error) {
        if (error.code !== "EEXIST") throw error
      }
    }
  }

  /**
   * Append one already-serialized JSONL line to the active session.
   * @param {string} line - Complete JSONL line including its line terminator.
   * @returns {Promise<void>}
   */
  async append(line) {
    if (!this.sessionHandle) throw new Error("Journal session file is not open")
    await this.sessionHandle.writeFile(line, "utf8")
  }

  /**
   * Sync active session file contents; this does not sync directory entries.
   * @returns {Promise<void>}
   */
  async sync() {
    if (!this.sessionHandle) throw new Error("Journal session file is not open")
    await this.sessionHandle.sync()
  }

  /**
   * Close the session handle owned by this adapter.
   * @returns {Promise<void>}
   */
  async closeSession() {
    const sessionHandles = [
      ...new Set([this.sessionHandleOverride, this.ownedSessionHandle].filter(Boolean)),
    ]
    this.sessionHandleOverride = null
    this.ownedSessionHandle = null

    const errors = []
    for (const sessionHandle of sessionHandles) {
      try {
        await sessionHandle.close()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, "Failed to close all Journal session handles")
    }
  }

  /**
   * Close and unlink only the writer lock acquired by this adapter.
   * @returns {Promise<void>}
   */
  async releaseWriter() {
    if (this.lockFileHandle) {
      await this.lockFileHandle.close()
      this.lockFileHandle = null
    }
    if (this.lockFilePath) {
      await unlink(this.lockFilePath)
      this.lockFilePath = null
    }
  }

  /**
   * List directory entries without deciding which names are valid sessions.
   * @returns {Promise<Array<{ name: string, isFile: boolean }>>}
   */
  async listSessions() {
    const entries = []
    const directoryHandle = await opendir(this.directory)
    for await (const entry of directoryHandle) {
      entries.push({ name: entry.name, isFile: entry.isFile() })
    }
    return entries
  }

  /**
   * Return filesystem size metadata for one session file.
   * @param {string} fileName - Session file basename from listSessions().
   * @returns {Promise<import("node:fs").Stats>}
   */
  async statSession(fileName) {
    return stat(path.join(this.directory, fileName))
  }

  /**
   * Read the original bytes of one session file without repairing or rewriting it.
   * @param {string} fileName - Session file basename from listSessions().
   * @returns {Promise<Buffer>}
   */
  async readSession(fileName) {
    return readFile(path.join(this.directory, fileName))
  }
}