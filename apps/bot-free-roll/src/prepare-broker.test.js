import test from "node:test"
import assert from "node:assert/strict"

import { prepareBroker } from "./prepare-broker.js"

test("returns the connected broker", async () => {
  const broker = {
    async connect() {},
    async disconnect() {
      assert.fail("disconnect should not be called after successful setup")
    },
  }

  const result = await prepareBroker({ createBroker: () => broker })

  assert.equal(result.ok, true)
  assert.equal(result.data, broker)
})

test("disconnects the broker when connecting fails", async () => {
  const setupError = new Error("connection failed")
  let disconnected = false
  const broker = {
    async connect() {
      throw setupError
    },
    async disconnect() {
      disconnected = true
    },
  }

  const result = await prepareBroker({ createBroker: () => broker })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], setupError)
  assert.equal(disconnected, true)
})

test("preserves the connection error when cleanup also fails", async () => {
  const setupError = new Error("connection failed")
  const cleanupError = new Error("disconnect failed")
  const broker = {
    async connect() {
      throw setupError
    },
    async disconnect() {
      throw cleanupError
    },
  }

  const result = await prepareBroker({ createBroker: () => broker })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], setupError)
})

test("returns a failed result when broker creation throws", async () => {
  const setupError = new Error("configuration failed")

  const result = await prepareBroker({
    createBroker() {
      throw setupError
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], setupError)
})

test("preserves the setup error when error logging throws", async () => {
  const setupError = new Error("configuration failed")
  const logger = {
    error() {
      throw new Error("logging failed")
    },
  }

  const result = await prepareBroker({
    createBroker() {
      throw setupError
    },
    logger,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], setupError)
})

test("preserves the setup error when cleanup and cleanup logging throw", async () => {
  const setupError = new Error("connection failed")
  const cleanupError = new Error("disconnect failed")
  let disconnectCalls = 0
  let logCalls = 0
  const logger = {
    error() {
      logCalls += 1
      throw new Error("logging failed")
    },
  }
  const broker = {
    async connect() {
      throw setupError
    },
    async disconnect() {
      disconnectCalls += 1
      throw cleanupError
    },
  }

  const result = await prepareBroker({
    createBroker: () => broker,
    logger,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], setupError)
  assert.equal(disconnectCalls, 1)
  assert.equal(logCalls, 2)
})
