import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "./fake-broker-clients.js"

export function createScheduler() {
  let nextId = 0
  const tasks = new Map()
  return {
    setTimeout(callback, delay) {
      const id = ++nextId
      tasks.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
    get pendingCount() {
      return tasks.size
    },
    get delays() {
      return [...tasks.values()].map((task) => task.delay)
    },
    async runNext() {
      const entry = tasks.entries().next().value
      if (!entry) throw new Error("No scheduled task")
      const [id, task] = entry
      tasks.delete(id)
      await task.callback()
    },
  }
}

function createRpcFactory() {
  const clients = []
  const factory = () => {
    const index = clients.length
    let subscriptionSequence = index * 100 + 10
    const client = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: subscriptionSequence++ }),
      "userDataStream.unsubscribe": () => ({}),
      "order.place": () => ({
        symbol: "BTCUSDT",
        orderId: 77,
        status: "NEW",
        side: "BUY",
        type: "LIMIT",
        price: "50000",
        origQty: "0.01",
        executedQty: "0",
      }),
    })
    clients.push(client)
    return client
  }
  return { clients, factory }
}

export function createBroker({ warningThreshold = 3 } = {}) {
  const scheduler = createScheduler()
  const rpc = createRpcFactory()
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    reconnectDelay: 25,
    logger: { error() {}, info() {}, warn() {} },
  }, {
    apiClientFactory: rpc.factory,
    marketClientFactory: () => createFakeStreamsClient(),
    setTimeoutFn: scheduler.setTimeout,
    clearTimeoutFn: scheduler.clearTimeout,
    userDataRecoveryWarningThreshold: warningThreshold,
  })
  return { broker, scheduler, clients: rpc.clients }
}
