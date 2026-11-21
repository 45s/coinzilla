import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { persistOneShotMarkerOutcome } from "../operator/place-order.js"
import {
  formatOrderMutationResult,
  formatOrderPreflightSummary,
} from "./format-order-attempt.js"

test("preflight formatter displays the fixed order and uncertainty caveats", () => {
  const value = formatOrderPreflightSummary({
    preflight: {
      order: {
        side: "BUY",
        type: "LIMIT",
        symbol: "HYPEUSDT",
        price: "30",
        quantity: "0.4",
        notional: "12",
      },
      minimumQuantity: "0.001",
      minimumNotional: "10",
      provisionalNotionalFloor: "11",
      freeQuoteBalance: "1",
      lockedQuoteBalance: "0",
      openOrderCount: 0,
    },
  })
  assert.match(value, /BUY LIMIT HYPEUSDT/, "the exact order intent must be displayed")
  assert.match(value, /does NOT guarantee an insufficient-balance rejection/, "low balance must not be represented as a guaranteed rejection")
  assert.match(value, /could fill immediately/, "immediate-fill risk must be displayed")
})

test("mutation formatter makes unknown outcomes explicit and forbids retry", () => {
  const value = formatOrderMutationResult({
    result: {
      ok: false,
      mutationOutcome: "OUTCOME_UNKNOWN",
      data: {
        id: "order-123",
      },
    },
  })
  assert.match(value, /order-123/, "returned exchange order ID should be displayed")
  assert.match(value, /OUTCOME_UNKNOWN/, "mutation outcome should be explicit")
  assert.match(value, /Do not retry/, "unknown outcome must require manual reconciliation")
})

test("mutation formatter preserves Bitunix rejection metadata for operator diagnosis", () => {
  const value = formatOrderMutationResult({
    result: {
      ok: false,
      mutationOutcome: "REJECTED",
      errors: [Object.assign(new Error("insufficient balance"), {
        code: "BROKER_REQUEST_FAILED",
        exchangeCode: "INSUFFICIENT_BALANCE",
        status: 400,
        kind: "exchange",
      })],
    },
  })
  assert.match(value, /Bitunix exchange code: INSUFFICIENT_BALANCE/)
  assert.match(value, /HTTP status: 400/)
  assert.match(value, /Broker message: insufficient balance/)
})

test("one-shot marker persists sanitized terminal outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-marker-"))
  const markerPath = join(directory, "attempt.json")
  try {
    await writeFile(markerPath, JSON.stringify({ status: "DISPATCH_STARTED" }))
    await persistOneShotMarkerOutcome({
      markerPath,
      outcome: "REJECTED",
      error: Object.assign(new Error("must not be persisted"), {
        code: "BROKER_REQUEST_FAILED",
        exchangeCode: "INSUFFICIENT_BALANCE",
        status: 400,
        kind: "exchange",
      }),
      now: () => Date.parse("2026-11-21T01:00:00.000Z"),
    })
    const marker = JSON.parse(await readFile(markerPath, "utf8"))
    assert.equal(marker.status, "REJECTED")
    assert.deepEqual(marker.result, {
      brokerCode: "BROKER_REQUEST_FAILED",
      exchangeCode: "INSUFFICIENT_BALANCE",
      httpStatus: "400",
      errorKind: "exchange",
    })
    assert.equal(JSON.stringify(marker).includes("must not be persisted"), false)
    await assert.rejects(
      persistOneShotMarkerOutcome({ markerPath, outcome: "CONFIRMED" }),
      /not awaiting an outcome/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("unknown one-shot marker outcomes are normalized fail-closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-marker-"))
  const markerPath = join(directory, "attempt.json")
  try {
    await writeFile(markerPath, JSON.stringify({ status: "DISPATCH_STARTED" }))
    await persistOneShotMarkerOutcome({ markerPath, outcome: "unexpected" })
    assert.equal(JSON.parse(await readFile(markerPath, "utf8")).status, "OUTCOME_UNKNOWN")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
