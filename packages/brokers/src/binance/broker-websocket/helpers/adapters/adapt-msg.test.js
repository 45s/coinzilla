import test from "node:test"
import assert from "node:assert/strict"
import { adaptMsg } from "./adapt-msg.js"

test("preserves both Binance execution-report client order identifiers", () => {
  const event = adaptMsg({
    e: "executionReport",
    E: 1730000000000,
    s: "ZROUSDT",
    c: "CU5G5c9IZgepakVzo3Z3kw",
    C: "h-ZROUSDT-1",
    S: "BUY",
    o: "LIMIT",
    f: "GTC",
    q: "5",
    p: "1.885",
    x: "CANCELED",
    X: "CANCELED",
    i: 666845,
    T: 1730000000000,
    l: "0",
    z: "0",
    L: "0",
    n: "0",
    N: null,
    t: -1,
    m: false,
    O: 1730000000000,
    Z: "0",
    Y: "0",
  })

  assert.equal(event.eventType, "executionReport")
  assert.equal(event.executionType, "CANCELED")
  assert.equal(event.clientOrderId, "CU5G5c9IZgepakVzo3Z3kw")
  assert.equal(event.originalClientOrderId, "h-ZROUSDT-1")
  assert.equal(event.executedOrder.id, "666845")
  assert.equal(event.executedOrder.clientOrderId, "CU5G5c9IZgepakVzo3Z3kw")
})


test("uses Binance transaction time rather than event publication time for fills", () => {
  const transactionTime = 1_793_829_102_377
  const eventPublicationTime = transactionTime + 1
  const event = adaptMsg({
    e: "executionReport",
    E: eventPublicationTime,
    s: "ZROUSDT",
    c: "h-harvester-1",
    C: "",
    S: "BUY",
    o: "LIMIT",
    f: "GTC",
    q: "5",
    p: "1.82",
    x: "TRADE",
    X: "FILLED",
    i: 699693,
    T: transactionTime,
    l: "5",
    z: "5",
    L: "1.816",
    n: "0.005",
    N: "ZRO",
    t: 10259,
    m: false,
    O: transactionTime - 10,
    Z: "9.08",
    Y: "9.08",
  })

  assert.equal(event.fill.time, transactionTime)
  assert.notEqual(event.fill.time, eventPublicationTime)
})
