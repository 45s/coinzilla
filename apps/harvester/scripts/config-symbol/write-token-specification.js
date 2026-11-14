import { open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { mergeTokenSpecifications, validateTokenSpecifications } from "../../src/infrastructure/config/token-specifications.js"

async function removeIfPresent(filePath) {
  try {
    await unlink(filePath)
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error
    }
  }
}

async function removeStaleTemporaryFiles({ directory, fileName }) {
  const prefix = `.${fileName}.`
  const entries = await readdir(directory)
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(".tmp.json")) {
      await removeIfPresent(path.join(directory, entry))
    }
  }
}

async function readCurrentSpecifications(specificationPath) {
  let source
  try {
    source = await readFile(specificationPath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {}
    }
    throw new Error(`Unable to read token specification at ${specificationPath}: ${error.message}`, { cause: error })
  }

  let specifications
  try {
    specifications = JSON.parse(source)
  } catch (cause) {
    throw new Error(`Token specification at ${specificationPath} is not valid JSON`, { cause })
  }
  return validateTokenSpecifications(specifications)
}

/**
 * Atomically add or refresh one Binance market specification in the shared token registry.
 *
 * @param {{specificationPath: string, metadata: object}} options - Registry path and normalized Binance metadata.
 * @returns {Promise<string>} Absolute path of the updated registry.
 */
export async function writeTokenSpecificationAtomically({ specificationPath, metadata } = {}) {
  if (typeof specificationPath !== "string" || !specificationPath.trim()) {
    throw new TypeError("specificationPath must be a non-empty file path")
  }
  const absolutePath = path.resolve(specificationPath)
  const lockPath = `${absolutePath}.config-symbol.lock`
  const directory = path.dirname(absolutePath)
  const fileName = path.basename(absolutePath)
  const temporaryPath = path.join(directory, `.${fileName}.${randomUUID()}.tmp.json`)
  let lockHandle
  let temporaryCreated = false

  try {
    try {
      lockHandle = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Another config:symbol operation holds the token specification lock; inspect its PID/timestamp and remove a stale lock only after confirming no generator is running", { cause: error })
      }
      throw error
    }
    await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8")
    await removeStaleTemporaryFiles({ directory, fileName })

    const currentSpecifications = await readCurrentSpecifications(absolutePath)
    const updatedSpecifications = mergeTokenSpecifications({
      tokenSpecifications: currentSpecifications,
      metadata,
    })
    const originalMode = await stat(absolutePath).then((info) => info.mode & 0o777).catch((error) => {
      if (error?.code === "ENOENT") {
        return 0o644
      }
      throw error
    })

    temporaryCreated = true
    await writeFile(temporaryPath, `${JSON.stringify(updatedSpecifications, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: originalMode,
    })
    const writtenSpecifications = await readFile(temporaryPath, "utf8").then((source) => JSON.parse(source))
    validateTokenSpecifications(writtenSpecifications)
    await rename(temporaryPath, absolutePath)
    temporaryCreated = false
    return absolutePath
  } finally {
    try {
      if (temporaryCreated) {
        await removeIfPresent(temporaryPath)
      }
    } finally {
      if (lockHandle) {
        try {
          await lockHandle.close()
        } finally {
          await removeIfPresent(lockPath)
        }
      }
    }
  }
}
