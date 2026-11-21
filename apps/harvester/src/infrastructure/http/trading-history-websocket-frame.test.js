import assert from "node:assert/strict"
import test from "node:test"
import { consumeWebSocketFrames } from "./trading-history-websocket-frame.js"

function createMaskedFrame({ opcode = 0x1, payload = "hello", final = true } = {}) {
  const body = Buffer.from(payload)
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  let header
  if (body.length < 126) {
    header = Buffer.from([
      (final ? 0x80 : 0) | opcode,
      0x80 | body.length,
    ])
  } else {
    header = Buffer.alloc(4)
    header[0] = (final ? 0x80 : 0) | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(body.length, 2)
  }
  const masked = Buffer.alloc(body.length)
  for (let index = 0; index < body.length; index += 1) {
    masked[index] = body[index] ^ mask[index % 4]
  }
  return Buffer.concat([header, mask, masked])
}

test("decodes masked text frames and retains an incomplete frame tail", () => {
  const frame = createMaskedFrame({
    payload: JSON.stringify({ type: "authenticate" }),
  })
  const first = consumeWebSocketFrames({
    chunk: frame.subarray(0, 5),
  })
  assert.deepEqual(first.frames, [], "An incomplete client frame must not be delivered.")
  assert.equal(first.buffer.length, 5, "The decoder must retain the incomplete frame bytes.")

  const second = consumeWebSocketFrames({
    buffer: first.buffer,
    chunk: frame.subarray(5),
  })
  assert.equal(second.error, undefined, "A complete valid frame must not produce a protocol error.")
  assert.equal(second.frames.length, 1, "The decoder must emit exactly one complete frame.")
  assert.equal(second.frames[0].opcode, 0x1, "The decoder must preserve the frame opcode.")
  assert.equal(second.frames[0].payload.toString("utf8"), JSON.stringify({ type: "authenticate" }))
  assert.equal(second.buffer.length, 0, "Consumed frame bytes must not remain buffered.")
})

test("rejects unmasked, fragmented, unsupported, and oversized client frames", () => {
  const unmasked = consumeWebSocketFrames({
    chunk: Buffer.from([0x81, 0x01, 0x61]),
  })
  const fragmented = consumeWebSocketFrames({
    chunk: createMaskedFrame({ final: false }),
  })
  const unsupported = consumeWebSocketFrames({
    chunk: createMaskedFrame({ opcode: 0x2 }),
  })
  const oversized = consumeWebSocketFrames({
    chunk: createMaskedFrame({ payload: "x".repeat(1025) }),
  })

  assert.match(unmasked.error, /masked/)
  assert.match(fragmented.error, /final/)
  assert.match(unsupported.error, /opcode/)
  assert.match(oversized.error, /size/)
})
