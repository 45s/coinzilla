export class FakeWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url) {
    super()
    this.url = String(url)
    this.readyState = FakeWebSocket.CONNECTING
    this.protocol = ""
    this.extensions = ""
    this.bufferedAmount = 0
    this.binaryType = "blob"
    this.sent = []
    this.closeCalls = []
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("WebSocket is not open")
    }

    this.sent.push(data)
  }

  close(code = 1000, reason = "") {
    if (
      this.readyState === FakeWebSocket.CLOSING ||
      this.readyState === FakeWebSocket.CLOSED
    ) {
      return
    }

    this.readyState = FakeWebSocket.CLOSING
    this.closeCalls.push({ code, reason })
  }

  open() {
    if (this.readyState !== FakeWebSocket.CONNECTING) return

    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }

  receive(data) {
    const event = new Event("message")
    Object.defineProperty(event, "data", { value: data })
    this.dispatchEvent(event)
  }

  fail(error = new Error("Fake WebSocket error")) {
    const event = new Event("error")
    Object.defineProperty(event, "error", { value: error })
    this.dispatchEvent(event)
  }

  serverClose({ code = 1000, reason = "", wasClean = true } = {}) {
    if (this.readyState === FakeWebSocket.CLOSED) return

    this.readyState = FakeWebSocket.CLOSED
    const event = new Event("close")
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
      wasClean: { value: wasClean },
    })
    this.dispatchEvent(event)
  }
}
