import assert from "node:assert/strict"
import test from "node:test"
import { createClient, flush, acknowledge } from "../test-helpers/streams-client-fixtures.js"

test("reconnects the public Streams connection after server heartbeat frames stop", async () => {
  const { client, clock, transports, errors } = createClient({
    heartbeatTimeout: 60,
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  clock.advanceBy(59)
  assert.equal(
    transports[0].closeCalls.length,
    0,
    "the public Streams socket must remain open before its configured heartbeat deadline",
  )

  clock.advanceBy(1)
  await flush()
  assert.equal(
    transports[0].closeCalls[0]?.code,
    4000,
    "a missing Binance server heartbeat must close the stale transport to enter the existing reconnect lifecycle",
  )
  assert.match(
    errors[0],
    /heartbeat timed out/i,
    "heartbeat expiry must be reported with an actionable diagnostic",
  )

  clock.advanceBy(10)
  await flush()
  assert.equal(
    transports.length,
    2,
    "the desired public market streams must reconnect after a heartbeat timeout",
  )
  acknowledge(transports[1], 0, { result: ["btcusdt@aggTrade"] })
  await flush()
  assert.equal(
    client.state,
    "open",
    "the replacement Streams connection must become ready after subscription confirmation",
  )
  await client.disconnect()
})

test("resets the heartbeat deadline whenever Binance sends a ping frame", async () => {
  const { client, clock, transports } = createClient({
    heartbeatTimeout: 60,
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  clock.advanceBy(40)
  transports[0].ping(Buffer.from("binance-ping"))
  clock.advanceBy(59)
  assert.equal(
    transports[0].closeCalls.length,
    0,
    "a received Binance ping frame must restart the heartbeat timeout window",
  )

  clock.advanceBy(1)
  assert.equal(
    transports[0].closeCalls[0]?.code,
    4000,
    "the connection must be considered stale only after a full timeout without a subsequent ping",
  )
  await client.disconnect()
})

test("reports per-stream subscription, receipt-age, and connection-heartbeat diagnostics", async () => {
  const { client, clock, transports } = createClient({
    heartbeatTimeout: 60,
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  const initialDiagnostics = client.diagnostics
  assert.equal(
    initialDiagnostics.connectionState,
    "open",
    "stream diagnostics must expose the current transport connection state",
  )
  assert.equal(
    initialDiagnostics.connectionGeneration,
    1,
    "the first connected Streams transport must have generation one",
  )
  assert.equal(
    initialDiagnostics.streams[0].confirmed,
    true,
    "a stream must be reported confirmed only after Binance acknowledges its subscription",
  )
  assert.equal(
    initialDiagnostics.streams[0].lastMessageAt,
    null,
    "a confirmed stream without market messages must retain an explicit missing receipt timestamp",
  )

  clock.advanceBy(25)
  transports[0].receive({
    e: "aggTrade",
    s: "BTCUSDT",
    p: "65000.00",
  })
  const receivedDiagnostics = client.diagnostics
  assert.equal(
    receivedDiagnostics.streams[0].lastMessageAt,
    25,
    "each matching market message must update that stream's local receipt timestamp",
  )
  assert.equal(
    receivedDiagnostics.streams[0].messageAgeMs,
    0,
    "stream receipt age must be calculated from the injected monotonic clock",
  )
  assert.equal(
    receivedDiagnostics.heartbeatAgeMs,
    25,
    "connection heartbeat age must remain independent from per-stream market message age",
  )
  await client.disconnect()
})
