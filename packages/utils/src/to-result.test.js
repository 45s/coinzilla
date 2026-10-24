import test from "node:test"
import assert from "node:assert/strict"

import { toResult } from "./to-result.js"

test("returns default result for empty input", () => {
  assert.deepEqual(toResult(), {
    ok: true,
  })
})

test("preserves provided data", () => {
  const data = { id: 1, name: "John" }

  assert.deepEqual(toResult({ data }), {
    ok: true,
    data,
  })
})

test("preserves null data", () => {
  assert.deepEqual(toResult({ data: null }), {
    ok: true,
    data: null,
  })
})

test("preserves falsy data values", () => {
  for (const data of [false, 0, "", [], {}]) {
    assert.deepEqual(toResult({ data }), {
      ok: true,
      data,
    })
  }
})

test("sets ok to false when error is provided", () => {
  const error = {
    code: "NOT_FOUND",
    message: "Not found",
  }

  assert.deepEqual(toResult({ error }), {
    ok: false,
    error,
  })
})

test("omits error when undefined", () => {
  assert.deepEqual(toResult({ error: undefined }), {
    ok: true,
  })
})

test("omits error when null", () => {
  assert.deepEqual(toResult({ error: null }), {
    ok: true,
  })
})

test("preserves additional properties", () => {
  assert.deepEqual(
    toResult({
      data: { id: 1 },
      status: "canceled",
      meta: { retryable: false },
    }),
    {
      data: { id: 1 },
      status: "canceled",
      meta: { retryable: false },
      ok: true,
    },
  )
})

test("calculates ok instead of trusting input ok", () => {
  assert.deepEqual(toResult({ ok: false, data: 123 }), {
    ok: true,
    data: 123,
  })

  assert.deepEqual(toResult({ ok: true, error: "Oops" }), {
    ok: false,
    error: "Oops",
  })
})

test("does not mutate the input", () => {
  const input = {
    data: { id: 1 },
    error: null,
    status: "ok",
  }

  const original = structuredClone(input)

  toResult(input)

  assert.deepEqual(input, original)
})

test("defaults undefined data to null", () => {
  assert.deepEqual(toResult({ data: undefined }), {
    ok: true,
    data: undefined,
  })
})
