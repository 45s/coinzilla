import { mkdir, open, readFile, rename } from "node:fs/promises"
import path from "node:path"
import { toResult } from "@coinzilla/utils"

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertJsonSafe(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("snapshot cannot contain non-finite numbers")
    return
  }
  if (typeof value !== "object") {
    throw new TypeError(`snapshot cannot contain ${typeof value} values`)
  }
  if (seen.has(value)) throw new TypeError("snapshot cannot contain circular references")
  if (value instanceof Map || value instanceof Set || value instanceof Date || !Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError("snapshot must contain only plain JSON objects and arrays")
  }

  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`snapshot field ${key} cannot be undefined`)
      assertJsonSafe(item, seen)
    }
  }
  seen.delete(value)
}

export function validateGridStateSnapshot({ snapshot } = {}) {
  if (!isPlainObject(snapshot)) {
    return toResult({ errors: ["Grid state snapshot must be a plain object"] })
  }
  if (snapshot.schemaVersion !== 1) {
    return toResult({ errors: ["Grid state snapshot has an unsupported schemaVersion"] })
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    return toResult({ errors: ["Grid state snapshot revision must be a non-negative safe integer"] })
  }
  if (!isPlainObject(snapshot.pairs)) {
    return toResult({ errors: ["Grid state snapshot pairs must be an object keyed by market symbol"] })
  }

  for (const [symbol, pairState] of Object.entries(snapshot.pairs)) {
    if (!symbol.trim() || !isPlainObject(pairState)) {
      return toResult({ errors: ["Grid state snapshot contains an invalid pair entry"] })
    }
  }

  try {
    assertJsonSafe(snapshot)
    JSON.stringify(snapshot)
  } catch (error) {
    return toResult({ error })
  }

  return toResult({ data: snapshot })
}

// Small application-owned snapshot store. It writes to a temporary file in
// the same directory, syncs the file, then atomically renames it over the
// previous snapshot. A failed write leaves the previous committed snapshot
// available for recovery.
export function createGridStateStore({
  directory,
  fileName = "grid-state.json",
} = {}) {
  if (typeof directory !== "string" || !directory.trim()) {
    throw new TypeError("Grid state directory is required")
  }
  if (typeof fileName !== "string" || !fileName.trim() ||
      fileName === "." || fileName === ".." ||
      fileName.includes("/") || fileName.includes("\\\\") ||
      path.basename(fileName) !== fileName) {
    throw new TypeError("Grid state fileName must be a file name without a directory")
  }

  const filePath = path.join(directory, fileName)
  const temporaryPath = `${filePath}.tmp`
  let writeQueue = Promise.resolve()
  let hasRead = false
  let lastRevision = null

  async function read({} = {}) {
    await writeQueue
    try {
      const content = await readFile(filePath, "utf8")
      let snapshot
      try {
        snapshot = JSON.parse(content)
      } catch (error) {
        return toResult({ error: new Error("Grid state snapshot contains invalid JSON", { cause: error }) })
      }

      const validation = validateGridStateSnapshot({ snapshot })
      if (!validation.ok) return validation

      hasRead = true
      lastRevision = snapshot.revision
      return toResult({ data: snapshot, filePath })
    } catch (error) {
      if (error?.code === "ENOENT") {
        hasRead = true
        lastRevision = null
        return toResult({ data: null, filePath })
      }
      return toResult({ error })
    }
  }

  async function write({ snapshot } = {}) {
    const validation = validateGridStateSnapshot({ snapshot })
    if (!validation.ok) return validation

    let serialized
    try {
      serialized = `${JSON.stringify(snapshot)}\n`
    } catch (error) {
      return toResult({ error })
    }

    const task = writeQueue.then(async () => {
      if (!hasRead) {
        throw new Error("Grid state store must read the current snapshot before writing")
      }
      const expectedRevision = lastRevision === null ? 0 : lastRevision + 1
      if (snapshot.revision !== expectedRevision) {
        throw new Error(`Grid state revision mismatch: expected ${expectedRevision}, received ${snapshot.revision}`)
      }

      await mkdir(directory, { recursive: true })
      const fileHandle = await open(temporaryPath, "w", 0o600)
      try {
        await fileHandle.writeFile(serialized, "utf8")
        await fileHandle.sync()
      } finally {
        await fileHandle.close()
      }
      await rename(temporaryPath, filePath)

      lastRevision = snapshot.revision
      return toResult({ data: { revision: lastRevision, filePath } })
    })

    writeQueue = task.then(() => undefined, () => undefined)
    try {
      return await task
    } catch (error) {
      return toResult({ error })
    }
  }

  async function flush({} = {}) {
    await writeQueue
    return toResult({ flushed: true, filePath })
  }

  return Object.freeze({
    filePath,
    flush,
    read,
    write,
  })
}
