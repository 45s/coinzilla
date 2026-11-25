import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const Module = require("node:module")
const forbiddenModules = new Set(["http", "https", "net", "tls", "dgram", "dns", "dns/promises"])
const originalLoad = Module._load

Module._load = function guardedLoad(...loadArguments) {
  const [request] = loadArguments
  const normalized = request.replace(/^node:/, "")
  if (forbiddenModules.has(normalized)) {
    throw new Error(`Scenario isolation policy blocked network module access: ${normalized}`)
  }
  return originalLoad.apply(this, loadArguments)
}

for (const networkApi of ["fetch", "WebSocket"]) {
  if (typeof globalThis[networkApi] === "function") {
    globalThis[networkApi] = () => {
      throw new Error(`Scenario isolation policy blocked ${networkApi}`)
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
      throw new Error(`Scenario isolation policy blocked filesystem mutation: ${operation}`)
    }
  }
}

const { createScenarioWorkerMessageHandler } = await import("./scenario-worker-message-handler.js")

const handleWorkerMessage = createScenarioWorkerMessageHandler({
  dispatch: async ({ request, signal }) => {
    const { runScenarioWorkerRequest } = await import("./scenario-worker-dispatch.js")
    return runScenarioWorkerRequest({
      request,
      signal,
    })
  },
  send: (message) => process.send?.(message),
  disconnect: () => process.disconnect?.(),
})

process.on("message", handleWorkerMessage)
