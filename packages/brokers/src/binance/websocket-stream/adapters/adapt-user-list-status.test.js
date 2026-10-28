import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptUser } from "./user.js"

describe("adaptUser.listStatus", () => {
  it("maps list metadata and nested orders", () => {
    assert.deepEqual(adaptUser.listStatus({
      E: 1, s: "BTCUSDT", g: 22, c: "OCO", l: "EXEC_STARTED",
      L: "EXECUTING", r: "NONE", C: "client-list", T: 2,
      O: [{ s: "BTCUSDT", i: 11, c: "client-buy" }, { s: "BTCUSDT", i: 12, c: "client-sell" }],
    }), {
      eventType: "listStatus", eventTime: 1, symbol: "BTCUSDT", orderListId: 22,
      contingencyType: "OCO", listStatusType: "EXEC_STARTED", listOrderStatus: "EXECUTING",
      listRejectReason: "NONE", listClientOrderId: "client-list", transactionTime: 2,
      orders: [
        { symbol: "BTCUSDT", orderId: 11, clientOrderId: "client-buy" },
        { symbol: "BTCUSDT", orderId: 12, clientOrderId: "client-sell" },
      ],
    })
  })
})