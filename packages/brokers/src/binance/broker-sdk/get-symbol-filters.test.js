import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

const originalFetch = globalThis.fetch
const originalConsoleError = console.error
afterEach(() => {
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

function createBroker() {
  return new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
}

describe("BinanceSdkBroker.getSymbolFilters", () => {
  it("extracts positive tick and step sizes", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /exchangeInfo\?symbol=BTCUSDT/)
      return {
        ok: true,
        json: async () => ({
          symbols: [{
            symbol: "BTCUSDT",
            filters: [
              { filterType: "PRICE_FILTER", tickSize: "0.10" },
              { filterType: "LOT_SIZE", stepSize: "0.001" },
            ],
          }],
        }),
      }
    }

    const result = await createBroker().getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, {
      symbol: "BTCUSDT",
      tickSize: 0.1,
      stepSize: 0.001,
    })
  })

  it("URL-encodes symbols before requesting exchangeInfo", async () => {
    let requestedUrl
    globalThis.fetch = async (url) => {
      requestedUrl = String(url)
      return { ok: true, json: async () => ({ symbols: [] }) }
    }

    const result = await createBroker().getSymbolFilters({ symbol: "BAD/SYMBOL" })
    assert.match(requestedUrl, /symbol=BAD%2FSYMBOL/)
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /tickSize missing/)
  })

  it("returns an error result for HTTP failures", async () => {
    console.error = () => {}
    globalThis.fetch = async () => ({ ok: false, status: 503 })

    const result = await createBroker().getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /HTTP 503/)
  })

  it("rejects missing or non-positive filter sizes", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        symbols: [{
          symbol: "BTCUSDT",
          filters: [
            { filterType: "PRICE_FILTER", tickSize: "0" },
            { filterType: "LOT_SIZE", stepSize: "0.001" },
          ],
        }],
      }),
    })

    const result = await createBroker().getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /tickSize missing/)
  })
})
