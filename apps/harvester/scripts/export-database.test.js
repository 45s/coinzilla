import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import {
  exportDatabase,
  runDatabaseExport,
} from "./export-database.js"

function createDatabase(directory) {
  const filename = path.join(directory, "harvester.db")
  const database = new DatabaseSync(filename)
  database.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      quantity TEXT,
      safe_integer INTEGER,
      unsafe_integer INTEGER,
      large_integer INTEGER,
      payload BLOB
    );
    CREATE TABLE empty_table (id TEXT PRIMARY KEY);
    INSERT INTO orders VALUES ('order-1', 'DOGEUSDT', '12.500', 9007199254740991, 9007199254740992, 9223372036854775807, X'00FF');
  `)
  database.close()
  return filename
}

function createSpecialIdentifierDatabase(directory) {
  const filename = path.join(directory, "special-identifiers.db")
  const database = new DatabaseSync(filename)
  database.exec(`
    CREATE TABLE "__proto__" ("__proto__" TEXT);
    INSERT INTO "__proto__" VALUES ('preserved');
  `)
  database.close()
  return filename
}

test("exports every user table and row as lossless JSON arrays", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    const result = exportDatabase({
      databaseFilename,
      outputFilename,
    })
    const dump = JSON.parse(readFileSync(outputFilename, "utf8"))
    assert.deepEqual(
      Object.keys(dump.database).sort(),
      ["empty_table", "orders"],
      "The dump must include every non-internal table, including empty tables.",
    )
    assert.deepEqual(
      dump.database.orders,
      [{
        id: "order-1",
        symbol: "DOGEUSDT",
        quantity: "12.500",
        safe_integer: 9007199254740991,
        unsafe_integer: "9007199254740992",
        large_integer: "9223372036854775807",
        payload: {
          encoding: "base64",
          data: "AP8=",
        },
      }],
      "The dump must preserve every row, exact decimal text, 64-bit integers and BLOB bytes.",
    )
    assert.deepEqual(
      dump.database.empty_table,
      [],
      "An empty table must be represented by an empty array.",
    )
    assert.deepEqual(
      result.tableCounts,
      {
        empty_table: 0,
        orders: 1,
      },
      "The export summary must report the row count for each table.",
    )
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("preserves a __proto__ table name in the returned table counts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createSpecialIdentifierDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    const result = exportDatabase({
      databaseFilename,
      outputFilename,
    })
    assert.equal(
      Object.hasOwn(result.tableCounts, "__proto__"),
      true,
      "The table-count summary must retain __proto__ as an own table-name property.",
    )
    assert.equal(
      Reflect.get(result.tableCounts, "__proto__"),
      1,
      "The table-count summary must report the row count for the __proto__ table.",
    )
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("preserves a __proto__ column name in exported rows", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createSpecialIdentifierDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    exportDatabase({
      databaseFilename,
      outputFilename,
    })
    const dump = JSON.parse(readFileSync(outputFilename, "utf8"))
    const specialTableRows = Reflect.get(dump.database, "__proto__")
    assert.equal(
      Reflect.get(specialTableRows[0], "__proto__"),
      "preserved",
      "The exported row must preserve __proto__ as a data column rather than a prototype setter.",
    )
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("does not create a missing source database", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = path.join(directory, "missing.db")
    const outputFilename = path.join(directory, "database-dump.json")
    assert.throws(
      () => exportDatabase({
        databaseFilename,
        outputFilename,
      }),
      /database file does not exist/i,
      "Export must fail clearly instead of creating an empty database when the source is missing.",
    )
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("opens the source read-only and leaves database bytes unchanged", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "harvester-json-export-"))
  try {
    const databaseFilename = createDatabase(directory)
    const outputFilename = path.join(directory, "database-dump.json")
    const before = readFileSync(databaseFilename)
    exportDatabase({
      databaseFilename,
      outputFilename,
    })
    const after = readFileSync(databaseFilename)
    assert.deepEqual(
      after,
      before,
      "A read-only export must not modify the source SQLite database.",
    )
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("requires an explicit TESTNET or LIVE command argument", () => {
  assert.throws(
    () => runDatabaseExport({
      env: {},
    }),
    /Environment must be "testnet" or "live"/i,
    "The export command must require an explicit environment argument.",
  )
})

test("rejects unsupported database environment arguments", () => {
  assert.throws(
    () => runDatabaseExport({
      env: {},
      tradingMode: "staging",
    }),
    /Environment must be "testnet" or "live"/i,
    "The export command must reject environments other than TESTNET and LIVE.",
  )
})

test("prints concise usage when the command argument is missing", () => {
  const scriptFilename = fileURLToPath(new URL("./export-database.js", import.meta.url))
  const result = spawnSync(process.execPath, [scriptFilename], {
    encoding: "utf8",
  })
  assert.equal(
    result.status,
    1,
    "The CLI must exit unsuccessfully when no database environment is supplied.",
  )
  assert.equal(
    result.stderr.trim(),
    "Usage: pnpm run db:export <testnet|live>",
    "The CLI must show the exact supported command syntax without a stack trace.",
  )
})

test("prints concise usage when the command argument is invalid", () => {
  const scriptFilename = fileURLToPath(new URL("./export-database.js", import.meta.url))
  const result = spawnSync(process.execPath, [scriptFilename, "staging"], {
    encoding: "utf8",
  })
  assert.equal(
    result.status,
    1,
    "The CLI must exit unsuccessfully when an unsupported database environment is supplied.",
  )
  assert.equal(
    result.stderr.trim(),
    "Usage: pnpm run db:export <testnet|live>",
    "The CLI must show usage instead of forwarding an invalid value to database resolution.",
  )
})
