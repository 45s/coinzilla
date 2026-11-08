import { BINANCE_WEBSOCKET_ENDPOINTS } from "../constants/websocket-endpoints.js"
import { assertNativeWebSocketRuntime } from "../utils/runtime.js"

const TARGETS = [
  ["api", BINANCE_WEBSOCKET_ENDPOINTS.testnet.api],
  ["streams", BINANCE_WEBSOCKET_ENDPOINTS.testnet.streams],
]

function safeText(value) {
  if (typeof value !== "string" || value.length === 0) return null
  return value
    .slice(0, 256)
    .replace(/(api[_-]?key|api[_-]?secret|signature|authorization|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
}

function httpStatus(...sources) {
  for (const source of sources) {
    for (const key of ["status", "statusCode"]) {
      const value = source?.[key]
      if (Number.isInteger(value) && value >= 100 && value <= 599) return value
    }
  }
  return null
}

function probeEndpoint(name, url) {
  return new Promise((resolve) => {
    let socket
    let opened = false
    let settled = false
    let timer
    const details = {
      endpoint: name,
      opened: false,
      httpUpgradeStatus: null,
      errorMessage: null,
      underlyingError: null,
      closeCode: null,
      closeReason: null,
      wasClean: null,
    }

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      details.opened = opened
      resolve(details)
    }

    try {
      socket = new WebSocket(url)
    } catch (error) {
      details.errorMessage = safeText(error?.message) ?? "WebSocket construction failed"
      details.underlyingError = {
        name: typeof error?.name === "string" ? error.name : "Error",
        message: safeText(error?.message),
      }
      finish()
      return
    }

    timer = setTimeout(() => {
      details.errorMessage ??= "WebSocket diagnostic timed out"
      try {
        socket.close()
      } catch {
        // A timed-out diagnostic must still finish without affecting the workflow.
      }
      finish()
    }, 5_000)

    socket.addEventListener("open", () => {
      opened = true
      try {
        socket.close(1000, "read-only diagnostic complete")
      } catch {
        finish()
      }
    }, { once: true })

    socket.addEventListener("error", (event) => {
      details.errorMessage = safeText(event?.message) ?? "WebSocket handshake error"
      details.httpUpgradeStatus = httpStatus(event, event?.error)
      if (event?.error instanceof Error) {
        details.underlyingError = {
          name: typeof event.error.name === "string" ? event.error.name : "Error",
          message: safeText(event.error.message),
        }
      }
    })

    socket.addEventListener("close", (event) => {
      details.closeCode = event.code ?? null
      details.closeReason = safeText(event.reason) ?? ""
      details.wasClean = Boolean(event.wasClean)
      finish()
    }, { once: true })
  })
}

const report = {
  runtime: {
    node: process.versions.node,
    bundledUndici: process.versions.undici ?? null,
    guard: "not-checked",
  },
  authenticated: false,
  orderRequestsSent: false,
  endpoints: [],
}

try {
  assertNativeWebSocketRuntime()
  report.runtime.guard = "passed"
} catch (error) {
  report.runtime.guard = "failed"
  report.runtime.guardError = {
    name: error.name,
    message: safeText(error.message),
  }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = 1
}

if (report.runtime.guard === "passed") {
  report.endpoints = await Promise.all(TARGETS.map(([name, url]) => probeEndpoint(name, url)))
  console.log(JSON.stringify(report, null, 2))
  if (report.endpoints.some((endpoint) => !endpoint.opened)) process.exitCode = 1
}
