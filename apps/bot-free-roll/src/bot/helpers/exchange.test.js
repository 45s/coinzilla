import test from "node:test"
import assert from "node:assert/strict"
import { getOrderId, unwrapResult } from "./exchange.js"

test("getOrderId normalizes supported exchange order ID fields", () => {
  assert.equal(getOrderId({ id: 123 }), "123");
  assert.equal(getOrderId({ orderId: 456 }), "456");
  assert.equal(getOrderId({ orderID: "789" }), "789");
  assert.equal(getOrderId({ id: null, orderId: 0 }), "0");
  assert.equal(getOrderId(null), null);
  assert.equal(getOrderId({}), null);
});

test("unwrapResult returns data and rejects failed or malformed results", () => {
  const data = { orderId: "123" };
  assert.equal(unwrapResult({ ok: true, data }, "create order"), data);
  assert.throws(() => unwrapResult({ ok: false, error: new Error("offline") }, "create order"), AggregateError);
  assert.throws(() => unwrapResult({ ok: true }, "create order"), /response has no data/);
  assert.throws(() => unwrapResult(null, "create order"), AggregateError);
});
