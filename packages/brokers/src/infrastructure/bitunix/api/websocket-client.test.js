import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotWebSocketClient } from "../../../index.js"

class FakeTransport {
  listeners = {
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }
  sent = []
  connected = false
  closed = false

  async connect() {
    this.connected = true
  }

  send(message) {
    this.sent.push(JSON.parse(message))
  }

  onMessage(listener) {
    this.listeners.message.add(listener)
    return () => this.listeners.message.delete(listener)
  }

  onClose(listener) {
    this.listeners.close.add(listener)
    return () => this.listeners.close.delete(listener)
  }

  onError(listener) {
    this.listeners.error.add(listener)
    return () => this.listeners.error.delete(listener)
  }

  async close() {
    this.closed = true
    for (const listener of this.listeners.close) {
      listener({
        code: 1000,
        reason: "closed",
        wasClean: true,
      })
    }
  }

  receive(payload) {
    this.receiveText(JSON.stringify(payload))
  }

  receiveText(message) {
    for (const listener of this.listeners.message) {
      listener(message)
    }
  }
}

function createClient(options = {}) {
  const transport = new FakeTransport()
  const client = new BitunixSpotWebSocketClient({
    apiKey: "key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    idFactory: () => "request-1",
    transportFactory: () => transport,
    ...options,
  })
  return { client,
    transport }
}

test("Bitunix Spot WebSocket client sends authenticated public RPC using the official signature", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getLastPrice({ symbol: "BTCUSDT" })
  assert.equal(transport.sent.length, 1, "one RPC request must be sent for one price lookup")
  assert.deepEqual(transport.sent[0], {
    id: "request-1",
    method: "market.last_price",
    params: {
      symbol: "BTCUSDT",
      apiKey: "key",
      timestamp: "1700000000000",
      nonce: "nonce",
      sign: "218d2303780bed9592cd575e0b599b3402208d6fe82193da63ddd6df14b22f02",
    },
  }, "the request must contain the official Bitunix Spot WebSocket authentication fields and signature")

  transport.receive({
    id: "request-1",
    code: "0",
    msg: "success",
    data: "100.25",
  })
  assert.equal(await pending, "100.25", "the matching response data must resolve the price RPC")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client correlates concurrent responses by request ID", async () => {
  let nextId = 0
  const { client, transport } = createClient({ idFactory: () => `request-${++nextId}` })
  await client.connect()

  const first = client.getLastPrice({ symbol: "BTCUSDT" })
  const second = client.getLastPrice({ symbol: "ETHUSDT" })
  transport.receive({
    id: "request-2",
    code: 0,
    msg: "success",
    data: "200",
  })
  transport.receive({
    id: "request-1",
    code: 0,
    msg: "success",
    data: "100",
  })

  assert.deepEqual(await Promise.all([first, second]), ["100", "200"], "out-of-order responses must resolve only their matching requests")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects exchange errors without losing response identity", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getAccount()
  transport.receive({
    id: "request-1",
    code: "1001",
    msg: "permission denied",
    data: null,
  })

  await assert.rejects(pending, (error) => {
    assert.equal(error.exchangeCode, "1001", "exchange error code must remain available to callers")
    assert.equal(error.requestId, "request-1", "exchange error must retain its request identity")
    assert.match(error.message, /permission denied/i, "exchange error message must be preserved")
    return true
  })
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects malformed and mismatched responses safely", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getUserInfo()
  transport.receive({
    id: "another-request",
    code: "0",
    data: { uid: 1 },
  })
  assert.equal(client.pendingCount, 1, "an unrelated response must not resolve or remove another in-flight request")
  transport.receive({
    id: "request-1",
    code: "0",
    msg: "success",
    data: { uid: 7 },
  })
  assert.deepEqual(await pending, { uid: 7 }, "the matching user.info response must resolve its own request")

  const malformed = client.getAccount()
  transport.receive({
    id: "request-1",
    msg: "missing code",
  })
  await assert.rejects(malformed, /response.*code/i, "a matching response without a code must fail closed")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects pending reads when the connection closes", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getAccount()
  await transport.close()

  await assert.rejects(pending, /connection.*closed/i, "a closed socket must reject every unresolved RPC")
  assert.equal(client.pendingCount, 0, "connection closure must clear pending RPC state")
  assert.equal(client.state, "closed", "connection closure must make the client terminal")
})

