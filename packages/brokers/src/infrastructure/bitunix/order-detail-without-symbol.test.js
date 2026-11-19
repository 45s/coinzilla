import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

test("Bitunix Spot order detail can be retrieved by broker order ID without a symbol", async () => {
  const calls = []
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => ({
        async request(input) {
          calls.push(input)
          return {
            data: {
              orderId: "spot-order-123",
              symbol: "BTCUSDT",
              side: "2",
              type: "1",
              status: "2",
              volume: "0.5",
              dealVolume: "0.5",
              price: "60000",
              ctime: "2026-11-18T12:00:00Z",
              utime: "2026-11-18T12:00:01Z",
            },
          }
        },
      }),
    },
  })

  const result = await broker.getOrder({
    orderId: "spot-order-123",
  })

  assert.equal(result.ok, true, "Bitunix order detail lookup must succeed when the exchange order ID is the only required identifier")
  assert.equal(result.data.id, "spot-order-123", "the normalized order must preserve the exact broker order ID returned by Bitunix")
  assert.equal(result.data.symbol, "BTCUSDT", "the normalized order must use the symbol returned by the authoritative order-detail response")
  assert.deepEqual(calls, [{
    method: "GET",
    path: "/api/spot/v1/order/detail",
    queryParams: {
      orderId: "spot-order-123",
    },
  }], "Bitunix order detail lookup must send only the documented orderId query parameter when symbol is omitted")
})
