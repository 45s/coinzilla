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

async function startApi({ t, eventBus, subscribeExchangeAccountUpdates, exchangeAccounts = [] } = {}) {
  const api = await startTradingHistoryApiServer({
    queries: createQueries(),
    environment: "testnet",
    host: "127.0.0.1",
    port: 0,
    eventBus,
    subscribeExchangeAccountUpdates,
    exchangeAccounts,
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
  const initialSnapshot = await waitForMessage(socket)
  assert.equal(initialSnapshot.type, "exchange-accounts.snapshot", "Every new client must receive an initial account snapshot, including an empty provider list.")
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
  await waitForMessage(socket)
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
  const api = await startApi({
    t,
    eventBus,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  await waitForMessage(socket)
  const publication = eventBus.publish({
    name: "account.snapshot_captured",
    source: "harvester.account-snapshot",
    data: { phase: "LIVE" },
  })
  assert.equal(publication.ok, true)
  const message = await waitForMessage(socket)
  assert.equal(message.type, "exchange-accounts.updated")
  assert.deepEqual(message.accounts, [])
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
  await waitForMessage(socket)
  notify()
  const message = await waitForMessage(socket)
  assert.equal(message.type, "exchange-accounts.updated")
  assert.deepEqual(message.accounts, [])
  await api.close()
  assert.equal(unsubscribed, true, "Closing the API must detach the monitor listener without managing the exchange stream.")
})



function createExchangeAccount({ providerInstanceId = "binance-testnet", providerType = "binance", accountId = "primary", snapshotResult, ordersResult } = {}) {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment: "testnet",
    connected: true,
    readAccountSnapshot: async () => snapshotResult ?? ({
      ok: true,
      data: {
        sourceTime: "2026-11-22T10:00:00.000Z",
        balances: [{
          asset: {
            code: "USDT",
          },
          free: "125.50000000",
          locked: "2.00000000",
          total: "127.50000000",
        }],
      },
    }),
    readOpenOrders: async () => ordersResult ?? ({
      ok: true,
      data: [{
        value: {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "65000.00000000",
          originalQuantity: "0.01000000",
          executedQuantity: "0.00400000",
          remainingQuantity: "0.00600000",
          status: "PARTIALLY_FILLED",
        },
      }],
    }),
  };
}

test("sends the initial provider account and complete open-order snapshot over WebSocket", async (t) => {
  const eventBus = new EventBus();
  const api = await startApi({
    t,
    eventBus,
    exchangeAccounts: [createExchangeAccount()],
  });
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => socket.close());

  await waitForSocketOpen(socket);
  const message = await waitForMessage(socket);
  assert.equal(message.type, "exchange-accounts.snapshot");
  assert.equal(typeof message.observedAt, "string");
  assert.deepEqual(message.accounts, [{
    providerInstanceId: "binance-testnet",
    providerType: "binance",
    accountId: "primary",
    environment: "testnet",
    connected: true,
    accountSnapshot: {
      sourceTime: "2026-11-22T10:00:00.000Z",
      balances: [{
        asset: {
          code: "USDT",
        },
        free: "125.50000000",
        locked: "2.00000000",
        total: "127.50000000",
      }],
    },
    openOrders: [{
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "65000.00000000",
      originalQuantity: "0.01000000",
      executedQuantity: "0.00400000",
      remainingQuantity: "0.00600000",
      status: "PARTIALLY_FILLED",
    }],
    errors: {},
  }]);
});

test("keeps provider read failures explicit instead of fabricating empty snapshots", async (t) => {
  const eventBus = new EventBus();
  const api = await startApi({
    t,
    eventBus,
    exchangeAccounts: [
      createExchangeAccount({
        providerInstanceId: "binance-testnet",
        snapshotResult: { ok: false },
        ordersResult: { ok: false },
      }),
      createExchangeAccount({
        providerInstanceId: "bitunix-live",
        providerType: "bitunix",
        accountId: "secondary",
      }),
    ],
  });
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => socket.close());

  await waitForSocketOpen(socket);
  const message = await waitForMessage(socket);
  assert.equal(message.type, "exchange-accounts.snapshot");
  assert.equal(message.accounts.length, 2);
  assert.equal(message.accounts[0].accountSnapshot, null, "A failed account read must not be represented as an empty balance snapshot.");
  assert.equal(message.accounts[0].openOrders, null, "A failed order read must not be represented as an empty open-order snapshot.");
  assert.deepEqual(message.accounts[0].errors, {
    accountSnapshot: "Account snapshot is unavailable.",
    openOrders: "Open orders are unavailable.",
  });
  assert.deepEqual(message.accounts[1].errors, {}, "One provider failure must not hide another provider's successful snapshot.");
  assert.equal(message.accounts[1].openOrders.length, 1);
});

