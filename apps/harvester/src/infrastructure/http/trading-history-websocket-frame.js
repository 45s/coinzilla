const DEFAULT_MAX_FRAME_BYTES = 1024

function createProtocolFailure(reason) {
  return {
    frames: [],
    buffer: Buffer.alloc(0),
    error: reason,
  }
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
    const firstByte = input[offset]
    const secondByte = input[offset + 1]
    const finalFrame = (firstByte & 0x80) !== 0
    const reservedBits = firstByte & 0x70
    const opcode = firstByte & 0x0f
    const masked = (secondByte & 0x80) !== 0
    let payloadLength = secondByte & 0x7f
    let headerLength = 2

    if (!finalFrame || reservedBits !== 0 || !masked) {
      return createProtocolFailure("Only final, masked client frames without extensions are supported.")
    }
    if (![0x1, 0x8, 0x9, 0xa].includes(opcode)) {
      return createProtocolFailure("The client WebSocket frame opcode is unsupported.")
    }
    if (payloadLength === 126) {
      if (input.length - offset < 4) {
        break
      }
      payloadLength = input.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (payloadLength === 127) {
      return createProtocolFailure("The client WebSocket frame exceeds the supported size.")
    }
    if (payloadLength > maxFrameBytes || (opcode >= 0x8 && payloadLength > 125)) {
      return createProtocolFailure("The client WebSocket frame exceeds the supported size.")
    }
    const frameLength = headerLength + 4 + payloadLength
    if (input.length - offset < frameLength) {
      break
    }

    const maskOffset = offset + headerLength
    const payloadOffset = maskOffset + 4
    const mask = input.subarray(maskOffset, payloadOffset)
    const payload = Buffer.alloc(payloadLength)
    for (let index = 0; index < payloadLength; index += 1) {
      payload[index] = input[payloadOffset + index] ^ mask[index % 4]
    }
    frames.push({ opcode, payload })
    offset += frameLength
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
