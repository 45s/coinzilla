import assert from "node:assert/strict"
import test from "node:test"
import {
  createDepositRequest,
  createHistoryRequest,
  createWithdrawalHistoryRequest,
  normalizeOrderHistoryPage,
} from "./history-requests.js"

function requireSymbol({ symbol, operation }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError(`Bitunix Spot ${operation} requires a non-empty symbol`)
  }
  return symbol.trim().toUpperCase()
}

test("order-history request maps the requested page, time bounds and documented filters", () => {
  const result = createHistoryRequest({
    input: {
      symbol: "btcusdt",
      page: 2,
      limit: 50,
      startTime: Date.parse("2026-11-19T00:00:00.000Z"),
      endTime: Date.parse("2026-11-19T01:00:00.000Z"),
      status: "FILLED",
      side: "BUY",
      type: "LIMIT",
    },
    requireSymbol,
  })

  assert.deepEqual(result.body, {
    symbol: "BTCUSDT",
    page: 2,
    pageSize: 50,
    startTime: "2026-11-19T00:00:00.000Z",
    endTime: "2026-11-19T01:00:00.000Z",
    status: "2",
    side: "2",
    type: "1",
  }, "order history must preserve the exact symbol, timestamp unit and exchange filter-code mapping")
})

test("order-history request defaults to the first page without inventing optional filters", () => {
  const result = createHistoryRequest({
    input: {
      symbol: "BTCUSDT",
    },
    requireSymbol,
  })

  assert.deepEqual(result.body, {
    symbol: "BTCUSDT",
    page: 1,
  }, "an unfiltered order-history request must contain only the required symbol and default page")
})

test("order-history request rejects unsupported identity, page, time and filter inputs", () => {
  assert.throws(
    () => createHistoryRequest({
      input: {
        symbol: "BTCUSDT",
        orderId: "order-1",
      },
      requireSymbol,
    }),
    /does not support exact orderId filtering/,
    "order history must not pretend that the endpoint supports exact order-ID filtering",
  )
  assert.throws(
    () => createHistoryRequest({
      input: {
        symbol: "BTCUSDT",
        page: 0,
      },
      requireSymbol,
    }),
    /page must be a positive safe integer/,
    "order history must reject page zero before transport",
  )
  assert.throws(
    () => createHistoryRequest({
      input: {
        symbol: "BTCUSDT",
        startTime: 2,
        endTime: 1,
      },
      requireSymbol,
    }),
    /startTime must not be after endTime/,
    "order history must reject reversed time bounds",
  )
  assert.throws(
    () => createHistoryRequest({
      input: {
        symbol: "BTCUSDT",
        status: "UNKNOWN_STATUS",
      },
      requireSymbol,
    }),
    /status filter is unsupported/,
    "order history must reject undocumented status filters instead of sending guessed exchange codes",
  )
})

test("order-history response accepts a matching page and an explicitly empty result", () => {
  const rows = normalizeOrderHistoryPage({
    value: {
      total: 0,
      pageNum: "1",
      data: [],
    },
    requestedPage: 1,
  })

  assert.deepEqual(rows, [], "an explicit empty first page must normalize to an empty row list")
})

test("order-history response accepts integer-valued decimal page strings from the live API", () => {
  const rows = normalizeOrderHistoryPage({
    value: {
      total: 0,
      pageNum: " 1.0 ",
      data: [],
    },
    requestedPage: 1,
  })

  assert.deepEqual(rows, [], "an integer-valued page string must normalize without weakening page identity validation")
})

test("order-history response rejects incomplete or inconsistent page envelopes", () => {
  assert.throws(
    () => normalizeOrderHistoryPage({
      value: {
        total: 1,
        pageNum: "2",
        data: [],
      },
      requestedPage: 1,
    }),
    /does not match the requested page/,
    "a response for a different page must not be returned as the requested page",
  )
  assert.throws(
    () => normalizeOrderHistoryPage({
      value: {
        total: 1,
        pageNum: 1,
      },
      requestedPage: 1,
    }),
    /data is required when total is positive/,
    "a positive total without row data must fail closed rather than appear empty",
  )
  assert.throws(
    () => normalizeOrderHistoryPage({
      value: {
        total: 1,
        pageNum: 1,
        data: {},
      },
      requestedPage: 1,
    }),
    /response must be an array/,
    "malformed non-array order-history rows must be rejected",
  )
  assert.throws(
    () => normalizeOrderHistoryPage({
      value: {
        total: 0,
        pageNum: 1,
        data: [{}],
      },
      requestedPage: 1,
    }),
    /row count exceeds total/,
    "the returned row count must not exceed the exchange-reported total",
  )
})

test("deposit-history request preserves filters and rejects incompatible transaction hashes", () => {
  const result = createDepositRequest({
    input: {
      id: "deposit-1",
      coin: "USDT",
      transactionHash: "0xabc",
      type: "deposit",
      startTime: 1000,
      endTime: 2000,
      limit: 25,
    },
  })

  assert.deepEqual(result.body, {
    id: "deposit-1",
    coin: "USDT",
    transactionHash: "0xabc",
    type: "deposit",
    startTime: 1000,
    endTime: 2000,
    limit: 25,
  }, "deposit history must preserve documented filters and millisecond time bounds")
  assert.throws(
    () => createDepositRequest({
      input: {
        transactionHash: "0xabc",
        type: "inside_transfer_in",
      },
    }),
    /transactionHash filter requires type=deposit/,
    "transaction hashes must not be applied to internal-transfer history",
  )
})

test("withdrawal-history request preserves filters and rejects incompatible transaction hashes", () => {
  const result = createWithdrawalHistoryRequest({
    input: {
      id: "withdrawal-1",
      outBizId: "client-ref-1",
      coin: "USDT",
      transactionHash: "0xdef",
      remark: "manual",
      type: "withdraw",
      startTime: 1000,
      endTime: 2000,
      limit: 25,
    },
  })

  assert.deepEqual(result.body, {
    id: "withdrawal-1",
    outBizId: "client-ref-1",
    coin: "USDT",
    transactionHash: "0xdef",
    remark: "manual",
    type: "withdraw",
    startTime: 1000,
    endTime: 2000,
    limit: 25,
  }, "withdrawal history must preserve the documented filters and time bounds")
  assert.throws(
    () => createWithdrawalHistoryRequest({
      input: {
        transactionHash: "0xdef",
        type: "inside_transfer_out",
      },
    }),
    /transactionHash filter requires type=withdraw/,
    "transaction hashes must not be applied to internal-transfer-out history",
  )
})
