export function createFakeRpcClient(handlers = {}) {
  const listeners = new Set()
  const calls = []

  return {
    calls,
    state: "idle",

    async connect() {
      this.state = "open"
      return this
    },

    async disconnect() {
      this.state = "closed"
      listeners.clear()
    },

    async request(method, params = {}, options = {}) {
      calls.push({ method, params, options })
      const handler = handlers[method]
      if (typeof handler !== "function") {
        throw new Error(`Unexpected Binance RPC method: ${method}`)
      }
      return { data: await handler(params, options) }
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    emitEvent(event) {
      for (const listener of listeners) listener(event)
    },

    get listenerCount() {
      return listeners.size
    },
  }
}

export function createFakeStreamsClient() {
  const listeners = new Map()
  const calls = []

  return {
    calls,
    async subscribe(stream, listener) {
      calls.push({ method: "subscribe", stream })
      const streamListeners = listeners.get(stream) ?? new Set()
      streamListeners.add(listener)
      listeners.set(stream, streamListeners)
      return [stream]
    },
    async unsubscribe(stream, listener) {
      calls.push({ method: "unsubscribe", stream })
      const streamListeners = listeners.get(stream)
      streamListeners?.delete(listener)
      if (streamListeners?.size === 0) listeners.delete(stream)
      return [stream]
    },
    async disconnect() {
      listeners.clear()
    },
    emit(stream, event) {
      for (const listener of listeners.get(stream) ?? []) listener(event)
    },
    get listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
  }
}
