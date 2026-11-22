import assert from "node:assert/strict"
import { createConnection } from "node:net"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

const TRADING_HISTORY_UPDATED = "trading-history.updated"

function createQueries() {
  const emptyPage = {
    items: [],
    pagination: {
      limit: 50,
      offset: 0,
      total: 0,
      hasMore: false,
    },
  }
  return {
    getSummary: () => ({
      ok: true,
      data: {
        orders: 0,
        fills: 0,
        commissions: 0,
      },
    }),
    listOrders: () => ({
      ok: true,
      data: emptyPage,
    }),
    getOrder: () => ({
      ok: true,
      data: null,
    }),
    listFills: () => ({
      ok: true,
      data: emptyPage,
    }),
    getFill: () => ({
      ok: true,
      data: null,
    }),
    listCommissions: () => ({
      ok: true,
      data: emptyPage,
    }),
  }
}

function waitForSocketOpen(socket) {
  return new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    socket.addEventListener("open", resolve, {
      once: true,
    })
    socket.addEventListener("error", reject, {
      once: true,
    })
  })
}

function waitForMessage(socket) {
  return new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    function onMessage(event) {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("error", onError)
      resolve(JSON.parse(event.data))
    }
    function onError() {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("error", onError)
      reject(new Error("WebSocket connection failed before receiving a message"))
    }
    socket.addEventListener("message", onMessage)
    socket.addEventListener("error", onError)
  })
}

async function startApi({ t, eventBus, subscribeExchangeAccountUpdates } = {}) {
  const api = await startTradingHistoryApiServer({
    queries: createQueries(),
    environment: "testnet",
    host: "127.0.0.1",
    port: 0,
    eventBus,
    subscribeExchangeAccountUpdates,
    logger: {
      error() {},
    },
  })
  t.after(async () => {
    await api.close()
    await eventBus.close()
  })
  return api
}

test("accepts local WebSocket clients and broadcasts persisted-change notifications", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  const publication = eventBus.publish({
    name: TRADING_HISTORY_UPDATED,
    source: "harvester.trading-history-persistence",
    data: {
      resources: ["orders"],
    },
  })
  assert.equal(publication.ok, true, "The persisted-history invalidation event must be accepted by EventBus.")

  assert.deepEqual(await waitForMessage(socket), {
    type: "trading-history.updated",
    resources: ["orders"],
  }, "Connected local clients must receive resource-only invalidation hints after persistence.")
})

test("ignores malformed resource notifications without breaking the EventBus subscriber", async (t) => {
  const errors = []
  const eventBus = new EventBus({
    onError: ({ error }) => errors.push(error),
  })
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  eventBus.publish({
    name: TRADING_HISTORY_UPDATED,
    source: "test",
    data: {
      resources: null,
    },
  })
  await eventBus.flush()
  assert.deepEqual(errors, [], "Malformed internal notifications must be ignored without a subscriber failure.")

  eventBus.publish({
    name: TRADING_HISTORY_UPDATED,
    source: "test",
    data: {
      resources: ["orders"],
    },
  })
  assert.deepEqual(await waitForMessage(socket), {
    type: "trading-history.updated",
    resources: ["orders"],
  })
})

test("rejects browser WebSocket upgrades from untrusted origins", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = createConnection({
    host: "127.0.0.1",
    port: api.address.port,
  })
  t.after(() => socket.destroy())
  const response = new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    socket.once("data", (chunk) => resolve(chunk.toString("utf8")))
    socket.once("error", reject)
  })
  await new Promise((resolve) => socket.once("connect", resolve))
  socket.write([
    "GET /api/v1/trading/events HTTP/1.1",
    `Host: 127.0.0.1:${api.address.port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    "Origin: https://attacker.example",
    "",
    "",
  ].join("\r\n"))
  assert.match(await response, /^HTTP\/1\.1 403 Forbidden/)
})

test("closes local WebSocket clients before the shared HTTP listener shuts down", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  const closed = new Promise((resolve) => {
    socket.addEventListener("close", resolve, {
      once: true,
    })
  })
  await api.close()
  await closed

  assert.equal(socket.readyState, WebSocket.CLOSED, "API shutdown must close local WebSocket clients.")
  assert.equal(eventBus.getDiagnostics().closed, false, "The API must not own or close Harvester's EventBus.")
})

test("broadcasts exchange-account invalidations from Harvester snapshot events", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({ t, eventBus })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  const publication = eventBus.publish({
    name: "account.snapshot_captured",
    source: "harvester.account-snapshot",
    data: { phase: "LIVE" },
  })
  assert.equal(publication.ok, true)
  assert.deepEqual(await waitForMessage(socket), {
    type: "exchange-account.updated",
  })
})


test("broadcasts live updates from Harvester's existing user-data subscription", async (t) => {
  const eventBus = new EventBus()
  let notify
  let unsubscribed = false
  const api = await startApi({
    t,
    eventBus,
    subscribeExchangeAccountUpdates: (listener) => {
      notify = listener
      return () => { unsubscribed = true }
    },
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  notify()
  assert.deepEqual(await waitForMessage(socket), {
    type: "exchange-account.updated",
  })
  await api.close()
  assert.equal(unsubscribed, true, "Closing the API must detach the monitor listener without managing the exchange stream.")
})

