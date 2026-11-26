/**
 * Encode a plain JavaScript document using the BSON wire representation.
 *
 * This module intentionally implements only the BSON surface required by
 * the provider-neutral database contract and MongoDB command protocol.
 *
 * @param {{document: object}} options
 * @returns {Buffer}
 */
export function encodeBsonDocument({ document }) {
  void document
  throw new Error("BSON document encoding is not implemented")
}

/**
 * Decode one BSON document from a buffer.
 *
 * @param {{buffer: Buffer, offset?: number}} options
 * @returns {{document: object, bytesRead: number}}
 */
export function decodeBsonDocument({ buffer, offset = 0 }) {
  void buffer
  void offset
  throw new Error("BSON document decoding is not implemented")
}
