import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"
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

async function startApi({ t, eventBus } = {}) {
  const api = await startTradingHistoryApiServer({
    queries: createQueries(),
    token: API_TOKEN,
    environment: "testnet",
    host: "127.0.0.1",
    port: 0,
    eventBus,
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

test("authenticates WebSocket clients with a first message and broadcasts only persisted-change notifications", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  socket.send(JSON.stringify({
    type: "authenticate",
    token: API_TOKEN,
  }))

  assert.deepEqual(await waitForMessage(socket), {
    type: "authenticated",
  }, "A valid token must authenticate the WebSocket without putting the secret in the URL.")

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
  }, "Authenticated clients must receive resource-only invalidation hints after persistence.")
})

test("rejects invalid WebSocket credentials and does not send authenticated events", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  socket.send(JSON.stringify({
    type: "authenticate",
    token: "incorrect-token",
  }))

  assert.deepEqual(await waitForMessage(socket), {
    type: "error",
    code: "HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED",
  }, "Invalid credentials must receive a stable authentication failure.")
})

test("closes authenticated sockets before the shared HTTP listener shuts down", async (t) => {
  const eventBus = new EventBus()
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  socket.send(JSON.stringify({
    type: "authenticate",
    token: API_TOKEN,
  }))
  await waitForMessage(socket)

  const closed = new Promise((resolve) => {
    socket.addEventListener("close", resolve, {
      once: true,
    })
  })
  await api.close()
  await closed

  assert.equal(socket.readyState, WebSocket.CLOSED, "API shutdown must close authenticated WebSocket clients.")
  assert.equal(eventBus.getDiagnostics().closed, false, "The API must not own or close Harvester's EventBus.")
})
