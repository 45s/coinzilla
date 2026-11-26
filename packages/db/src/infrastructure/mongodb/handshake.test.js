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
      directConnection: false,
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


test("MongoDB URI parser supports IPv6 seeds and rejects unknown or unsafe options", () => {
  assert.equal(
    parseMongoConnectionString("mongodb://[::1]:27017/app?directConnection=true").host,
    "::1",
  )
  assert.equal(
    parseMongoConnectionString("mongodb://localhost/app?directConnection=true").directConnection,
    true,
  )
  assert.throws(
    () => parseMongoConnectionString("mongodb://localhost/app?serverSelectionTimeoutMS=5000"),
    /option serverSelectionTimeoutMS is not supported/i,
  )
  assert.throws(
    () => parseMongoConnectionString("mongodb://localhost/app?retryWrites=true"),
    /retryable writes are not supported/i,
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


test("MongoDB handshake rejects servers outside the documented wire-version range", async () => {
  for (const hello of [
    { minWireVersion: 0, maxWireVersion: 12, isWritablePrimary: true },
    { minWireVersion: 26, maxWireVersion: 30, isWritablePrimary: true },
  ]) {
    await assert.rejects(
      performMongoHandshake({
        transport: {
          async command() {
            return { ok: 1, ...hello }
          },
        },
      }),
      /wire protocol version range/i,
    )
  }
})


test("MongoDB handshake accepts compatible wire-version overlap even when the server maximum is newer", async () => {
  const result = await performMongoHandshake({
    transport: {
      async command() {
        return {
          ok: 1,
          minWireVersion: 25,
          maxWireVersion: 26,
          isWritablePrimary: true,
        }
      },
    },
  })

  assert.equal(result.maxWireVersion, 26)
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


test("MongoDB URI parser rejects unsupported options instead of silently ignoring them", () => {
  assert.throws(
    () => parseMongoConnectionString("mongodb://localhost/app?readPreference=secondary"),
    /primary read preference only/i,
  )
  assert.throws(
    () => parseMongoConnectionString("mongodb://localhost/app?tls=true&tls=false"),
    /must not be repeated/i,
  )
})

test("MongoDB URI parser normalizes IPv6 hosts and rejects credentials without a username", () => {
  assert.equal(
    parseMongoConnectionString("mongodb://[::1]:27018/app").host,
    "::1",
  )
  assert.throws(
    () => parseMongoConnectionString("mongodb://:password@localhost/app"),
    /username/i,
  )
})


test("MongoDB URI parser rejects a password without a username", () => {
  assert.throws(
    () => parseMongoConnectionString("mongodb://:password@localhost/app"),
    /password requires a username/i,
  )
})


test("MongoDB handshake rejects server wire versions newer than the implemented protocol ceiling", async () => {
  await assert.rejects(
    performMongoHandshake({
      transport: {
        async command() {
          return {
            ok: 1,
            minWireVersion: 26,
            maxWireVersion: 27,
            isWritablePrimary: true,
          }
        },
      },
      databaseName: "app",
    }),
    /wire protocol version range 25-26 is not supported/i,
  )
})
