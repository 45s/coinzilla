import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotWebSocketClient, BitunixWebSocketError } from "../../../index.js"

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
  assert.throws(
    () => client.getKline({
      symbol: "BTCUSDT",
      interval: "invalid",
    }),
    /interval/i,
    "unsupported kline intervals must be rejected",
  )
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
  assert.equal(typeof client.getOpenOrders, "function", "the documented current-orders RPC must be exposed")
  assert.equal(typeof client.getOrderHistory, "function", "the documented order-history RPC must be exposed")
  assert.equal(typeof client.getMatchingOrderDetails, "function", "the documented matching-order RPC must be exposed")
  assert.equal(typeof client.placeOrder, "undefined", "order placement must remain outside this read-only RPC client")
  assert.equal(typeof client.cancelOrder, "undefined", "order cancellation must remain outside this read-only RPC client")
  assert.equal(typeof client.subscribeForPrices, "undefined", "the Spot RPC protocol must not be mistaken for a continuous subscription API")
})

test("Bitunix Spot WebSocket client dispatches every documented read-only RPC method", async () => {
  let nextId = 0
  const { client, transport } = createClient({
    idFactory: () => `rpc-${++nextId}`,
  })
  await client.connect()

  const pending = [
    client.getLastPrice({ symbol: "BTCUSDT" }),
    client.getDepth({
      symbol: "BTCUSDT",
      precision: 5,
    }),
    client.getKline({
      symbol: "BTCUSDT",
      interval: "1",
    }),
    client.getTradingPairs(),
    client.getExchangeRates(),
    client.getTokenNetworks(),
    client.getAccount(),
    client.getUserInfo(),
    client.getOpenOrders({ symbol: "BTCUSDT" }),
    client.getOrderHistory({
      symbol: "BTCUSDT",
      page: 2,
      pageSize: 25,
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-02T00:00:00Z",
      status: "3",
      side: "2",
      type: "1",
    }),
    client.getMatchingOrderDetails({
      orderId: "123456",
      symbol: "BTCUSDT",
    }),
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
      "order.pending.list",
      "order.history.page",
      "order.deal.list",
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
    Array.from({ length: pending.length }, (...args) => {
      const [, index] = args
      return { index }
    }),
    "all documented read RPCs must return their matching response data",
  )
  await client.disconnect()
})

test("Bitunix Spot WebSocket client validates order-history and matching-order RPC parameters", async () => {
  const { client, transport } = createClient()
  await client.connect()

  assert.throws(
    () => client.getOpenOrders(),
    /symbol/i,
    "current-order lookup requires a symbol",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      page: 0,
    }),
    /page/i,
    "order-history page must be positive",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      pageSize: 1.5,
    }),
    /pageSize/i,
    "order-history pageSize must be a positive integer",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      status: "99",
    }),
    /status/i,
    "unknown order-history status codes must be rejected",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      side: "3",
    }),
    /side/i,
    "unknown order-history side codes must be rejected",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      type: "3",
    }),
    /type/i,
    "unknown order-history type codes must be rejected",
  )
  assert.throws(
    () => client.getOrderHistory({
      symbol: "BTCUSDT",
      startTime: "not-a-date",
    }),
    /startTime/i,
    "order-history timestamps must be valid ISO-8601 values",
  )
  assert.throws(
    () => client.getMatchingOrderDetails({
      symbol: "BTCUSDT",
    }),
    /orderId/i,
    "matching-order lookup requires an exchange order ID",
  )
  assert.equal(transport.sent.length, 0, "invalid order RPC parameters must not reach the socket")
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
  transport.receiveText("{not-json")
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


test("Bitunix Spot WebSocket client sends the documented authenticated ping RPC", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.ping()
  assert.equal(transport.sent[0].method, "ping", "the connection test must use Bitunix's documented ping RPC method")
  assert.equal(transport.sent[0].params.apiKey, "key", "the ping RPC must include the configured API key")
  assert.equal(typeof transport.sent[0].params.sign, "string", "the ping RPC must be signed like every other Spot WebSocket request")
  transport.receive({
    id: "request-1",
    code: "0",
    msg: "success",
    data: "pong",
  })

  assert.equal(await pending, "pong", "the matching ping response must resolve the connection test")
  await client.disconnect()
})


