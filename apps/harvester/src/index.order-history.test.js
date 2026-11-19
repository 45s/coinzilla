import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { main } from "./index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({
    ok: true,
    disabled: true,
  }),
  status: {
    state: "disabled",
  },
  flush: async () => ({
    ok: true,
    durable: true,
  }),
  close: async () => ({
    ok: true,
    closed: true,
    disabled: true,
  }),
})

test("composes order-history observation before runtime start and closes it after EventBus drain", async () => {
  const previousExitCode = process.exitCode
  const calls = []
  const eventBus = new EventBus()
  const originalClose = eventBus.close.bind(eventBus)
  eventBus.close = async (options) => {
    calls.push("event-bus")
    return originalClose(options)
  }
  const database = {
    state: "connected",
    close: async () => {
      calls.push("database")
      database.state = "closed"
    },
  }
  const observer = {
    close: async () => {
      calls.push("observer")
      return {
        ok: true,
        errors: [],
      }
    },
  }
  let preparedEventBus

  try {
    process.exitCode = 0
    await main({
      createEventBus: () => eventBus,
      createJournalService: disabledJournalService,
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => ({
          ok: true,
          released: true,
        }),
      }),
      prepareOrderHistoryPersistence: async ({ eventBus: suppliedEventBus }) => {
        preparedEventBus = suppliedEventBus
        return {
          database,
          observer,
        }
      },
      start: async () => {
        throw new Error("intentional startup failure after persistence preparation")
      },
      logger: {
        info() {},
        system() {},
        warn() {},
        error() {},
      },
    })
  } finally {
    process.exitCode = previousExitCode
  }

  assert.equal(preparedEventBus, eventBus, "The process-wide EventBus must be supplied to the order-history observer before broker startup.")
  assert.deepEqual(calls, [
    "event-bus",
    "observer",
    "database",
  ], "Shutdown must drain EventBus deliveries, flush the observer, and only then close SQLite.")
})
