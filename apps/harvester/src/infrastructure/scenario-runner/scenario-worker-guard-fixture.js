import { createRequire } from "node:module"
import { installScenarioWorkerGuards } from "./scenario-worker-guards.js"

const require = createRequire(import.meta.url)
installScenarioWorkerGuards()

process.on("message", async (message) => {
  if (message?.type !== "execute") {
    return
  }
  let esmImportBlocked = false
  try {
    await import("node:child_process")
  } catch {
    esmImportBlocked = true
  }
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
  let fetchBlocked = false
  try {
    await globalThis.fetch("http://127.0.0.1/")
  } catch {
    fetchBlocked = true
  }
  let syncWriteBlocked = false
  try {
    require("node:fs").writeFileSync(message.input.writePath, "blocked")
  } catch {
    syncWriteBlocked = true
  }
  const fsPromises = require("node:fs/promises")
  let promiseWriteBlocked = false
  try {
    await fsPromises.writeFile(message.input.writePath, "blocked")
  } catch {
    promiseWriteBlocked = true
  }
  let writeOpenBlocked = false
  try {
    await fsPromises.open(message.input.writePath, "w")
  } catch {
    writeOpenBlocked = true
  }
  process.send?.({
    runId: message.runId,
    ok: true,
    output: {
      blockedModules,
      esmImportBlocked,
      fetchBlocked,
      syncWriteBlocked,
      promiseWriteBlocked,
      writeOpenBlocked,
      secretInherited: process.env.COINZILLA_SCENARIO_TEST_SECRET !== undefined,
    },
  })
  process.disconnect?.()
})