test("Bitunix Spot WebSocket client validates documented RPC arguments before sending", async () => {
  const { client, transport } = createClient()
  await client.connect()

  assert.throws(() => client.getLastPrice({ symbol: "" }), /symbol/i, "empty symbols must be rejected before network I/O")
  assert.throws(() => client.getDepth({ symbol: "BTCUSDT" }), /precision/i, "depth precision is required by the official contract")
  assert.throws(() => client.getKline({ symbol: "BTCUSDT", interval: "invalid" }), /interval/i, "unsupported kline intervals must be rejected")
  assert.equal(transport.sent.length, 0, "invalid RPC arguments must not be sent")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client times out reads without retrying or retaining pending state", async () => {
  const { client, transport } = createClient({
    requestTimeout: 1,
  })
  await client.connect()

  await assert.rejects(client.getAccount(), /timed out/i, "an unanswered read must reject at its configured timeout")
  assert.equal(transport.sent.length, 1, "a timed-out read must never be replayed automatically")
  assert.equal(client.pendingCount, 0, "timed-out reads must be removed from pending request state")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client exposes only documented read-only operations", () => {
  const { client } = createClient()

  assert.equal(typeof client.getTradingPairs, "function", "the documented trading-pair RPC must be exposed")
  assert.equal(typeof client.getExchangeRates, "function", "the documented exchange-rate RPC must be exposed")
  assert.equal(typeof client.getTokenNetworks, "function", "the documented token-network RPC must be exposed")
  assert.equal(typeof client.placeOrder, "undefined", "order placement must remain outside this read-only RPC client")
  assert.equal(typeof client.cancelOrder, "undefined", "order cancellation must remain outside this read-only RPC client")
})

test("Bitunix Spot WebSocket client dispatches every documented read-only RPC method", async () => {
  let nextId = 0
  const { client, transport } = createClient({
    idFactory: () => `rpc-${++nextId}`,
  })
  await client.connect()

  const pending = [
    client.getLastPrice({ symbol: "BTCUSDT" }),
    client.getDepth({ symbol: "BTCUSDT", precision: 5 }),
    client.getKline({ symbol: "BTCUSDT", interval: "1" }),
    client.getTradingPairs(),
    client.getExchangeRates(),
    client.getTokenNetworks(),
    client.getAccount(),
    client.getUserInfo(),
  ]
  assert.deepEqual(
    transport.sent.map((request) => request.method),
    [
      "market.last_price",
      "market.depth",
      "market.kline",
      "common.coin_pair.list",
      "common.rate.list",
      "common.coin.coin_network.list",
      "user.account",
      "user.info",
    ],
    "every documented Spot read must use its official RPC method name",
  )

  for (let index = 0; index < pending.length; index += 1) {
    transport.receive({
      id: `rpc-${index + 1}`,
      code: "0",
      msg: "success",
      data: { index },
    })
  }
  assert.deepEqual(
    await Promise.all(pending),
    Array.from({ length: pending.length }, (_, index) => ({ index })),
    "all documented read RPCs must return their matching response data",
  )
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects invalid request identity and authentication metadata", async () => {
  const invalidId = createClient({
    idFactory: () => "",
  })
  await invalidId.client.connect()
  await assert.rejects(
    invalidId.client.getAccount(),
    /request ID/i,
    "an empty request ID must be rejected before sending",
  )
  assert.equal(invalidId.transport.sent.length, 0, "invalid request identity must not reach the socket")
  await invalidId.client.disconnect()

  const invalidNonce = createClient({
    nonceFactory: () => "",
  })
  await invalidNonce.client.connect()
  await assert.rejects(
    invalidNonce.client.getAccount(),
    /nonce/i,
    "an empty authentication nonce must be rejected before sending",
  )
  await invalidNonce.client.disconnect()

  const invalidTime = createClient({
    now: () => Number.MAX_SAFE_INTEGER + 1,
  })
  await invalidTime.client.connect()
  await assert.rejects(
    invalidTime.client.getAccount(),
    /timestamp/i,
    "an unsafe authentication timestamp must be rejected before sending",
  )
  await invalidTime.client.disconnect()
})

