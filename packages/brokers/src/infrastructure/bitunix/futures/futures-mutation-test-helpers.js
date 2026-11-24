import { EventEmitter } from "node:events"

export class FakePrivateWebSocketClient extends EventEmitter {
  state = "idle"

  authenticated = false

  recoveryRequired = true

  subscriptions = []

  unsubscriptions = []

  disconnectCount = 0

  status() {
    return {
      state: this.state,
      authenticated: this.authenticated,
      recoveryRequired: this.recoveryRequired,
    }
  }

  async connect() {
    this.state = "open"
    this.emit("status", this.status())
  }

  async waitUntilAuthenticated() {
    this.authenticated = true
    this.emit("status", this.status())
  }

  markReconciled() {
    this.recoveryRequired = false
    this.emit("status", this.status())
  }

  subscribe({ channels }) {
    this.subscriptions.push(...channels)
    return {
      sent: true,
      channels,
    }
  }

  unsubscribe({ channels }) {
    this.unsubscriptions.push(...channels)
    return {
      sent: true,
      channels,
    }
  }

  async disconnect() {
    this.disconnectCount += 1
    this.state = "closed"
    this.authenticated = false
    this.recoveryRequired = true
    this.emit("status", this.status())
  }
}

export function createFakePrivateWebSocketClientFactory(clients = []) {
  return () => {
    const client = new FakePrivateWebSocketClient()
    clients.push(client)
    return client
  }
}

export async function connectAndAcknowledgeUserDataReconciliation(broker) {
  await broker.connect()
  const subscription = await broker.subscribeForUserData({
    onObservation: () => {},
  })
  if (!subscription.ok) {
    throw subscription.errors[0]
  }
  const acknowledgement = await broker.acknowledgeUserDataReconciliation({
    reconciliationCompleted: true,
  })
  if (!acknowledgement.ok) {
    throw acknowledgement.errors[0]
  }
  return subscription
}