test("Bitunix Spot WebSocket client wraps handshake failures and preserves their cause", async () => {
  const { client, transport } = createClient()
  const handshakeError = new Error("handshake rejected by upstream")
  transport.connect = async () => {
    throw handshakeError
  }

  await assert.rejects(client.connect(), (error) => {
    assert.ok(
      error instanceof BitunixWebSocketError,
      "connect() must expose the broker-owned WebSocket error type instead of leaking a raw transport error",
    )
    assert.equal(
      error.code,
      "BITUNIX_WEBSOCKET_CONNECTION_FAILED",
      "handshake failures must expose the stable broker-owned connection error code",
    )
    assert.equal(
      error.kind,
      "connection",
      "handshake failures must retain the connection error classification",
    )
    assert.equal(
      error.cause,
      handshakeError,
      "the original transport handshake error must remain available as the native cause",
    )
    return true
  })

  assert.equal(
    client.state,
    "closed",
    "a failed initial handshake must leave the WebSocket client in its terminal closed state",
  )
  assert.equal(
    transport.listeners.message.size,
    0,
    "failed connection setup must remove the message listener during cleanup",
  )
  assert.equal(
    transport.listeners.close.size,
    0,
    "failed connection setup must remove the close listener during cleanup",
  )
  assert.equal(
    transport.listeners.error.size,
    0,
    "failed connection setup must remove the error listener during cleanup",
  )
})


test("Bitunix Spot WebSocket client reconnects the same instance with a fresh transport", async () => {
  const transports = []
  const client = new BitunixSpotWebSocketClient({
    apiKey: "key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => `nonce-${transports.length}`,
    idFactory: () => `request-${transports.length}`,
    transportFactory: () => {
      const transport = new FakeTransport()
      transports.push(transport)
      return transport
    },
  })

  await client.connect()
  assert.equal(transports.length, 1, "the initial connection must create exactly one transport")

  const interruptedRequest = client.getAccount()
  assert.equal(transports[0].sent.length, 1, "the first account RPC must be sent exactly once")
  await transports[0].close()
  await assert.rejects(
    interruptedRequest,
    /connection.*closed/i,
    "a remote close must reject the in-flight RPC rather than leave it pending",
  )
  assert.equal(client.state, "closed", "a remote close must expose the closed state before reconnection")

  const firstReconnect = client.connect()
  const concurrentReconnect = client.connect()
  await Promise.all([firstReconnect, concurrentReconnect])
  assert.equal(transports.length, 2, "concurrent reconnect calls must share one newly created transport")
  assert.equal(transports[1].sent.length, 0, "an interrupted RPC must never be replayed on the replacement connection")

  const nextRequest = client.getAccount()
  assert.equal(transports[1].sent.length, 1, "a new RPC must use the replacement transport exactly once")
  transports[1].receive({
    id: "request-2",
    code: "0",
    msg: "success",
    data: [{
      coin: "BTC",
      balance: "1.25",
    }],
  })
  assert.deepEqual(
    await nextRequest,
    [{
      coin: "BTC",
      balance: "1.25",
    }],
    "the reconnected client must resolve a fresh request using the new transport",
  )

  await client.disconnect()
})


test("Bitunix Spot WebSocket client can reconnect after a synchronous transport connect failure", async () => {
  const transports = []
  const client = new BitunixSpotWebSocketClient({
    apiKey: "key",
    apiSecret: "secret",
    transportFactory: () => {
      const transport = new FakeTransport()
      if (transports.length === 0) {
        transport.connect = () => {
          throw new Error("synchronous transport connect failure")
        }
      }
      transports.push(transport)
      return transport
    },
  })

  await assert.rejects(client.connect(), (error) => {
    assert.ok(error instanceof BitunixWebSocketError, "synchronous transport failures must use the broker-owned error type")
    assert.equal(error.cause?.message, "synchronous transport connect failure", "the synchronous transport failure must remain the native cause")
    return true
  })
  assert.equal(client.state, "closed", "a synchronous connect failure must leave the client closed")

  await client.connect()
  assert.equal(transports.length, 2, "a subsequent connect must create a fresh transport after the failed attempt")
  assert.equal(client.state, "open", "the client must recover after a synchronous transport connect failure")
  await client.disconnect()
})