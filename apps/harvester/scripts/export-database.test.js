import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { exportDatabase } from "./export-database.js"

function createDatabase(directory) {
  const filename = path.join(directory, "harvester.db")
  const database = new DatabaseSync(filename)
  database.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, quantity TEXT);
    CREATE TABLE empty_table (id TEXT PRIMARY KEY);
    INSERT INTO orders VALUES ('order-1', 'DOGEUSDT', '12.500');
  `)
  database.close()
  return filename
}

test("exports every user table and row as lossless JSON arrays", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    const result = exportDatabase({ databaseFilename, outputFilename })
    const dump = JSON.parse(readFileSync(outputFilename, "utf8"))
    assert.deepEqual(Object.keys(dump.database).sort(), ["empty_table", "orders"], "The dump must include every non-internal table, including empty tables.")
    assert.deepEqual(dump.database.orders, [{ id: "order-1", symbol: "DOGEUSDT", quantity: "12.500" }], "The dump must preserve every row and the exact stored decimal text.")
    assert.deepEqual(dump.database.empty_table, [], "An empty table must be represented by an empty array.")
    assert.deepEqual(result.tableCounts, { empty_table: 0, orders: 1 }, "The export summary must report the row count for each table.")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("does not create a missing source database", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = path.join(directory, "missing.db")
    const outputFilename = path.join(directory, "database-dump.json")
    assert.throws(
      () => exportDatabase({ databaseFilename, outputFilename }),
      /database file does not exist/i,
      "Export must fail clearly instead of creating an empty database when the source is missing.",
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("opens the source read-only and leaves database bytes unchanged", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    const before = readFileSync(databaseFilename)
    exportDatabase({ databaseFilename, outputFilename })
    const after = readFileSync(databaseFilename)
    assert.deepEqual(after, before, "A read-only export must not modify the source SQLite database.")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