test("broadcasts refreshed account and open-order snapshots after monitor updates", async (t) => {
  const eventBus = new EventBus();
  let orderPrice = "65000.00000000";
  const account = createExchangeAccount();
  account.readOpenOrders = async () => ({
    ok: true,
    data: [{
      value: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: orderPrice,
        originalQuantity: "0.01",
        status: "NEW",
      },
    }],
  });
  const api = await startApi({
    t,
    eventBus,
    exchangeAccounts: [account],
  });
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => socket.close());

  await waitForSocketOpen(socket);
  await waitForMessage(socket);
  orderPrice = "64000.00000000";
  const publication = eventBus.publish({
    name: "account.open_orders_captured",
    source: "harvester.account-snapshot",
    data: { phase: "LIVE" },
  });
  assert.equal(publication.ok, true);
  const message = await waitForMessage(socket);
  assert.equal(message.type, "exchange-accounts.updated");
  assert.equal(message.accounts[0].openOrders[0].price, "64000.00000000");
});


test("sends an account snapshot larger than 115,637 bytes without terminating the HTTP server", async (t) => {
  const eventBus = new EventBus();
  const balances = Array.from({ length: 1600 }, (_, index) => ({
    asset: {
      code: `ASSET${String(index).padStart(4, "0")}`,
    },
    free: "12345678901234567890",
    locked: "12345678901234567890",
    total: "24691357802469135780",
  }));
  const api = await startApi({
    t,
    eventBus,
    exchangeAccounts: [
      createExchangeAccount({
        snapshotResult: {
          ok: true,
          data: {
            sourceTime: "2026-11-24T19:20:00.000Z",
            balances,
          },
        },
      }),
    ],
  });
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => socket.close());

  await waitForSocketOpen(socket);
  const message = await waitForMessage(socket);
  const payloadBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
  assert.ok(payloadBytes > 115637, "The regression fixture must exceed the 115,637-byte production failure payload.");
  assert.equal(message.accounts[0].accountSnapshot.balances.length, balances.length, "A large account snapshot must arrive without dropping balance rows.");

  const response = await fetch(`http://127.0.0.1:${api.address.port}/api/v1/trading/metadata`);
  assert.equal(response.status, 200, "The HTTP listener must remain available after sending a large WebSocket snapshot.");
});

test("contains one client's account-snapshot serialization failure and serves the next client", async (t) => {
  const eventBus = new EventBus();
  const account = createExchangeAccount();
  let snapshotReadCount = 0;
  account.readAccountSnapshot = async () => {
    snapshotReadCount += 1;
    if (snapshotReadCount === 1) {
      const malformedBalance = {
        asset: {
          code: "INVALID",
        },
      };
      malformedBalance.self = malformedBalance;
      return {
        ok: true,
        data: {
          sourceTime: "2026-11-24T19:20:00.000Z",
          balances: [malformedBalance],
        },
      };
    }
    return {
      ok: true,
      data: {
        sourceTime: "2026-11-24T19:21:00.000Z",
        balances: [],
      },
    };
  };
  const api = await startApi({
    t,
    eventBus,
    exchangeAccounts: [account],
  });
  const failingSocket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => failingSocket.close());
  const failingSocketClosed = new Promise((resolve) => {
    failingSocket.addEventListener("close", resolve, {
      once: true,
    });
  });

  await waitForSocketOpen(failingSocket);
  const closeEvent = await failingSocketClosed;
  assert.equal(closeEvent.code, 1011, "A client with an unserializable application snapshot must be closed with an internal-error status.");

  const healthySocket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`);
  t.after(() => healthySocket.close());
  await waitForSocketOpen(healthySocket);
  const message = await waitForMessage(healthySocket);
  assert.equal(message.type, "exchange-accounts.snapshot", "A later client must still receive its initial account snapshot.");
  assert.deepEqual(message.accounts[0].accountSnapshot.balances, [], "The serialization failure for one client must not corrupt another client's valid snapshot.");
});
