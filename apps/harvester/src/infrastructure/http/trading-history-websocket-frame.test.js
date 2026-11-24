import assert from "node:assert/strict"
import test from "node:test"
import { consumeWebSocketFrames, encodeWebSocketFrame } from "./trading-history-websocket-frame.js"

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
  for (let index = 0 index < body.length index += 1) {
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

test("encodes server frames with the 7-bit and 16-bit payload-length forms", () => {
  const shortPayload = Buffer.alloc(125, 0x61)
  const shortFrame = encodeWebSocketFrame({
    opcode: 0x1,
    payload: shortPayload,
  })
  assert.equal(shortFrame[0], 0x81, "A text server frame must set FIN and preserve the text opcode.")
  assert.equal(shortFrame[1], 125, "Payloads up to 125 bytes must use the inline 7-bit length.")
  assert.equal(shortFrame.length, 127, "The short frame must contain its two-byte header and complete payload.")
  assert.deepEqual(shortFrame.subarray(2), shortPayload, "The encoder must preserve every payload byte.")

  const extendedPayload = Buffer.alloc(126, 0x62)
  const extendedFrame = encodeWebSocketFrame({
    opcode: 0x1,
    payload: extendedPayload,
  })
  assert.equal(extendedFrame[1], 126, "A 126-byte payload must select the 16-bit extended-length marker.")
  assert.equal(extendedFrame.readUInt16BE(2), 126, "The 16-bit field must contain the exact payload byte length.")
  assert.equal(extendedFrame.length, 130, "The 16-bit frame must contain its four-byte header and complete payload.")
  assert.deepEqual(extendedFrame.subarray(4), extendedPayload, "The extended frame must preserve the complete payload.")
})

test("encodes the 65,535 and 65,536 byte boundary with the correct extended forms", () => {
  const maximum16BitPayload = Buffer.alloc(65535, 0x63)
  const maximum16BitFrame = encodeWebSocketFrame({
    opcode: 0x2,
    payload: maximum16BitPayload,
  })
  assert.equal(maximum16BitFrame[0], 0x82, "A binary server frame must preserve FIN and the binary opcode.")
  assert.equal(maximum16BitFrame[1], 126, "A 65,535-byte payload must use the 16-bit extended-length marker.")
  assert.equal(maximum16BitFrame.readUInt16BE(2), 65535, "The 16-bit field must encode its maximum representable payload length.")
  assert.equal(maximum16BitFrame.length, 65539, "The 16-bit frame must include all payload bytes and its four-byte header.")

  const first64BitPayload = Buffer.alloc(65536, 0x64)
  const first64BitFrame = encodeWebSocketFrame({
    opcode: 0x2,
    payload: first64BitPayload,
  })
  assert.equal(first64BitFrame[1], 127, "A 65,536-byte payload must switch to the 64-bit extended-length marker.")
  assert.equal(first64BitFrame.readBigUInt64BE(2), 65536n, "The 64-bit field must encode the exact payload length as an unsigned integer.")
  assert.equal(first64BitFrame.length, 65546, "The 64-bit frame must include its ten-byte header and complete payload.")
})

test("encodes payloads larger than the production failure size without truncation", () => {
  const payload = Buffer.alloc(115638, 0x65)
  const frame = encodeWebSocketFrame({
    opcode: 0x1,
    payload,
  })
  assert.equal(frame[1], 127, "Payloads above the 16-bit range must use the 64-bit extended-length marker.")
  assert.equal(frame.readBigUInt64BE(2), 115638n, "The 64-bit length must preserve the full large payload size.")
  assert.equal(frame.length, 115648, "The encoded frame must retain all 115,638 payload bytes.")
  assert.equal(frame[frame.length - 1], 0x65, "The final payload byte must remain present after encoding.")
})

test("calculates WebSocket payload length from UTF-8 bytes rather than JavaScript characters", () => {
  const payload = "💹"
  const frame = encodeWebSocketFrame({
    opcode: 0x1,
    payload,
  })
  assert.equal(payload.length, 2, "The fixture must contain two UTF-16 code units.")
  assert.equal(Buffer.byteLength(payload, "utf8"), 4, "The fixture must encode to four UTF-8 bytes.")
  assert.equal(frame[1], 4, "The WebSocket frame length must use the UTF-8 byte count.")
  assert.equal(frame.subarray(2).toString("utf8"), payload, "The encoded frame must preserve the original multibyte text.")
  assert.equal(frame[1] & 0x80, 0, "Server-to-client frames must not set the client masking bit.")
})
