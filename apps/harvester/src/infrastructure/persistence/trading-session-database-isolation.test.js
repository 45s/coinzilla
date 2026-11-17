import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import {
  assertTradingSessionDatabaseIsolation,
  resolveTradingSessionDatabaseFilename,
} from "./resolve-trading-session-database-filename.js"

const CHILD_SCRIPT = `
import { createDatabase, createSqliteProvider } from "@coinzilla/db"
import { assertTradingSessionDatabaseIsolation } from "./src/infrastructure/persistence/resolve-trading-session-database-filename.js"

const filename = await assertTradingSessionDatabaseIsolation({
  tradingMode: process.env.TRADING_MODE,
  env: process.env,
})
const database = createDatabase({
  provider: createSqliteProvider({ filename, timeout: 5000 }),
})
await database.connect()
try {
  await database.create({
    collection: "process_isolation",
    record: {
      id: "same-runtime-session-id",
      environment: process.env.TRADING_MODE,
      marker: process.env.TRADING_MODE,
    },
  })
  process.stdout.write(JSON.stringify({ filename }))
} finally {
  await database.close()
}
`

function runDatabaseProcess({ tradingMode, nodeEnvironment, directory }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TRADING_MODE: tradingMode,
        NODE_ENV: nodeEnvironment,
        HARVESTER_DATABASE_DIRECTORY: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Harvester database child process failed (${code}): ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error("Harvester database child process returned invalid JSON output", { cause: error }))
      }
    })
  })
}

async function readProcessRecord({ filename }) {
  const database = createDatabase({
    provider: createSqliteProvider({ filename, timeout: 5_000 }),
  })
  await database.connect()
  try {
    return await database.readOne({
      collection: "process_isolation",
      id: "same-runtime-session-id",
    })
  } finally {
    await database.close()
  }
}

test("resolves database files from explicit TRADING_MODE, never NODE_ENV", () => {
  const directory = path.join(os.tmpdir(), "harvester-database-root")
  const liveFilename = resolveTradingSessionDatabaseFilename({
    tradingMode: "live",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
      NODE_ENV: "test",
    },
  })
  const testnetFilename = resolveTradingSessionDatabaseFilename({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
      NODE_ENV: "production",
    },
  })

  assert.equal(path.basename(path.dirname(liveFilename)), "production", "TRADING_MODE=live must select the production database directory even when NODE_ENV=test.")
  assert.equal(path.basename(path.dirname(testnetFilename)), "testnet", "TRADING_MODE=testnet must select the Testnet database directory even when NODE_ENV=production.")
  assert.notEqual(liveFilename, testnetFilename, "Production and Testnet must never resolve to the same SQLite filename.")
})

test("rejects invalid trading modes and unsafe configured database paths", () => {
  assert.throws(
    () => resolveTradingSessionDatabaseFilename({ tradingMode: "development", env: {} }),
    /TRADING_MODE must be exactly testnet or live/,
    "An unrecognized trading mode must never select a database environment.",
  )
  assert.throws(
    () => resolveTradingSessionDatabaseFilename({
      tradingMode: "live",
      env: { HARVESTER_DATABASE_DIRECTORY: "relative/database/path" },
    }),
    /HARVESTER_DATABASE_DIRECTORY must be an absolute path/,
    "A relative database directory must be rejected instead of depending on the shell working directory.",
  )
  assert.throws(
    () => resolveTradingSessionDatabaseFilename({
      tradingMode: "testnet",
      env: { HARVESTER_DATABASE_DIRECTORY: path.parse(process.cwd()).root },
    }),
    /HARVESTER_DATABASE_DIRECTORY must not be a filesystem root/,
    "A filesystem root must not be accepted as the Harvester database directory.",
  )
})

test("isolates production and Testnet databases across two real Node.js processes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-db-process-isolation-"))
  t.after(async () => rm(directory, { recursive: true, force: true }))

  const [liveProcess, testnetProcess] = await Promise.all([
    runDatabaseProcess({
      tradingMode: "live",
      nodeEnvironment: "test",
      directory,
    }),
    runDatabaseProcess({
      tradingMode: "testnet",
      nodeEnvironment: "production",
      directory,
    }),
  ])

  assert.notEqual(liveProcess.filename, testnetProcess.filename, "Independent Harvester processes must resolve distinct production and Testnet database files.")
  assert.equal(path.basename(path.dirname(liveProcess.filename)), "production", "The live process must write only to the production database directory.")
  assert.equal(path.basename(path.dirname(testnetProcess.filename)), "testnet", "The Testnet process must write only to the Testnet database directory.")

  const [liveRecord, testnetRecord] = await Promise.all([
    readProcessRecord({ filename: liveProcess.filename }),
    readProcessRecord({ filename: testnetProcess.filename }),
  ])
  assert.equal(liveRecord.environment, "live", "The production database must contain only the live process's session marker.")
  assert.equal(testnetRecord.environment, "testnet", "The Testnet database must contain only the Testnet process's session marker.")
})
