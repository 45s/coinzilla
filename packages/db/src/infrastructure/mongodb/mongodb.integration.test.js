import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import test from "node:test"

import {
  createDatabase,
  createMongoProvider,
  DatabaseTransactionUnsupportedError,
} from "../../index.js"
import { createMongoTransport } from "./transport.js"
import {
  parseMongoConnectionString,
  performMongoHandshake,
} from "./handshake.js"
import { runDatabaseProviderConformanceTests } from "../../../test-support/provider-conformance.js"

const connectionString = process.env.MONGODB_URI

function databaseNameForKey({ storageKey, parsed }) {
  const prefix = parsed.databaseName
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 24) || "coinzilla"
  const suffix = createHash("sha256")
    .update(String(storageKey))
    .digest("hex")
    .slice(0, 24)
  return `${prefix}_cz_${suffix}`
}

function parsePrimaryAddress(address) {
  if (address.startsWith("[")) {
    const end = address.indexOf("]")
    return {
      host: address.slice(1, end),
      port: Number(address.slice(end + 2)) || 27017,
    }
  }
  const separator = address.lastIndexOf(":")
  return separator < 0
    ? { host: address,
port: 27017 }
    : {
      host: address.slice(0, separator),
      port: Number(address.slice(separator + 1)) || 27017,
    }
}

async function dropDatabaseOnCurrentServer({ transport, databaseName, handshake }) {
  if (handshake.primary && handshake.topology === "replicaSet") {
    return {
      redirect: parsePrimaryAddress(handshake.primary),
    }
  }
  const response = await transport.command({
    body: {
      dropDatabase: 1,
      $db: databaseName,
    },
  })
  if (Number(response.ok) !== 1) {
    throw new Error(`MongoDB test database cleanup failed: ${response.errmsg ?? "unknown error"}`)
  }
  return { redirect: null }
}

async function dropDatabase({ databaseName, parsed }) {
  let {host} = parsed
  let {port} = parsed
  let transport
  try {
    for (let redirect = 0; redirect < 4; redirect += 1) {
      transport = createMongoTransport({
        host,
        port,
        tls: parsed.tls ? {} : null,
        connectTimeoutMS: parsed.connectTimeoutMS,
        socketTimeoutMS: parsed.socketTimeoutMS,
      })
      await transport.connect()
      const handshake = await performMongoHandshake({
        transport,
        databaseName,
        username: parsed.username,
        password: parsed.password,
        authSource: parsed.authSource,
        authMechanism: parsed.authMechanism,
        replicaSet: parsed.replicaSet,
      })
      const { redirect: nextPrimary } = await dropDatabaseOnCurrentServer({
        transport,
        databaseName,
        handshake,
      })
      if (!nextPrimary) {
        return
      }
      await transport.close()
      transport = null
      ;({ host, port } = nextPrimary)
    }
    throw new Error("MongoDB integration cleanup exceeded replica-set primary redirects")
  } finally {
    await transport?.close()
  }
}

if (connectionString) {
  const parsed = parseMongoConnectionString(connectionString)
  runDatabaseProviderConformanceTests({
    name: "MongoDB native provider",
    createDatabase: ({ storageKey }) => createDatabase({
      provider: createMongoProvider({
        uri: connectionString,
        databaseName: databaseNameForKey({ storageKey,
parsed }),
      }),
    }),
    cleanupStorage: ({ storageKey }) => dropDatabase({
      databaseName: databaseNameForKey({ storageKey,
parsed }),
      parsed,
    }),
  })

  test("MongoDB multi-document transactions roll back writes atomically", async (context) => {
    const databaseName = databaseNameForKey({ storageKey: randomUUID(),
parsed })
    const database = createDatabase({
      provider: createMongoProvider({
        uri: connectionString,
        databaseName,
      }),
    })
    await database.connect()
    try {
      const callbackError = new Error("intentional transaction rollback")
      try {
        await database.transaction(async (transaction) => {
          await transaction.create({
            collection: "transaction-rollback",
            record: {
              id: "rollback-record",
              value: "must not persist",
            },
          })
          throw callbackError
        })
      } catch (error) {
        if (error instanceof DatabaseTransactionUnsupportedError) {
          context.skip("Configured MongoDB topology does not support multi-document transactions")
          return
        }
        assert.equal(error, callbackError)
      }

      assert.equal(
        await database.readOne({
          collection: "transaction-rollback",
          id: "rollback-record",
        }),
        null,
      )
    } finally {
      await database.close()
      await dropDatabase({ databaseName,
parsed })
    }
  })

  test("MongoDB multi-document transactions commit multiple records atomically", async (context) => {
    const databaseName = databaseNameForKey({ storageKey: randomUUID(),
parsed })
    const database = createDatabase({
      provider: createMongoProvider({
        uri: connectionString,
        databaseName,
      }),
    })
    await database.connect()
    try {
      try {
        const result = await database.transaction(async (transaction) => {
          await transaction.create({
            collection: "transaction-commit",
            record: { id: "commit-one",
value: 1 },
          })
          await transaction.create({
            collection: "transaction-commit",
            record: { id: "commit-two",
value: 2 },
          })
          return "committed"
        })
        assert.equal(result, "committed")
        assert.deepEqual(
          await database.readMany({ collection: "transaction-commit" }),
          [
            { id: "commit-one",
value: 1 },
            { id: "commit-two",
value: 2 },
          ],
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionUnsupportedError) {
          context.skip("Configured MongoDB topology does not support multi-document transactions")
          return
        }
        throw error
      }
    } finally {
      await database.close()
      await dropDatabase({ databaseName,
parsed })
    }
  })

} else {
  test("MongoDB integration suite requires MONGODB_URI", {
    skip: "Set MONGODB_URI to run native MongoDB provider integration and conformance tests",
  }, () => {})
}
