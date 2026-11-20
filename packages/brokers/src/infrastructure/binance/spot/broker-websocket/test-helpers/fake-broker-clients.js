function createFakeRpcLifecycle({ listeners, errorListeners, closeListeners }) {
  return {
    async connect() {
      this.state = "open"
      return this
    },
    async disconnect() {
      this.state = "closed"
      for (const listener of closeListeners) {
        listener({ code: 1000,
reason: "",
wasClean: true })
      }
      listeners.clear()
      errorListeners.clear()
      closeListeners.clear()
    },
  }
}

function createFakeRpcRequests({ calls, handlers }) {
  return {
    async request(...args) {
      const [method, params = {}, options = {}] = args
      calls.push({ method,
params,
options })
      const handler = handlers[method]
      if (typeof handler !== "function") {
        throw new Error(`Unexpected Binance RPC method: ${method}`)
      }
      return { data: await handler(params, options) }
    },
  }
}

function createFakeRpcListeners({ listeners, errorListeners, closeListeners }) {
  return {
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    emitEvent(event) {
      for (const listener of listeners) {listener(event)}
    },
    emitError(error) {
      for (const listener of errorListeners) {listener(error)}
    },
    onClose(listener) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    emitClose(event) {
      for (const listener of closeListeners) {listener(event)}
    },
  }
}

export function createFakeRpcClient(handlers = {}) {
  const listeners = new Set()
  const errorListeners = new Set()
  const closeListeners = new Set()
  const calls = []
  const dependencies = { listeners,
errorListeners,
closeListeners,
calls,
handlers }
  const client = {
    calls,
    state: "idle",
    ...createFakeRpcLifecycle(dependencies),
    ...createFakeRpcRequests(dependencies),
    ...createFakeRpcListeners(dependencies),
  }
  Object.defineProperties(client, {
    listenerCount: { get: () => listeners.size },
    errorListenerCount: { get: () => errorListeners.size },
    closeListenerCount: { get: () => closeListeners.size },
  })
  return client
}

export function createFakeStreamsClient() {
  const listeners = new Map()
  const calls = []

  return {
    calls,
    async subscribe(...args) {
      const [stream, listener] = args
      calls.push({ method: "subscribe",
stream })
      const streamListeners = listeners.get(stream) ?? new Set()
      streamListeners.add(listener)
      listeners.set(stream, streamListeners)
      return [stream]
    },
    async unsubscribe(...args) {
      const [stream, listener] = args
      calls.push({ method: "unsubscribe",
stream })
      const streamListeners = listeners.get(stream)
      streamListeners?.delete(listener)
      if (streamListeners?.size === 0) {listeners.delete(stream)}
      return [stream]
    },
    async disconnect() {
      listeners.clear()
    },
    emit(...args) {
      const [stream, event] = args
      for (const listener of listeners.get(stream) ?? []) {listener(event)}
    },
    get listenerCount() {
      return [...listeners.values()].reduce((...args) => {
        const [total, set] = args
        return total + set.size
      }, 0)
    },
  }
}