test("Bitunix Spot WebSocket client rejects duplicate in-flight IDs and recovers after the first response", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const first = client.getAccount()
  await assert.rejects(
    client.getUserInfo(),
    /unique/i,
    "duplicate request IDs must not overwrite an unresolved RPC",
  )
  assert.equal(client.pendingCount, 1, "the original request must remain pending after a duplicate ID is refused")
  transport.receive({
    id: "request-1",
    code: "0",
    msg: "success",
    data: [],
  })
  assert.deepEqual(await first, [], "the original request must still resolve from its matching response")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client fails all pending RPCs on an unparseable message", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getAccount()
  transport.receive("{not-json")
  await assert.rejects(
    pending,
    /response JSON is invalid/i,
    "an unparseable WebSocket frame must fail pending RPCs instead of leaving them hung",
  )
  assert.equal(client.pendingCount, 0, "protocol failure must clear pending RPC state")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects requests before connect and after transport errors", async () => {
  const { client, transport } = createClient()
  await assert.rejects(
    client.getAccount(),
    /client is idle/i,
    "RPC calls must not be sent before the WebSocket is connected",
  )
  await client.connect()

  const pending = client.getAccount()
  for (const listener of transport.listeners.error) {
    listener(new Error("transport failure"))
  }
  await assert.rejects(
    pending,
    /transport reported an error/i,
    "a transport error must reject unresolved RPCs",
  )
  assert.equal(client.state, "closed", "a transport error must make the failed client terminal")
  assert.equal(client.pendingCount, 0, "transport failure must clear pending RPC state")
})

test("Bitunix Spot WebSocket client restricts credential-bearing connections to the official endpoint", () => {
  assert.throws(
    () => new BitunixSpotWebSocketClient({
      apiKey: "key",
      apiSecret: "secret",
      url: "wss://attacker.example/ws-api/v1",
      transportFactory: () => new FakeTransport(),
    }),
    /official Bitunix Spot endpoint/i,
    "credentials must never be signed and sent to an arbitrary WebSocket host",
  )
  const { client } = createClient()
  assert.equal(client.apiSecret, undefined, "the API secret must not be exposed as a public instance property")
  assert.equal(client.transport, undefined, "the raw transport must not be exposed as a public instance property")
})

test("Bitunix Spot WebSocket client preserves exact account decimals and unsafe int64 user IDs", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const balances = client.getAccount()
  transport.receiveText('{"id":"request-1","code":"0","msg":"success","data":[{"coin":"BTC","balance":0.123456789012345678,"balanceLocked":0.000000000000000001}]}')
  assert.deepEqual(
    await balances,
    [{
      coin: "BTC",
      balance: "0.123456789012345678",
      balanceLocked: "0.000000000000000001",
    }],
    "account decimal number tokens must not be rounded by JSON.parse",
  )

  const userInfo = client.getUserInfo()
  transport.receiveText('{"id":"request-1","code":"0","msg":"success","data":{"uid":9007199254740993}}')
  assert.deepEqual(
    await userInfo,
    { uid: "9007199254740993" },
    "unsafe int64 user IDs must be preserved as exact decimal strings",
  )

  const safeUserInfo = client.getUserInfo()
  transport.receiveText('{"id":"request-1","code":"0","msg":"success","data":{"uid":681979174}}')
  assert.deepEqual(
    await safeUserInfo,
    { uid: 681979174 },
    "safe int64 user IDs must retain their numeric response type",
  )

  const defaultKline = client.getKline({ symbol: "BTCUSDT" })
  assert.equal(transport.sent.at(-1).params.interval, "1min", "the documented K-line default interval must be used")
  transport.receive({
    id: "request-1",
    code: "0",
    msg: "success",
    data: { symbol: "BTCUSDT" },
  })
  assert.deepEqual(await defaultKline, { symbol: "BTCUSDT" }, "the default K-line RPC must resolve its response data")
  await client.disconnect()
})
