import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { send } from "./send.js"

describe("Binance send", () => {
  it("parses JSON responses and supplies default headers", async (t) => {
    let request

    t.mock.method(globalThis, "fetch", async (url, options) => {
      request = { url, options }
      return {
        headers: { get: () => "application/json; charset=utf-8" },
        json: async () => ({ success: true }),
        text: async () => "unused",
      }
    })

    const result = await send({ url: "https://example.test/api", path: "order" })

    assert.deepEqual(result, { success: true })
    assert.equal(request.url, "https://example.test/api/order")
    assert.equal(request.options.method, "GET")
    assert.equal(request.options.headers["Content-Type"], "application/json")
    assert.equal(request.options.headers["X-MBX-APIKEY"], undefined)
  })

  it("uses the requested method, merges custom headers, and returns text for non-JSON responses", async (t) => {
    let request

    t.mock.method(globalThis, "fetch", async (url, options) => {
      request = { url, options }
      return {
        headers: { get: () => "text/plain" },
        json: async () => {
          throw new Error("JSON parser should not be called")
        },
        text: async () => "accepted",
      }
    })

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
  })

  it("returns text when the response has no content type", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => null },
      json: async () => {
        throw new Error("JSON parser should not be called")
      },
      text: async () => "plain response",
    }))

    assert.equal(
      await send({ url: "https://example.test/api", path: "status" }),
      "plain response",
    )
  })

  it("propagates network errors from fetch", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("network unavailable")
    })

    await assert.rejects(
      () => send({ url: "https://example.test/api", path: "order" }),
      { message: "network unavailable" },
    )
  })
  it("parses JSON when the media type uses uppercase letters", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "Application/JSON; charset=utf-8" },
      json: async () => ({ success: true }),
      text: async () => "unused",
    }))

    assert.deepEqual(
      await send({ url: "https://example.test/api", path: "status" }),
      { success: true },
    )
  })

})
