import assert from "node:assert/strict"
import { PassThrough, Writable } from "node:stream"
import test from "node:test"
import { forwardChildOutput } from "../../scripts/forward-child-output.js"

test("forwards each chunk to every durable destination", async () => {
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

  assert.deepEqual(received, ["first\nsecond\n"], "the durable destination must receive the complete source output")
  destination.end()
})

test("waits for every durable destination to drain before reading more output", async () => {
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

  assert.equal(finished, false, "forwarding must pause while a durable destination is applying backpressure")
  assert.deepEqual(received, ["blocked chunk"], "other durable destinations must receive the chunk before the slow destination drains")

  releaseWrite()
  await forwarding

  assert.equal(finished, true, "forwarding must resume and finish after every durable destination drains")
  slowDestination.end()
  fastDestination.end()
})

test("keeps durable capture moving when a best-effort terminal is stalled", async () => {
  const source = new PassThrough()
  const durableChunks = []
  const terminalChunks = []
  let releaseTerminalWrite
  const durableDestination = new Writable({
    write(chunk, encoding, callback) {
      durableChunks.push(chunk.toString())
      callback()
    },
  })
  const stalledTerminal = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      terminalChunks.push(chunk.toString())
      releaseTerminalWrite = callback
    },
  })

  const forwarding = forwardChildOutput({
    source,
    destinations: () => [durableDestination],
    bestEffortDestinations: () => [stalledTerminal],
  })

  source.write("first")
  await new Promise((resolve) => setImmediate(resolve))
  source.write("second")
  await new Promise((resolve) => setImmediate(resolve))
  source.end("third")

  const droppedChunks = await forwarding

  assert.deepEqual(durableChunks, ["first", "second", "third"], "durable capture must retain every chunk while terminal output is stalled")
  assert.deepEqual(terminalChunks, ["first"], "a stalled terminal must not accumulate additional chunks")
  assert.equal(droppedChunks, 2, "the forwarder must report the two chunks skipped by the stalled terminal")

  releaseTerminalWrite()
  stalledTerminal.end()
  durableDestination.end()
})

test("resolves durable destinations for each chunk", async () => {
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
  await new Promise((resolve) => setImmediate(resolve))
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

  assert.deepEqual(first, ["first"], "the first durable destination must receive only the chunk written while it was active")
  assert.deepEqual(second, ["second"], "the replacement durable destination must receive subsequent chunks")
})
