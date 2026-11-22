import assert from "node:assert/strict"
import test from "node:test"
import { BrokerUnsupportedOperationError } from "../../../../broker/errors/broker-unsupported-operation-error.js"
import { BitunixRestError } from "../api/rest-client.js"
import {
  BITUNIX_SPOT_ORDER_API,
  createSpotCancelRequest,
  createSpotOrderDetailRequest,
  createSpotOrderRequest,
  validateOrderDetailResponse,
  validateOrderId,
  validateSpotOrderPlacementResponse,
} from "./order-requests.js"

test("Bitunix order adapter preserves LIMIT base quantity as REST volume", () => {
  const order = createSpotOrderRequest({
    input: {
      symbol: "btcusdt",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.0100",
      price: "25000.50",
    },
  })

  assert.deepEqual(order, {
    symbol: "BTCUSDT",
    quantity: "0.0100",
    price: "25000.50",
    volume: "0.0100",
    body: {
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
      volume: "0.0100",
      price: "25000.50",
    },
  })
})

test("Bitunix order adapter uses exact quoteQuantity for MARKET volume", () => {
  const order = createSpotOrderRequest({
    input: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quoteQuantity: 1e-8,
    },
  })

  assert.deepEqual(order, {
    symbol: "BTCUSDT",
    quoteQuantity: "0.00000001",
    price: "0",
    volume: "0.00000001",
    body: {
      symbol: "BTCUSDT",
      side: 2,
      type: 2,
      volume: "0.00000001",
      price: "0",
    },
  })
})

test("Bitunix order adapter rejects ambiguous MARKET quantity and quoteQuantity on LIMIT", () => {
  assert.throws(
    () => createSpotOrderRequest({
      input: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: "0.01",
      },
    }),
    /require[s]? quoteQuantity/i,
  )
  assert.throws(
    () => createSpotOrderRequest({
      input: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        quoteQuantity: "100",
        price: "100",
      },
    }),
    /does not accept quoteQuantity for LIMIT/i,
  )
})

test("Bitunix order adapter rejects unsupported fields and caller-supplied client identities", () => {
  assert.throws(
    () => createSpotOrderRequest({
      input: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        price: "1",
        timeInForce: "GTC",
      },
    }),
    /does not support fields: timeInForce/i,
  )
  assert.throws(
    () => createSpotOrderRequest({
      input: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        price: "1",
        clientOrderId: "local-id",
      },
    }),
    (error) => error instanceof BrokerUnsupportedOperationError,
  )
})

test("Bitunix order adapter rejects invalid decimal inputs and order identities", () => {
  for (const quantity of ["0", "-1", "not-a-number", Number.NaN]) {
    assert.throws(() => createSpotOrderRequest({
      input: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity,
        price: "1",
      },
    }))
  }
  for (const orderId of ["", "  ", 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => validateOrderId({ orderId }))
  }
})

test("Bitunix order adapter correlates placement acknowledgement with requested facts", () => {
  const response = validateSpotOrderPlacementResponse({
    response: {
      placeStatus: "1",
      symbol: "BTCUSDT",
      side: "2",
      type: "1",
      orderId: "12345678901234567890",
    },
    symbol: "BTCUSDT",
    side: 2,
    type: 1,
  })

  assert.equal(response.orderId, "12345678901234567890")
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "1",
        symbol: "ETHUSDT",
        side: "2",
        type: "1",
        orderId: "123",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
    }),
    /symbol does not match/i,
  )
})

test("Bitunix order adapter preserves synthetic matching-engine rejection metadata", () => {
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "0",
        placeCode: 987654321,
        placeMsg: "synthetic insufficient-balance rejection",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError)
      assert.equal(error.kind, "exchange")
      assert.equal(error.exchangeCode, "987654321")
      assert.equal(error.message, "synthetic insufficient-balance rejection")
      assert.equal(error.path, BITUNIX_SPOT_ORDER_API.placeOrder)
      return true
    },
  )
})

test("Bitunix order adapter keeps non-zero placeCode ambiguous when placeStatus reports success", () => {
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "1",
        placeCode: "opaque-engine-rejection",
        placeMsg: "synthetic matching-engine rejection",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        orderId: "123",
        volume: "1",
        price: "100",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "100",
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError, "a contradictory placement acknowledgement must use the structured Bitunix REST error")
      assert.equal(error.kind, "response", "conflicting placement metadata must remain an ambiguous response")
      assert.equal(error.outcomeUnknown, true, "a contradictory acknowledgement must never be classified as a definitive rejection")
      assert.equal(error.exchangeCode, "opaque-engine-rejection", "the original matching-engine code must be preserved")
      assert.match(error.message, /synthetic matching-engine rejection/, "the matching-engine message must be preserved")
      return true
    },
  )
})

