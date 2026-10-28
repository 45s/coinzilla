import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SPOT_WS_API_PROD_URL, SPOT_WS_API_TESTNET_URL, SPOT_WS_STREAMS_PROD_URL, SPOT_WS_STREAMS_TESTNET_URL } from "@binance/spot"
import { isProdMode } from "@coinzilla/utils"
import { BinanceSdkConfig } from "./binance-sdk-config.js"

describe("BinanceSdkConfig URL fallback", () => {
  it("uses defaults when custom URLs are null", () => {
    const config = new BinanceSdkConfig({ apiKey: "test-key", apiSecret: "test-secret", websocketApiUrl: null, websocketStreamsUrl: null })
    assert.equal(config.websocketApiUrl, isProdMode ? SPOT_WS_API_PROD_URL : SPOT_WS_API_TESTNET_URL)
    assert.equal(config.websocketStreamsUrl, isProdMode ? SPOT_WS_STREAMS_PROD_URL : SPOT_WS_STREAMS_TESTNET_URL)
  })
})
