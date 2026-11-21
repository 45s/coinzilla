import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolveHarvesterDatabaseFilename } from "../src/infrastructure/persistence/resolve-harvester-database-filename.js"


function resolveExporterCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return "unavailable"
  }
}

function escapeIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function serializeDatabaseRow({ row } = {}) {
  const serializedRow = Object.create(null)
  for (const [columnName, columnValue] of Object.entries(row)) {
    if (typeof columnValue === "bigint") {
      const numericValue = Number(columnValue)
      serializedRow[columnName] = Number.isSafeInteger(numericValue)
        ? numericValue
        : columnValue.toString()
    } else if (columnValue instanceof Uint8Array) {
      serializedRow[columnName] = {
        encoding: "base64",
        data: Buffer.from(columnValue).toString("base64"),
      }
    } else {
      serializedRow[columnName] = columnValue
    }
  }
  return serializedRow
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
    const exportedTables = Object.create(null)
    const tableCounts = Object.create(null)

    for (const { name } of tableRows) {
      const statement = database.prepare(`SELECT * FROM ${escapeIdentifier(name)}`)
      statement.setReadBigInts(true)
      const rows = statement.all()
      const serializedRows = []
      for (const row of rows) {
        serializedRows.push(serializeDatabaseRow({
          row,
        }))
      }
      exportedTables[name] = serializedRows
      tableCounts[name] = serializedRows.length
    }

    writeFileSync(
      outputFilename,
      `${JSON.stringify({
        database: exportedTables,
      }, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    )

    return {
      tableCount: tableRows.length,
      tableCounts: Object.fromEntries(Object.entries(tableCounts)),
      outputFilename,
    }
  } finally {
    database.close()
  }
}

/**
 * Export the selected Harvester database without modifying its SQLite source.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} [options.env=process.env] - Environment used by the database path resolver.
 * @param {"testnet"|"live"} options.tradingMode - Explicit database environment.
 * @returns {{tableCount: number, tableCounts: Record<string, number>, outputFilename: string}}
 * @throws {TypeError} When the requested environment is not exactly "testnet" or "live".
 */
export function runDatabaseExport({ env = process.env, tradingMode } = {}) {
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw new TypeError('Environment must be "testnet" or "live".')
  }
  const databaseFilename = resolveHarvesterDatabaseFilename({
    tradingMode,
    env,
  })
  const outputFilename = path.join(path.dirname(databaseFilename), "database-dump.json")
  const result = exportDatabase({
    databaseFilename,
    outputFilename,
  })

  process.stdout.write(`Exporter commit: ${resolveExporterCommit()}\n`)
  process.stdout.write(`Exported ${result.tableCount} tables to ${result.outputFilename}\n`)
  for (const [tableName, rowCount] of Object.entries(result.tableCounts)) {
    process.stdout.write(`- ${tableName}: ${rowCount} records\n`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tradingMode, ...unexpectedArguments] = process.argv.slice(2)
  if (
    (tradingMode !== "testnet" && tradingMode !== "live")
    || unexpectedArguments.length > 0
  ) {
    process.stderr.write("Usage: pnpm run db:export <testnet|live>\n")
    process.exitCode = 1
  } else {
    try {
      runDatabaseExport({
        tradingMode,
      })
    } catch (error) {
      process.stderr.write(`Database export failed: ${error.message}\n`)
      process.exitCode = 1
    }
  }
}