test("Bitunix order adapter accepts missing, null, and zero placeCode when placeStatus confirms success", () => {
  for (const placeCode of [undefined, null, 0, "0"]) {
    const response = validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "1",
        placeCode,
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        orderId: "123",
        volume: "1",
        price: "100",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "100",
    })

    assert.equal(response.orderId, "123", "a missing, null, or zero matching-engine code must not override successful placeStatus")
  }
})

test("Bitunix order adapter preserves numeric placeCode values when acknowledgement fields conflict", () => {
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "1",
        placeCode: 987654321,
        placeMsg: "synthetic matching-engine rejection",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        orderId: "123",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
    }),
    (error) => error instanceof BitunixRestError &&
      error.kind === "response" &&
      error.outcomeUnknown === true &&
      error.exchangeCode === "987654321",
    "a numeric non-zero placeCode must remain exact diagnostic metadata on an ambiguous acknowledgement",
  )
})

test("Bitunix order adapter rejects malformed placeCode values as unknown responses", () => {
  for (const placeCode of ["", "   ", true, {}, []]) {
    assert.throws(
      () => validateSpotOrderPlacementResponse({
        response: {
          placeStatus: "1",
          placeCode,
          symbol: "BTCUSDT",
          side: 2,
          type: 1,
          orderId: "123",
        },
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
      }),
      (error) => error instanceof BitunixRestError &&
        error.kind === "response" &&
        error.outcomeUnknown === true,
      `malformed placeCode ${JSON.stringify(placeCode)} must not be accepted as a successful placement`,
    )
  }
})

test("Bitunix order adapter treats an invalid placement status as unknown", () => {
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        placeStatus: "pending",
      },
      symbol: "BTCUSDT",
      side: 2,
      type: 1,
    }),
    (error) => error instanceof BitunixRestError &&
      error.kind === "response" &&
      error.outcomeUnknown === true,
  )
})

test("Bitunix order adapter validates order-detail identity before normalization", () => {
  const response = {
    data: {
      orderId: "123",
      symbol: "BTCUSDT",
      status: "1",
    },
  }

  assert.equal(
    validateOrderDetailResponse({
      response,
      orderId: "123",
      symbol: "BTCUSDT",
    }),
    response.data,
  )
  assert.throws(
    () => validateOrderDetailResponse({
      response,
      orderId: "456",
      symbol: "BTCUSDT",
    }),
    /does not match/i,
  )
  assert.throws(
    () => validateOrderDetailResponse({
      response,
      orderId: "123",
      symbol: "ETHUSDT",
    }),
    /does not match/i,
  )
})

test("Bitunix order adapter centralizes detail and cancel request contracts", () => {
  assert.equal(
    BITUNIX_SPOT_ORDER_API.placeOrder,
    "/api/spot/v1/order/place_order",
  )
  assert.deepEqual(
    createSpotOrderDetailRequest({
      orderId: "123",
    }),
    {
      method: "GET",
      path: "/api/spot/v1/order/detail",
      queryParams: {
        orderId: "123",
      },
      authenticated: true,
      stateChanging: false,
    },
  )
  assert.deepEqual(
    createSpotCancelRequest({
      symbol: "BTCUSDT",
      orderId: "123",
    }),
    {
      method: "POST",
      path: "/api/spot/v1/order/cancel",
      body: {
        orderIdList: [{
          orderId: "123",
          symbol: "BTCUSDT",
        }],
      },
      authenticated: true,
      stateChanging: true,
    },
  )
})


test("Bitunix order adapter rejects placement acknowledgements with mismatched volume or price", () => {
  const validResponse = {
    placeStatus: "1",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    orderId: "123",
    volume: "1",
    price: "100",
  }
  const expected = {
    symbol: "BTCUSDT",
    side: 2,
    type: 1,
    volume: "1",
    price: "100",
  }

  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        ...validResponse,
        volume: "0.9",
      },
      ...expected,
    }),
    /volume does not match/i,
  )
  assert.throws(
    () => validateSpotOrderPlacementResponse({
      response: {
        ...validResponse,
        price: "101",
      },
      ...expected,
    }),
    /price does not match/i,
  )
})
