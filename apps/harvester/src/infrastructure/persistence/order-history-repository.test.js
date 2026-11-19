import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import { createOrderHistoryRepository } from "./order-history-repository.js"
import { createOrderHistoryRecordFixture } from "../../../test-support/order-history-fixtures.js"

async function createDatabaseFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-history-"))
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: path.join(directory, "harvester.db"),
      timeout: 5_000,
    }),
  })
  await database.connect()
  t.after(async () => {
    if (database.state !== "closed") {
      await database.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  return database
}

test("upserts partial and final fills into one real SQLite order record", async (t) => {
  const database = await createDatabaseFixture(t)
  const repository = createOrderHistoryRepository({ database })
  const partial = createOrderHistoryRecordFixture()
  const filled = createOrderHistoryRecordFixture({
    executedQuantity: "1.0000",
    remainingQuantity: "0.0000",
    status: "FILLED",
    updatedAt: 200,
    lastSeenAt: "2026-11-19T00:00:02.000Z",
    lastSourceEventId: "event-filled",
    lastSourceEventName: "order.updated",
    lastSourceEventTimestamp: "2026-11-19T00:00:02.000Z",
  })

  await repository.upsert(partial)
  const updated = await repository.upsert(filled)
  const stored = await database.readOne({
    collection: "harvester_orders",
    id: partial.id,
  })

  assert.ok(stored, "The repository must create the first durable SQLite row.")
  assert.deepEqual(updated, stored, "The repository result must match the durable SQLite record.")
  assert.equal(stored.executedQuantity, "1.0000", "Final cumulative execution must be persisted exactly.")
  assert.equal(stored.status, "FILLED", "The same row must advance to FILLED.")
  assert.equal(stored.firstSourceEventId, partial.firstSourceEventId, "The first source event must survive later upserts.")
})

test("keeps equal client order IDs isolated across provider accounts", async (t) => {
  const database = await createDatabaseFixture(t)
  const repository = createOrderHistoryRepository({ database })
  const first = createOrderHistoryRecordFixture()
  const second = createOrderHistoryRecordFixture({
    providerInstanceId: "binanceSecondary",
    accountId: "binance-secondary",
  })

  await repository.upsert(first)
  await repository.upsert(second)

  const firstStored = await database.readOne({
    collection: "harvester_orders",
    id: first.id,
  })
  const secondStored = await database.readOne({
    collection: "harvester_orders",
    id: second.id,
  })

  assert.ok(firstStored && secondStored, "Both provider accounts must have independent durable order rows.")
  assert.notEqual(first.id, second.id, "Provider/account identity must be part of the durable record key.")
  assert.equal(firstStored.accountId, "binance-primary", "The first account must retain its own order.")
  assert.equal(secondStored.accountId, "binance-secondary", "The second account must retain its own order.")
})

test("supports asynchronous transaction callback providers", async () => {
  const records = new Map()
  const database = {
    capabilities: {
      transactions: {
        callbackMode: "asynchronous",
      },
    },
    transaction: async (operation) => operation({
      readOne: async ({ id }) => records.get(id) ?? null,
      create: async ({ record }) => {
        records.set(record.id, record)
        return record
      },
      update: async ({ id, changes }) => {
        const current = records.get(id)
        if (current === undefined) {
          return null
        }
        const updated = {
          ...current,
          ...changes,
        }
        records.set(id, updated)
        return updated
      },
    }),
  }
  const repository = createOrderHistoryRepository({ database })
  const record = createOrderHistoryRecordFixture()
  const result = await repository.upsert(record)

  assert.deepEqual(result, record, "The repository must support asynchronous provider transaction callbacks.")
  assert.deepEqual(records.get(record.id), record, "The asynchronous provider must receive the complete order record.")
})
