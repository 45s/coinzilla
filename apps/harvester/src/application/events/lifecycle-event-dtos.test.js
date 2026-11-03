import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES, HARVESTER_EVENT_SOURCE } from "./event-names.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
  mapConfigValidatedData,
  mapHarvesterStartedData,
  mapHarvesterStartupFailedData,
  mapHarvesterStoppedData,
} from "./lifecycle-event-dtos.js"

const validLifecycle = {
  broker: "binance",
  strategyMode: "read-only",
  enabledMarkets: ["ZROUSDT", "BTCUSDT"],
  tradingEnabled: false,
}

test("exports stable names and source for the initial operational lifecycle contract", () => {
  assert.deepEqual(HARVESTER_EVENT_NAMES, {
    STARTED: "harvester.started",
    STARTUP_FAILED: "harvester.startup_failed",
    STOPPED: "harvester.stopped",
    CONFIG_VALIDATED: "config.validated",
    BROKER_CONNECTED: "broker.connected",
    BROKER_CONNECTION_FAILED: "broker.connection_failed",
    BROKER_DISCONNECTED: "broker.disconnected",
  })
  assert.equal(HARVESTER_EVENT_SOURCE, "harvester")
  assert.ok(Object.isFrozen(HARVESTER_EVENT_NAMES))
})

test("maps application-start facts to an allowlisted plain DTO", () => {
  const result = mapHarvesterStartedData({
    ...validLifecycle,
    apiKey: "must-not-be-copied",
    apiSecret: "must-not-be-copied",
    account: { balances: ["private"] },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    broker: "binance",
    strategyMode: "read-only",
    enabledMarkets: ["ZROUSDT", "BTCUSDT"],
    tradingEnabled: false,
  })
  assert.equal("apiKey" in result.data, false)
  assert.equal("account" in result.data, false)
})

test("maps validated configuration without copying full configuration or credentials", () => {
  const result = mapConfigValidatedData({
    enabledMarkets: ["ZROUSDT"],
    strategyMode: "conservative",
    tradingEnabled: true,
    config: { apiKey: "private", pairs: { ZROUSDT: { investment: 100 } } },
  })

  assert.deepEqual(result, {
    ok: true,
    data: {
      enabledMarkets: ["ZROUSDT"],
      strategyMode: "conservative",
      tradingEnabled: true,
    },
  })
})

test("maps broker connection success and sanitizes sensitive error values", () => {
  assert.deepEqual(mapBrokerConnectedData({ broker: "binance" }), {
    ok: true,
    data: { broker: "binance" },
  })

  const result = mapBrokerConnectionFailedData({
    broker: "binance",
    error: new Error('connect failed apiKey="key-value" api_secret=secret-value API key plain-value Bearer abc.def https://user:password@host.invalid/path'),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.broker, "binance")
  assert.equal(result.data.error.name, "Error")
  assert.match(result.data.error.message, /apiKey=\[REDACTED\]/)
  assert.match(result.data.error.message, /api_secret=\[REDACTED\]/)
  assert.match(result.data.error.message, /Bearer \[REDACTED\]/)
  assert.match(result.data.error.message, /API key \[REDACTED\]/)
  assert.match(result.data.error.message, /https:\/\/\[REDACTED\]@host\.invalid/)
  assert.equal("stack" in result.data.error, false)
  assert.equal("cause" in result.data.error, false)
  assert.ok(result.data.error.message.length <= 240)
})

test("maps broker disconnection outcome without retaining an Error instance", () => {
  const error = new Error("socket closed")
  const result = mapBrokerDisconnectedData({ broker: "binance", outcome: "failed", error })
  assert.deepEqual(result, {
    ok: true,
    data: {
      broker: "binance",
      outcome: "failed",
      error: { name: "Error", message: "socket closed" },
    },
  })
  assert.equal(result.data.error instanceof Error, false)
})

test("maps process startup failure with a bounded, sanitized error DTO", () => {
  const result = mapHarvesterStartupFailedData({
    stage: "bootstrap",
    error: new Error("startup failed password=secret-value"),
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      stage: "bootstrap",
      error: { name: "Error", message: "startup failed password=[REDACTED]" },
    },
  })
})

test("maps process shutdown reason and outcome", () => {
  assert.deepEqual(mapHarvesterStoppedData({ reason: "SIGTERM", outcome: "success" }), {
    ok: true,
    data: { reason: "SIGTERM", outcome: "success" },
  })
})

test("rejects missing identifiers, invalid modes, duplicate markets, and invalid values", () => {
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, broker: " " }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, strategyMode: "unknown" }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, enabledMarkets: ["BTCUSDT", "BTCUSDT"] }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, tradingEnabled: "false" }).ok, false)
  assert.equal(mapConfigValidatedData({ enabledMarkets: "ZROUSDT", strategyMode: "read-only", tradingEnabled: false }).ok, false)
  assert.equal(mapBrokerConnectedData({ broker: "" }).ok, false)
  assert.equal(mapHarvesterStoppedData({ reason: "SIGTERM", outcome: "unknown" }).ok, false)
  assert.equal(mapHarvesterStartupFailedData({ stage: "bootstrap", error: "failure" }).ok, false)
})

test("rejects non-object mapper inputs and non-Error failure details safely", () => {
  assert.equal(mapHarvesterStartedData(null).ok, false)
  assert.equal(mapBrokerConnectionFailedData({ broker: "binance", error: { message: "bad" } }).ok, false)
  assert.equal(mapBrokerDisconnectedData({ broker: "binance", outcome: "success", error: new Date() }).ok, false)
})

test("EventBus accepts mapped lifecycle DTOs and rejects unsupported payload objects", () => {
  const eventBus = new EventBus()
  const mapped = mapHarvesterStartedData(validLifecycle)
  assert.equal(mapped.ok, true)
  const accepted = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: mapped.data,
  })
  assert.equal(accepted.ok, true)
  assert.doesNotThrow(() => JSON.stringify(mapped.data))

  const rejected = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: { invalid: new Date() },
  })
  assert.equal(rejected.ok, false)
  assert.ok(rejected.errors[0] instanceof TypeError)

  class PrivateAccountSnapshot {
    constructor() { this.balance = "private" }
  }
  const classInstanceResult = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: { account: new PrivateAccountSnapshot() },
  })
  assert.equal(classInstanceResult.ok, false)
  assert.ok(classInstanceResult.errors[0] instanceof TypeError)
})
