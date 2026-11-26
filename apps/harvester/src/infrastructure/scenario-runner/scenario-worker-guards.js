import { createRequire, syncBuiltinESMExports } from "node:module"

const require = createRequire(import.meta.url)
const Module = require("node:module")
const filesystem = require("node:fs")
const filesystemPromises = require("node:fs/promises")
const forbiddenModules = new Set([
  "child_process",
  "cluster",
  "worker_threads",
  "inspector",
  "vm",
  "module",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "dns/promises",
  "undici",
  "ws",
  "websocket",
  "node-fetch",
])
const GUARDED_LOAD = Symbol.for("coinzilla.scenario-worker.guarded-load")

function createBlockedOperation({ operation, kind }) {
  return function blockScenarioOperation() {
    throw new Error(`Scenario isolation policy blocked ${kind}: ${operation}`)
  }
}

function isWritableOpenFlags({ flags }) {
  if (typeof flags === "number") {
    const writeFlags = filesystem.constants.O_WRONLY |
      filesystem.constants.O_RDWR |
      filesystem.constants.O_CREAT |
      filesystem.constants.O_APPEND |
      filesystem.constants.O_TRUNC
    return (flags & writeFlags) !== 0
  }
  return typeof flags === "string" && /[wax+]/.test(flags)
}

function installModuleGuards() {
  if (!Module._load[GUARDED_LOAD]) {
    const originalLoad = Module._load
    const guardedLoad = function guardedScenarioModuleLoad(...loadArguments) {
      const [request] = loadArguments
      const normalized = typeof request === "string" ? request.replace(/^node:/, "") : ""
      if (forbiddenModules.has(normalized)) {
        throw new Error(`Scenario isolation policy blocked module access: ${normalized}`)
      }
      return originalLoad.apply(this, loadArguments)
    }
    Object.defineProperty(guardedLoad, GUARDED_LOAD, {
      value: true,
    })
    Module._load = guardedLoad
  }
  if (typeof Module.registerHooks === "function") {
    Module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const normalized = specifier.replace(/^node:/, "")
        if (forbiddenModules.has(normalized)) {
          throw new Error(`Scenario isolation policy blocked module access: ${normalized}`)
        }
        return nextResolve(specifier, context)
      },
    })
  }
}

function installFilesystemGuards() {
  const synchronousMutations = [
    "writeFile", "writeFileSync", "appendFile", "appendFileSync",
    "createWriteStream", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync",
    "rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync",
    "rename", "renameSync", "copyFile", "copyFileSync", "truncate",
    "truncateSync", "chmod", "chmodSync", "chown", "chownSync",
    "symlink", "symlinkSync", "link", "linkSync",
  ]
  for (const operation of synchronousMutations) {
    if (typeof filesystem[operation] === "function") {
      filesystem[operation] = createBlockedOperation({
        operation,
        kind: "filesystem mutation",
      })
    }
  }
  const asynchronousMutations = [
    "writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir",
    "unlink", "rename", "copyFile", "truncate", "chmod", "chown",
    "symlink", "link",
  ]
  for (const operation of asynchronousMutations) {
    if (typeof filesystemPromises[operation] === "function") {
      filesystemPromises[operation] = createBlockedOperation({
        operation,
        kind: "promise filesystem mutation",
      })
    }
  }
  const originalOpen = filesystem.open
  filesystem.open = function guardedOpen(...openArguments) {
    if (isWritableOpenFlags({ flags: openArguments[1] })) {
      throw new Error("Scenario isolation policy blocked writable filesystem handles")
    }
    return originalOpen.apply(this, openArguments)
  }
  const originalOpenSync = filesystem.openSync
  filesystem.openSync = function guardedOpenSync(...openArguments) {
    if (isWritableOpenFlags({ flags: openArguments[1] })) {
      throw new Error("Scenario isolation policy blocked writable filesystem handles")
    }
    return originalOpenSync.apply(this, openArguments)
  }
  const originalPromiseOpen = filesystemPromises.open
  filesystemPromises.open = async function guardedPromiseOpen(...openArguments) {
    if (isWritableOpenFlags({ flags: openArguments[1] })) {
      throw new Error("Scenario isolation policy blocked writable filesystem handles")
    }
    return originalPromiseOpen.apply(this, openArguments)
  }
  syncBuiltinESMExports()
}

function installGlobalNetworkGuards() {
  for (const networkApi of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
    if (typeof globalThis[networkApi] === "function") {
      globalThis[networkApi] = createBlockedOperation({
        operation: networkApi,
        kind: "network API",
      })
    }
  }
}

export function installScenarioWorkerGuards() {
  installModuleGuards()
  installFilesystemGuards()
  installGlobalNetworkGuards()
  return Object.freeze({
    level: "node-api-guards",
  })
}
