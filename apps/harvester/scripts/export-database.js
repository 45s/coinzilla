import { DatabaseSync } from "node:sqlite"
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { resolveTradingSessionDatabaseFilename } from "../src/infrastructure/persistence/resolve-trading-session-database-filename.js"

function escapeIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function serializeDatabaseValue(_key, value) {
  if (typeof value === "bigint") {
    return value.toString()
  }
  if (value instanceof Uint8Array) {
    return {
      encoding: "base64",
      data: Buffer.from(value).toString("base64"),
    }
  }
  return value
}

export function exportDatabase({ databaseFilename, outputFilename } = {}) {
  if (!databaseFilename || !existsSync(databaseFilename)) {
    throw new Error(`SQLite database file does not exist: ${databaseFilename ?? "(not specified)"}`)
  }
  if (!outputFilename) {
    throw new TypeError("An output filename is required.")
  }
  if (path.resolve(databaseFilename) === path.resolve(outputFilename)) {
    throw new TypeError("The JSON output must not overwrite the SQLite source database.")
  }

  const database = new DatabaseSync(databaseFilename, {
    readOnly: true,
  })
  try {
    const tableRows = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all()
    const exportedTables = {}
    const tableCounts = {}

    for (const { name } of tableRows) {
      const rows = database.prepare(`SELECT * FROM ${escapeIdentifier(name)}`).all()
      exportedTables[name] = rows
      tableCounts[name] = rows.length
    }

    writeFileSync(
      outputFilename,
      JSON.stringify({ database: exportedTables }, serializeDatabaseValue, 2) + "\n",
      { encoding: "utf8", mode: 0o600 },
    )

    return {
      tableCount: tableRows.length,
      tableCounts,
      outputFilename,
    }
  } finally {
    database.close()
  }
}

export function runDatabaseExport({ env = process.env } = {}) {
  const tradingMode = env.TRADING_MODE
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw new TypeError("TRADING_MODE must be explicitly set to testnet or live.")
  }
  const databaseFilename = resolveTradingSessionDatabaseFilename({
    tradingMode,
    env,
  })
  const outputFilename = path.join(path.dirname(databaseFilename), "database-dump.json")
  const result = exportDatabase({
    databaseFilename,
    outputFilename,
  })

  process.stdout.write(`Exported ${result.tableCount} tables to ${result.outputFilename}\n`)
  for (const [tableName, rowCount] of Object.entries(result.tableCounts)) {
    process.stdout.write(`- ${tableName}: ${rowCount} records\n`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runDatabaseExport()
  } catch (error) {
    process.stderr.write(`Database export failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
