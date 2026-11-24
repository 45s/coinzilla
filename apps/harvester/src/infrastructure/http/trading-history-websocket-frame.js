const DEFAULT_MAX_FRAME_BYTES = 1024

/**
 * Encode an unmasked final server frame using the RFC 6455 payload-length forms.
 *
 * @param {{opcode: number, payload?: Buffer|string}} input
 * @returns {Buffer}
 */
export function encodeWebSocketFrame({ opcode, payload = Buffer.alloc(0) } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  let header
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length])
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(body.length), 2)
  }
  return Buffer.concat([header, body])
}

function createProtocolFailure(reason) {
  return {
    frames: [],
    buffer: Buffer.alloc(0),
    error: reason,
  }
}

function parseFrameHeader({ input, offset, maxFrameBytes } = {}) {
  if (input.length - offset < 2) {
    return {
      incomplete: true,
    }
  }
  const firstByte = input[offset]
  const secondByte = input[offset + 1]
  const finalFrame = (firstByte & 0x80) !== 0
  const reservedBits = firstByte & 0x70
  const opcode = firstByte & 0x0f
  const masked = (secondByte & 0x80) !== 0
  let payloadLength = secondByte & 0x7f
  let headerLength = 2

  if (!finalFrame || reservedBits !== 0 || !masked) {
    return {
      error: "Only final, masked client frames without extensions are supported.",
    }
  }
  if (![0x1, 0x8, 0x9, 0xa].includes(opcode)) {
    return {
      error: "The client WebSocket frame opcode is unsupported.",
    }
  }
  if (payloadLength === 126) {
    if (input.length - offset < 4) {
      return {
        incomplete: true,
      }
    }
    payloadLength = input.readUInt16BE(offset + 2)
    headerLength = 4
  } else if (payloadLength === 127) {
    return {
      error: "The client WebSocket frame exceeds the supported size.",
    }
  }
  if (payloadLength > maxFrameBytes || (opcode >= 0x8 && payloadLength > 125)) {
    return {
      error: "The client WebSocket frame exceeds the supported size.",
    }
  }
  const frameLength = headerLength + 4 + payloadLength
  if (input.length - offset < frameLength) {
    return {
      incomplete: true,
    }
  }
  return {
    opcode,
    headerLength,
    payloadLength,
    frameLength,
  }
}

function decodeMaskedPayload({ input, offset, headerLength, payloadLength } = {}) {
  const maskOffset = offset + headerLength
  const payloadOffset = maskOffset + 4
  const mask = input.subarray(maskOffset, payloadOffset)
  const payload = Buffer.alloc(payloadLength)
  for (let index = 0; index < payloadLength; index += 1) {
    payload[index] = input[payloadOffset + index] ^ mask[index % 4]
  }
  return payload
}

/**
 * Decode complete, masked client frames while retaining an incomplete tail.
 *
 * @param {{buffer?: Buffer, chunk: Buffer, maxFrameBytes?: number}} input
 * @returns {{frames: Array<{opcode: number, payload: Buffer}>, buffer: Buffer, error?: string}}
 */
export function consumeWebSocketFrames({
  buffer = Buffer.alloc(0),
  chunk,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
} = {}) {
  const input = Buffer.concat([buffer, chunk])
  const frames = []
  let offset = 0

  while (input.length - offset >= 2) {
    const header = parseFrameHeader({
      input,
      offset,
      maxFrameBytes,
    })
    if (header.error) {
      return createProtocolFailure(header.error)
    }
    if (header.incomplete) {
      break
    }
    frames.push({
      opcode: header.opcode,
      payload: decodeMaskedPayload({
        input,
        offset,
        headerLength: header.headerLength,
        payloadLength: header.payloadLength,
      }),
    })
    offset += header.frameLength
  }

  const remaining = input.subarray(offset)
  if (remaining.length > maxFrameBytes + 14) {
    return createProtocolFailure("The buffered client WebSocket frame exceeds the supported size.")
  }
  return {
    frames,
    buffer: remaining,
  }
}
