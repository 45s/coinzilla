import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { send } from "./send.js"

describe("Binance send", () => {
  it("parses JSON responses and supplies default headers", async () => {
    const originalFetch = globalThis.fetch
    let request

    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return {
        headers: { get: () => "application/json; charset=utf-8" },
        json: async () => ({ success: true }),
        text: async () => "unused",
      }
    }

    try {
      const result = await send({ url: "https://example.test/api", path: "order" })

      assert.deepEqual(result, { success: true })
      assert.equal(request.url, "https://example.test/api/order")
      assert.equal(request.options.method, "GET")
      assert.equal(request.options.headers["Content-Type"], "application/json")
      assert.equal(request.options.headers["X-MBX-APIKEY"], undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("uses the requested method, merges custom headers, and returns text for non-JSON responses", async () => {
    const originalFetch = globalThis.fetch
    let request

    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return {
        headers: { get: () => "text/plain" },
        json: async () => {
          throw new Error("JSON parser should not be called")
        },
        text: async () => "accepted",
      }
    }

    try {
      const result = await send({
        url: "https://example.test/api",
        path: "cancel",
        method: "DELETE",
        headers: { "X-Custom": "value", "Content-Type": "application/custom" },
      })

      assert.equal(result, "accepted")
      assert.equal(request.url, "https://example.test/api/cancel")
      assert.equal(request.options.method, "DELETE")
      assert.equal(request.options.headers["X-Custom"], "value")
      assert.equal(request.options.headers["Content-Type"], "application/custom")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("returns text when the response has no content type", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = async () => ({
      headers: { get: () => null },
      json: async () => {
        throw new Error("JSON parser should not be called")
      },
      text: async () => "plain response",
    })

    try {
      assert.equal(
        await send({ url: "https://example.test/api", path: "status" }),
        "plain response",
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
