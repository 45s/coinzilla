import assert from "node:assert/strict"
import test from "node:test"
import { createHarvesterRuntimeErrorBuffer } from "../logging/create-harvester-runtime-error-buffer.js"
import { createRuntimeErrorObserver } from "./create-runtime-error-observer.js"

function createEntry(message) {
  return {
    timestamp: "2026-11-21T08:00:00.000Z",
    level: "error",
    method: "error",
    data: {
      message,
    },
  }
}

function createDeferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return {
    promise,
    resolve,
  }
}

test("continues draining after one relational write fails", async () => {
  const buffer = createHarvesterRuntimeErrorBuffer()
  const persisted = []
  let attempts = 0
  const observer = createRuntimeErrorObserver({
    errorBuffer: buffer,
    repository: {
      async create({ entry }) {
        attempts += 1
        if (attempts === 1) {
          throw new Error("simulated SQLite write failure")
        }
        persisted.push(entry)
      },
    },
    logger: {
      warn() {},
    },
  })

  buffer.transport.write(createEntry("first"))
  buffer.transport.write(createEntry("second"))
  const result = await observer.flush()

  assert.equal(result.ok, false, "A failed row write must make projection completeness explicitly false.")
  assert.equal(observer.getDiagnostics().failedCount, 1, "The observer must count failed writes.")
  assert.equal(persisted.length, 1, "A failed row must not poison later queued error records.")
  assert.equal(persisted[0].data.message, "second", "The queue must continue in FIFO order after a failed write.")
  await observer.close()
})

test("bounds the asynchronous persistence queue and reports dropped rows", async () => {
  const buffer = createHarvesterRuntimeErrorBuffer()
  const deferred = createDeferred()
  const persisted = []
  const observer = createRuntimeErrorObserver({
    errorBuffer: buffer,
    queueCapacity: 1,
    repository: {
      async create({ entry }) {
        if (entry.data.message === "first") {
          await deferred.promise
        }
        persisted.push(entry)
      },
    },
    logger: {
      warn() {},
    },
  })

  buffer.transport.write(createEntry("first"))
  buffer.transport.write(createEntry("second"))
  buffer.transport.write(createEntry("third"))
  assert.equal(observer.getDiagnostics().droppedCount, 1, "A full persistence queue must count each dropped error.")
  deferred.resolve()
  await observer.flush()
  assert.deepEqual(persisted.map((entry) => entry.data.message), ["first", "second"], "The bounded queue must retain FIFO order for accepted rows.")
  await observer.close()
})
