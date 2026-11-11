import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createFileDurableFactsStore } from "../src/infrastructure/durable-facts/create-file-durable-facts-store.js"

function isAbsoluteLocalDirectory(directory) {
  if (process.platform === "win32") return /^[A-Za-z]:[\\/]/.test(directory)
  return path.isAbsolute(directory)
}

export async function runInitializeDurableFacts({
  env = process.env,
  argv = process.argv.slice(2),
  stdout = (message) => process.stdout.write(message + "\n"),
  stderr = (message) => process.stderr.write(message + "\n"),
  createStore = createFileDurableFactsStore,
} = {}) {
  if (!argv.includes("--confirm")) {
    stderr("Refusing to initialize durable facts without the explicit --confirm flag.")
    stderr("Set DURABLE_FACTS_DIRECTORY to an absolute local directory and rerun with --confirm.")
    return 1
  }
  const unknownArguments = argv.filter((argument) => argument !== "--confirm")
  if (unknownArguments.length > 0) {
    stderr("Unknown arguments: " + unknownArguments.join(", "))
    return 1
  }
  const directory = env.DURABLE_FACTS_DIRECTORY
  if (typeof directory !== "string" || directory.trim() === "" ||
      directory !== directory.trim() || !isAbsoluteLocalDirectory(directory)) {
    stderr("DURABLE_FACTS_DIRECTORY must be an absolute local directory path.")
    return 1
  }

  try {
    const store = createStore({
      directory,
      runtimeSessionId: "ledger-initialization:" + randomUUID(),
    })
    const result = await store.initialize()
    if (!result.ok) {
      const message = result.errors?.map(({ message: errorMessage }) => errorMessage).join("; ") ||
        "Unknown durable-fact initialization error"
      stderr("Durable-fact initialization failed: " + message)
      return 1
    }
    stdout("Durable-fact ledger initialized.")
    stdout("Directory: " + path.resolve(directory))
    stdout("Genesis sequence: " + result.data.record.sequence)
    stdout("Genesis digest: " + result.data.record.digest)
    return 0
  } catch (error) {
    stderr("Durable-fact initialization failed: " + error.message)
    return 1
  }
}

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  process.exitCode = await runInitializeDurableFacts()
}
