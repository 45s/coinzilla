import assert from "node:assert/strict"
import test from "node:test"
import { PassThrough } from "node:stream"
import { createHarvesterConsoleTransport } from "./configure-harvester-logging.js"

function assertDistinctOrderHistoryFailureLines(lines, written) {
  assert.equal(lines.length, 3, "Changing only the validation field or only the client-order identity must produce a distinct console line.")
  assert.match(lines[0], /providerInstanceId/, "The first compact diagnostic must expose its safe invalid field.")
  assert.match(lines[0], /h-dff68008c72c47a59368ad-2/, "The first compact diagnostic must identify its affected order.")
  assert.match(lines[1], /market\\.baseAsset\\.code/, "The second compact diagnostic must expose its distinct invalid field.")
  assert.match(lines[1], /h-dff68008c72c47a59368ad-2/, "A field change alone must remain visible for the same order.")
  assert.match(lines[2], /market\\.baseAsset\\.code/, "The third compact diagnostic must retain its validation field.")
  assert.match(lines[2], /h-dff68008c72c47a59368ad-4/, "An order-identity change alone must remain visible for the same field.")
  assert.ok(lines.every((line) => line.includes("HARVESTER_ORDER_HISTORY_RECORD_INVALID")), "Each line must retain the stable error code.")
  assert.doesNotMatch(written, /Previous identical log entry repeated/, "Different validation failures must not be collapsed as identical.")
  assert.doesNotMatch(written, /accountId|providerInstanceId":|eventId/, "The summary must not expose unrelated account/provider/event payload fields.")
  assert.ok(lines.every((line) => line.length <= 200), "Each actionable validation diagnostic must remain within the console line limit.")
}

test("shows validation fields and order identity without collapsing distinct order-history failures", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => {
    written += chunk.toString()
  })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const diagnostic = {
    message: "Order history projection failed",
    component: "order-history-observer",
    operation: "mapping",
    persistenceStage: "mapping",
    errorName: "OrderHistoryValidationError",
    errorCode: "HARVESTER_ORDER_HISTORY_RECORD_INVALID",
    symbol: "ZROUSDT",
  }
  const failures = [
    {
      field: "providerInstanceId",
      clientOrderId: "h-dff68008c72c47a59368ad-2",
    },
    {
      field: "market.baseAsset.code",
      clientOrderId: "h-dff68008c72c47a59368ad-2",
    },
    {
      field: "market.baseAsset.code",
      clientOrderId: "h-dff68008c72c47a59368ad-4",
    },
  ]
  const timestamps = [
    "2026-11-22T08:52:26.000Z",
    "2026-11-22T08:52:27.000Z",
    "2026-11-22T08:52:28.000Z",
  ]

  for (const [index, failure] of failures.entries()) {
    transport.write({
      timestamp: timestamps[index],
      level: "error",
      data: {
        ...diagnostic,
        ...failure,
      },
    })
  }

  const lines = written.trim().split("\n")
  assertDistinctOrderHistoryFailureLines(lines, written)
  output.destroy()
})

test("still suppresses identical order-history failures with the same field and order identity", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => {
    written += chunk.toString()
  })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const entry = {
    level: "error",
    data: {
      message: "Order history projection failed",
      errorCode: "HARVESTER_ORDER_HISTORY_RECORD_INVALID",
      field: "market.baseAsset.code",
      symbol: "ZROUSDT",
      clientOrderId: "h-dff68008c72c47a59368ad-2",
    },
  }

  transport.write({
    ...entry,
    timestamp: "2026-11-22T08:52:26.000Z",
  })
  transport.write({
    ...entry,
    timestamp: "2026-11-22T08:52:27.000Z",
  })
  transport.close()

  assert.equal((written.match(/Order history projection failed/g) ?? []).length, 1, "Exact duplicate validation failures should remain compacted.")
  assert.match(written, /market\.baseAsset\.code/, "The retained summary must include the validation field.")
  assert.match(written, /h-dff68008c72c47a59368ad-2/, "The retained summary must include the affected order.")
  assert.match(written, /Previous identical log entry repeated 1 additional time\(s\)/, "The duplicate count must remain visible.")
  output.destroy()
})


test("bounds long order-history validation fields and client-order identifiers", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => {
    written += chunk.toString()
  })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  transport.write({
    timestamp: "2026-11-22T08:52:30.000Z",
    level: "error",
    data: {
      message: "Order history projection failed",
      errorCode: "HARVESTER_ORDER_HISTORY_RECORD_INVALID",
      field: "market.".concat("x".repeat(100)),
      symbol: "ZROUSDT",
      clientOrderId: "h-".concat("x".repeat(100)),
    },
  })

  const line = written.trim()
  assert.match(line, /market\.\w{54}\.\.\./, "Long validation fields must be visibly truncated.")
  assert.match(line, /clientOrderId/, "The summary must retain the client-order identity field.")
  assert.ok(line.length <= 200, "Long diagnostic values must not exceed the terminal line limit.")
  output.destroy()
})
