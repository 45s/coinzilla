import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_DATABASE_DIRECTORY = fileURLToPath(new URL("../../../data", import.meta.url))
const DATABASE_FILE_NAME = "harvester.db"

function resolveBaseDirectory({ value } = {}) {
  if (value === undefined) {
    return DEFAULT_DATABASE_DIRECTORY
  }
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value === "" ||
    value.includes("\0")
  ) {
    throw new TypeError("HARVESTER_DATABASE_DIRECTORY must be a non-empty absolute path")
  }
  if (!path.isAbsolute(value)) {
    throw new TypeError("HARVESTER_DATABASE_DIRECTORY must be an absolute path")
  }
  const resolved = path.resolve(value)
  if (path.parse(resolved).root === resolved) {
    throw new TypeError("HARVESTER_DATABASE_DIRECTORY must not be a filesystem root")
  }
  return resolved
}

function createDatabasePaths({ tradingMode, env } = {}) {
  if (!["testnet", "live"].includes(tradingMode)) {
    throw new TypeError("TRADING_MODE must be exactly testnet or live")
  }
  const baseDirectory = resolveBaseDirectory({
    value: env?.HARVESTER_DATABASE_DIRECTORY,
  })
  const productionDirectory = path.join(baseDirectory, "production")
  const testnetDirectory = path.join(baseDirectory, "testnet")
  const productionFilename = path.join(productionDirectory, DATABASE_FILE_NAME)
  const testnetFilename = path.join(testnetDirectory, DATABASE_FILE_NAME)
  if (productionFilename === testnetFilename) {
    throw new Error("Production and Testnet database filenames must be different")
  }
  return {
    productionDirectory,
    testnetDirectory,
    productionFilename,
    testnetFilename,
    filename: tradingMode === "live" ? productionFilename : testnetFilename,
  }
}

function isSameOrNestedPath({ parent, candidate } = {}) {
  const relative = path.relative(parent, candidate)
  return relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
}

async function readDatabaseFileIdentity({ filename } = {}) {
  try {
    const stats = await lstat(filename)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Harvester database files must be regular files, not symbolic links")
    }
    return stats
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null
    }
    throw new Error(
      "Unable to validate an existing Harvester database file",
      { cause: error },
    )
  }
}

function assertDistinctDirectories({ productionDirectory, testnetDirectory } = {}) {
  const productionContainsTestnet = isSameOrNestedPath({
    parent: productionDirectory,
    candidate: testnetDirectory,
  })
  const testnetContainsProduction = isSameOrNestedPath({
    parent: testnetDirectory,
    candidate: productionDirectory,
  })
  if (productionContainsTestnet || testnetContainsProduction) {
    throw new Error("Production and Testnet database directories must be separate and non-overlapping")
  }
}

function assertDistinctDatabaseFiles({ productionStats, testnetStats } = {}) {
  const sameFile = productionStats !== null &&
    testnetStats !== null &&
    productionStats.dev === testnetStats.dev &&
    productionStats.ino === testnetStats.ino
  if (sameFile) {
    throw new Error("Production and Testnet database files must not reference the same filesystem object")
  }
}

export function resolveTradingSessionDatabaseFilename({ tradingMode, env = process.env } = {}) {
  const paths = createDatabasePaths({
    tradingMode,
    env,
  })
  assertDistinctDirectories({
    productionDirectory: paths.productionDirectory,
    testnetDirectory: paths.testnetDirectory,
  })
  return paths.filename
}

export async function assertTradingSessionDatabaseIsolation({ tradingMode, env = process.env } = {}) {
  const paths = createDatabasePaths({
    tradingMode,
    env,
  })
  try {
    await Promise.all([
      mkdir(paths.productionDirectory, { recursive: true }),
      mkdir(paths.testnetDirectory, { recursive: true }),
    ])
    const [productionDirectory, testnetDirectory] = await Promise.all([
      realpath(paths.productionDirectory),
      realpath(paths.testnetDirectory),
    ])
    assertDistinctDirectories({
      productionDirectory,
      testnetDirectory,
    })
    const [productionStats, testnetStats] = await Promise.all([
      readDatabaseFileIdentity({
        filename: paths.productionFilename,
      }),
      readDatabaseFileIdentity({
        filename: paths.testnetFilename,
      }),
    ])
    assertDistinctDatabaseFiles({
      productionStats,
      testnetStats,
    })
  } catch (error) {
    throw new Error(
      "Unable to establish separate, safe Production and Testnet database locations",
      { cause: error },
    )
  }
  return paths.filename
}
