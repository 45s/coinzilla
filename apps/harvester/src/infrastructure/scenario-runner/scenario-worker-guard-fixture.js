import { createRequire } from "node:module"
import { installScenarioWorkerGuards } from "./scenario-worker-guards.js"

const require = createRequire(import.meta.url)
installScenarioWorkerGuards()

async function isEsmImportBlocked() {
  try {
    await import("node:child_process")
    return false
  } catch {
    return true
  }
}

function getBlockedModules() {
  const blockedModules = []
  for (const moduleName of [
    "node:child_process",
    "node:worker_threads",
    "node:http2",
    "node:net",
  ]) {
    try {
      require(moduleName)
    } catch {
      blockedModules.push(moduleName)
    }
  }
  return blockedModules
}

async function isFetchBlocked() {
  try {
    await globalThis.fetch("http://127.0.0.1/")
    return false
  } catch {
    return true
  }
}

function isSyncWriteBlocked({ writePath }) {
  try {
    require("node:fs").writeFileSync(writePath, "blocked")
    return false
  } catch {
    return true
  }
}

async function getPromiseWriteResults({ writePath }) {
  const fsPromises = require("node:fs/promises")
  let esmPromiseWriteBlocked = false
  try {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(writePath, "blocked")
  } catch {
    esmPromiseWriteBlocked = true
  }
  let promiseWriteBlocked = false
  try {
    await fsPromises.writeFile(writePath, "blocked")
  } catch {
    promiseWriteBlocked = true
  }
  let writeOpenBlocked = false
  try {
    await fsPromises.open(writePath, "w")
  } catch {
    writeOpenBlocked = true
  }
  return {
    promiseWriteBlocked,
    esmPromiseWriteBlocked,
    writeOpenBlocked,
  }
}

async function collectGuardResults({ writePath }) {
  return {
    blockedModules: getBlockedModules(),
    esmImportBlocked: await isEsmImportBlocked(),
    fetchBlocked: await isFetchBlocked(),
    syncWriteBlocked: isSyncWriteBlocked({ writePath }),
    ...await getPromiseWriteResults({ writePath }),
    secretInherited: process.env.COINZILLA_SCENARIO_TEST_SECRET !== undefined,
  }
}

process.on("message", async (message) => {
  if (message?.type !== "execute") {
    return
  }
  process.send?.({
    type: "started",
    runId: message.runId,
  })
  const output = await collectGuardResults({
    writePath: message.input.writePath,
  })
  process.send?.({
    runId: message.runId,
    ok: true,
    output,
  })
  process.disconnect?.()
})

process.send?.({ type: "ready" })
