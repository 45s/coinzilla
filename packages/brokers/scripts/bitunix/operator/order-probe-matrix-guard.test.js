import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { assertBitunixOrderProbeMatrixCanContinue } from "./order-probe-matrix-guard.js"

test("Bitunix probe matrix allows the first probe and another probe only after REJECTED", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-probe-matrix-"))
  try {
    await assertBitunixOrderProbeMatrixCanContinue({
      diagnosticsDirectory: directory,
      probeId: "limit-buy-1",
    })
    await writeFile(join(directory, "bitunix-order-probe-limit-buy-1.json"), JSON.stringify({
      status: "REJECTED",
    }))
    await assertBitunixOrderProbeMatrixCanContinue({
      diagnosticsDirectory: directory,
      probeId: "limit-buy-2",
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix probe matrix blocks reuse of a probe ID even after REJECTED", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-probe-matrix-reuse-"))
  try {
    await writeFile(join(directory, "bitunix-order-probe-limit-buy-1.json"), JSON.stringify({
      status: "REJECTED",
    }))
    await assert.rejects(
      assertBitunixOrderProbeMatrixCanContinue({
        diagnosticsDirectory: directory,
        probeId: "limit-buy-1",
      }),
      /already has a one-shot marker/i,
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix probe matrix blocks after DISPATCH_STARTED, CONFIRMED, OUTCOME_UNKNOWN or NOT_SENT", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-probe-matrix-block-"))
  try {
    for (const status of ["DISPATCH_STARTED", "CONFIRMED", "OUTCOME_UNKNOWN", "NOT_SENT"]) {
      const markerPath = join(directory, `bitunix-order-probe-${status}.json`)
      await writeFile(markerPath, JSON.stringify({ status }))
      await assert.rejects(
        assertBitunixOrderProbeMatrixCanContinue({
          diagnosticsDirectory: directory,
          probeId: "limit-buy-2",
        }),
        new RegExp(status),
      )
      await rm(markerPath)
    }
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix probe matrix blocks on malformed or unknown prior marker state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-probe-matrix-invalid-"))
  try {
    await writeFile(join(directory, "bitunix-order-probe-limit-buy-1.json"), "{")
    await assert.rejects(
      assertBitunixOrderProbeMatrixCanContinue({
        diagnosticsDirectory: directory,
        probeId: "limit-buy-2",
      }),
      /cannot verify prior marker/i,
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix probe matrix ignores unrelated diagnostics artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-probe-matrix-unrelated-"))
  try {
    await writeFile(join(directory, "bitunix-health-report.json"), JSON.stringify({
      status: "OUTCOME_UNKNOWN",
    }))
    await assertBitunixOrderProbeMatrixCanContinue({
      diagnosticsDirectory: directory,
      probeId: "limit-buy-1",
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
