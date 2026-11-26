import assert from "node:assert/strict"
import test from "node:test"

import {
  parseMongoConnectionString,
  performMongoHandshake,
} from "./handshake.js"

test("MongoDB URI parser reads credentials, database, authentication source, and timeouts", () => {
  assert.deepEqual(
    parseMongoConnectionString("mongodb://alice:p%40ss@db.example:27018/app?authSource=admin&tls=true&connectTimeoutMS=4000"),
    {
      host: "db.example",
      port: 27018,
      username: "alice",
      password: "p@ss",
      databaseName: "app",
      authSource: "admin",
      authMechanism: undefined,
      tls: true,
      replicaSet: undefined,
      connectTimeoutMS: 4000,
      socketTimeoutMS: 30000,
    },
  )
})

test("MongoDB URI parser rejects unsupported SRV and multi-host discovery instead of silently degrading", () => {
  assert.throws(
    () => parseMongoConnectionString("mongodb+srv://cluster.example/app"),
    /mongodb\+srv/i,
  )
  assert.throws(
    () => parseMongoConnectionString("mongodb://one:27017,two:27017/app"),
    /single seed host/i,
  )
})

test("MongoDB handshake detects standalone, replica-set, and sharded topologies", async () => {
  for (const [hello, topology] of [
    [{ isWritablePrimary: true, minWireVersion: 13, maxWireVersion: 17 }, "standalone"],
    [{ isWritablePrimary: true, setName: "rs0", minWireVersion: 13, maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }, "replicaSet"],
    [{ isWritablePrimary: true, msg: "isdbgrid", minWireVersion: 13, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 }, "sharded"],
  ]) {
    const commands = []
    const result = await performMongoHandshake({
      transport: {
        async command(input) {
          commands.push(input.body)
          return { ok: 1, ...hello }
        },
      },
      databaseName: "app",
    })

    assert.equal(result.topology, topology)
    assert.equal(commands[0].hello, 1)
    assert.equal(commands[0].$db, "admin")
  }
})

test("MongoDB handshake rejects unsupported wire versions and a missing writable primary", async () => {
  await assert.rejects(
    performMongoHandshake({
      transport: {
        async command() {
          return { ok: 1, minWireVersion: 30, maxWireVersion: 31, isWritablePrimary: true }
        },
      },
    }),
    /wire protocol version/i,
  )

  await assert.rejects(
    performMongoHandshake({
      transport: {
        async command() {
          return {
            ok: 1,
            minWireVersion: 13,
            maxWireVersion: 17,
            setName: "rs0",
            isWritablePrimary: false,
          }
        },
      },
    }),
    /primary/i,
  )
})
