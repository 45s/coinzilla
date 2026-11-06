import assert from "node:assert/strict"
import { PassThrough, Writable } from "node:stream"
import test from "node:test"
import { forwardChildOutput } from "./forward-child-output.js"

test("forwards each chunk to every destination", async () => {
  const source = new PassThrough()
  const received = []
  const destination = new Writable({
    write(chunk, encoding, callback) {
      received.push(chunk.toString())
      callback()
    },
  })

  const forwarding = forwardChildOutput({
    source,
    destinations: () => [destination],
  })
  source.end("first\nsecond\n")
  await forwarding

  assert.deepEqual(received, ["first\nsecond\n"])
  destination.end()
})

test("waits for every destination to drain before reading more output", async () => {
  const source = new PassThrough()
  const received = []
  let releaseWrite
  let finished = false
  const slowDestination = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      releaseWrite = callback
    },
  })
  const fastDestination = new Writable({
    write(chunk, encoding, callback) {
      received.push(chunk.toString())
      callback()
    },
  })

  const forwarding = forwardChildOutput({
    source,
    destinations: () => [slowDestination, fastDestination],
  }).then(() => {
    finished = true
  })

  source.end("blocked chunk")
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(finished, false)
  assert.deepEqual(received, ["blocked chunk"])

  releaseWrite()
  await forwarding

  assert.equal(finished, true)
  slowDestination.end()
  fastDestination.end()
})

test("resolves destinations for each chunk", async () => {
  const source = new PassThrough()
  const first = []
  const second = []
  let activeDestinations = [
    new Writable({
      write(chunk, encoding, callback) {
        first.push(chunk.toString())
        callback()
      },
    }),
  ]

  const forwarding = forwardChildOutput({
    source,
    destinations: () => activeDestinations,
  })

  source.write("first")
  activeDestinations = [
    new Writable({
      write(chunk, encoding, callback) {
        second.push(chunk.toString())
        callback()
      },
    }),
  ]
  source.end("second")
  await forwarding

  assert.deepEqual(first, ["first"])
  assert.deepEqual(second, ["second"])
})
