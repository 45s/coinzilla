import { spawnSync } from "node:child_process"
import { createConnection } from "node:net"
import { readlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function probeReadOnlyFilesystem() {
  const probePath = join(process.cwd(), ["scenario-runner-sandbox-probe-", String(process.pid), ".tmp"].join(""))
  let writeSucceeded = false
  try {
    writeFileSync(probePath, "sandbox probe")
    writeSucceeded = true
    unlinkSync(probePath)
    return {
      blocked: false,
      errorCode: null,
    }
  } catch (error) {
    if (writeSucceeded) {
      return {
        blocked: false,
        errorCode: error.code ?? "CLEANUP_FAILED",
      }
    }
    return {
      blocked: ["EROFS", "EPERM", "EACCES"].includes(error.code),
      errorCode: error.code ?? "UNKNOWN",
    }
  }
}

function probeNetworkUnavailable() {
  return new Promise((resolve) => {
    let settled = false
    let socket
    const finish = ({ connected, errorCode }) => {
      if (settled) {
        return
      }
      settled = true
      socket?.destroy()
      resolve({
        connected,
        errorCode,
      })
    }
    try {
      socket = createConnection({
        host: "1.1.1.1",
        port: 53,
      })
      socket.setTimeout(1_000)
      socket.once("connect", () => finish({
        connected: true,
        errorCode: null,
      }))
      socket.once("error", (error) => finish({
        connected: false,
        errorCode: error.code ?? "UNKNOWN",
      }))
      socket.once("timeout", () => finish({
        connected: false,
        errorCode: "TIMEOUT",
      }))
    } catch (error) {
      finish({
        connected: false,
        errorCode: error.code ?? "UNKNOWN",
      })
    }
  })
}

function probeChildProcessDenied() {
  const result = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
    encoding: "utf8",
    timeout: 1_000,
  })
  const errorCode = result.error?.code ?? null
  return {
    blocked: ["EPERM", "EACCES", "EAGAIN"].includes(errorCode),
    errorCode,
    status: result.status,
  }
}

function probeNamespaceIsolation({ hostNamespaceIds }) {
  return {
    network: readlinkSync(join("/proc/self/ns", "net")) !== hostNamespaceIds.network,
    pid: readlinkSync(join("/proc/self/ns", "pid")) !== hostNamespaceIds.pid,
    user: readlinkSync(join("/proc/self/ns", "user")) !== hostNamespaceIds.user,
    ipc: readlinkSync(join("/proc/self/ns", "ipc")) !== hostNamespaceIds.ipc,
    uts: readlinkSync(join("/proc/self/ns", "uts")) !== hostNamespaceIds.uts,
    rootUidIsMapped: process.getuid() === 0,
  }
}

async function runIsolationProbe({ hostNamespaceIds }) {
  return {
    secretEnvironmentAbsent: process.env.SCENARIO_RUNNER_E2E_SECRET === undefined,
    readOnlyFilesystem: probeReadOnlyFilesystem(),
    network: await probeNetworkUnavailable(),
    childProcess: probeChildProcessDenied(),
    namespaces: probeNamespaceIsolation({ hostNamespaceIds }),
  }
}

process.on("message", async (message) => {
  if (message?.type === "probe") {
    try {
      const results = await runIsolationProbe({
        hostNamespaceIds: message.hostNamespaceIds,
      })
      process.send({
        type: "probe-result",
        results,
      })
    } catch (error) {
      process.send({
        type: "probe-error",
        message: error.message,
      })
    }
    return
  }
  if (message?.type === "done") {
    process.disconnect()
  }
})
