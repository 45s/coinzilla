import { randomBytes, createHash } from "node:crypto"
import { request as httpsRequest } from "node:https"

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

function readHttpUpgradeStatus(...sources) {
  for (const source of sources) {
    for (const key of ["status", "statusCode"]) {
      const value = source?.[key]
      if (Number.isInteger(value) && value >= 100 && value <= 599) return value
    }
  }
  return null
}

function probeHttpReachability(name, websocketUrl) {
  return new Promise((resolve) => {
    const endpoint = new URL(websocketUrl)
    endpoint.protocol = "https:"
    endpoint.search = ""
    endpoint.hash = ""
    const key = randomBytes(16).toString("base64")
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const request = httpsRequest(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
    }, (response) => {
      const chunks = []
      let size = 0
      response.on("data", (chunk) => {
        if (size >= 512) return
        const remaining = 512 - size
        const bounded = chunk.subarray(0, remaining)
        chunks.push(bounded)
        size += bounded.length
      })
      response.on("end", () => {
        const blockedByLink = response.headers.link?.match(/<([^>]+)>\s*;\s*rel=["']?blocked-by["']?/i)?.[1]
        let blockedByHost = null
        if (blockedByLink) {
          try {
            blockedByHost = new URL(blockedByLink).host
          } catch {
            blockedByHost = null
          }
        }
        finish({
          endpoint: name,
          reachable: true,
          httpUpgradeStatus: response.statusCode ?? null,
          upgraded: false,
          responseMessage: safeText(Buffer.concat(chunks).toString("utf8")),
          blockedByHost,
        })
      })
    })

    request.on("upgrade", (response, socket) => {
      const expectedAccept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64")
      finish({
        endpoint: name,
        reachable: true,
        httpUpgradeStatus: response.statusCode ?? null,
        upgraded: true,
        acceptHeaderValid: response.headers["sec-websocket-accept"] === expectedAccept,
        responseMessage: null,
        blockedByHost: null,
      })
      socket.destroy()
    })

    request.on("error", (error) => finish({
      endpoint: name,
      reachable: false,
      httpUpgradeStatus: null,
      upgraded: false,
      errorName: typeof error?.name === "string" ? error.name : "Error",
      errorMessage: safeText(error?.message),
    }))

    request.setTimeout(5_000, () => {
      request.destroy(new Error("TESTNET HTTP upgrade probe timed out"))
    })
    request.end()
  })
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
      closeRequested: false,
      closeTimedOut: false,
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

    const armTimeout = (delay) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (opened) {
          details.closeTimedOut = true
        } else {
          details.errorMessage ??= "WebSocket handshake timed out"
          try {
            socket.close()
          } catch {
            // A timed-out diagnostic must still finish without affecting the workflow.
          }
        }
        finish()
      }, delay)
    }
    armTimeout(5_000)

    socket.addEventListener("open", () => {
      opened = true
      details.closeRequested = true
      try {
        socket.close(1000, "read-only diagnostic complete")
      } catch {
        details.closeTimedOut = true
        finish()
        return
      }
      // A successful upgrade is the protocol signal; a peer that ignores our
      // diagnostic close frame must not be misreported as a failed handshake.
      armTimeout(1_000)
    }, { once: true })

    socket.addEventListener("error", (event) => {
      details.errorMessage = safeText(event?.message) ?? "WebSocket handshake error"
      details.httpUpgradeStatus = readHttpUpgradeStatus(event, event?.error)
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
  httpUpgradeProbes: [],
  endpoints: [],
}

report.httpUpgradeProbes = await Promise.all(
  TARGETS.map(([name, url]) => probeHttpReachability(name, url)),
)

try {
  assertNativeWebSocketRuntime()
  report.runtime.guard = "passed"
} catch (error) {
  report.runtime.guard = "failed"
  report.runtime.guardError = {
    name: error.name,
    message: safeText(error.message),
  }
  process.exitCode = 1
}

if (report.runtime.guard === "passed") {
  report.endpoints = await Promise.all(TARGETS.map(([name, url]) => probeEndpoint(name, url)))
  if (report.endpoints.some((endpoint) => !endpoint.opened)) process.exitCode = 1
}

if (report.httpUpgradeProbes.some((endpoint) =>
  !endpoint.reachable || !endpoint.upgraded || endpoint.acceptHeaderValid === false
)) process.exitCode = 1
console.log(JSON.stringify(report, null, 2))
