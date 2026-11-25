import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const Module = require("node:module")
const forbiddenModules = new Set(["http", "https", "net", "tls", "dgram", "dns", "dns/promises"])
const originalLoad = Module._load

Module._load = function guardedLoad(request, parent, isMain) {
  const normalized = request.replace(/^node:/, "")
  if (forbiddenModules.has(normalized)) {
    throw new Error("Scenario isolation policy blocked network module access: " + normalized)
  }
  return originalLoad.call(this, request, parent, isMain)
}

for (const networkApi of ["fetch", "WebSocket"]) {
  if (typeof globalThis[networkApi] === "function") {
    globalThis[networkApi] = () => {
      throw new Error("Scenario isolation policy blocked " + networkApi)
    }
  }
}

const filesystem = require("node:fs")
for (const operation of [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync",
  "createWriteStream", "mkdir", "mkdirSync", "rm", "rmSync",
  "unlink", "unlinkSync", "rename", "renameSync",
]) {
  if (typeof filesystem[operation] === "function") {
    filesystem[operation] = () => {
      throw new Error("Scenario isolation policy blocked filesystem mutation: " + operation)
    }
  }
}

process.on("message", async (request) => {
  try {
    const { runScenarioWorkerRequest } = await import("./scenario-worker-dispatch.js")
    const output = await runScenarioWorkerRequest(request)
    process.send?.({
      runId: request.runId,
      ok: true,
      output,
    })
  } catch (error) {
    process.send?.({
      runId: request?.runId,
      ok: false,
      error: error instanceof Error ? error.message : "Scenario worker failed",
    })
  } finally {
    process.disconnect?.()
  }
})
