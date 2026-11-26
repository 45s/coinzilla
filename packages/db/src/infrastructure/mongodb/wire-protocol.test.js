import assert from "node:assert/strict"
import test from "node:test"

import { decodeOpMsg, encodeOpMsg } from "./wire-protocol.js"

test("OP_MSG encodes a BSON body with the exact MongoDB message header", () => {
  const message = encodeOpMsg({
    requestId: 17,
    body: { ping: 1, $db: "admin" },
  })

  assert.equal(message.readInt32LE(0), message.length)
  assert.equal(message.readInt32LE(4), 17)
  assert.equal(message.readInt32LE(8), 0)
  assert.equal(message.readInt32LE(12), 2013)

  const decoded = decodeOpMsg(message)
  assert.equal(decoded.requestId, 17)
  assert.equal(decoded.responseTo, 0)
  assert.deepEqual(decoded.body, { ping: 1, $db: "admin" })
})

test("OP_MSG preserves response correlation, flags, and document sequences", () => {
  const message = encodeOpMsg({
    requestId: 22,
    responseTo: 17,
    flags: 2,
    body: { insert: "records", $db: "app" },
    sequences: [{
      identifier: "documents",
      documents: [{ _id: "one" }, { _id: "two" }],
    }],
  })

  const decoded = decodeOpMsg(message)

  assert.equal(decoded.responseTo, 17)
  assert.equal(decoded.flags, 2)
  assert.deepEqual(decoded.sequences, {
    documents: [{ _id: "one" }, { _id: "two" }],
  })
})

test("OP_MSG rejects truncated, oversized, and unsupported messages", () => {
  const message = encodeOpMsg({
    requestId: 1,
    body: { ping: 1 },
  })

  assert.throws(
    () => decodeOpMsg(message.subarray(0, 10)),
    TypeError,
  )

  const badLength = Buffer.from(message)
  badLength.writeInt32LE(message.length + 1, 0)
  assert.throws(() => decodeOpMsg(badLength), TypeError)

  const badOpcode = Buffer.from(message)
  badOpcode.writeInt32LE(1, 12)
  assert.throws(() => decodeOpMsg(badOpcode), TypeError)
})
