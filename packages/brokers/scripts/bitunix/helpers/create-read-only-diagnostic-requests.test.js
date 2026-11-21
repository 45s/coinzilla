import assert from "node:assert/strict"
import test from "node:test"
import {
  createReadOnlyBrokerRequest,
  createReadOnlyRestRequest,
  getReadOnlyBrokerOperations,
  getRestDiagnosticSkipReason,
  parseDiagnosticDepthPrecision,
} from "./create-read-only-diagnostic-requests.js"

test("diagnostic depth precision accepts an explicit non-negative number", () => {
  assert.equal(parseDiagnosticDepthPrecision({ value: "" }), null, "omitted precision should skip optional probes")
  assert.equal(parseDiagnosticDepthPrecision({ value: "0" }), 0, "zero precision is valid")
  assert.throws(() => parseDiagnosticDepthPrecision({ value: "-1" }), /non-negative number/, "negative precision must fail closed")
  assert.throws(() => parseDiagnosticDepthPrecision({ value: "Infinity" }), /non-negative number/, "non-finite precision must fail closed")
})

test("REST diagnostic requests remain explicitly read-only", () => {
  assert.deepEqual(createReadOnlyRestRequest({
    endpoint: {
      path: "/market",
      queryParams: null,
      privateResponse: false,
    },
    symbol: "BTCUSDT",
  }), {
    method: "GET",
    path: "/market",
    queryParams: {
      symbol: "BTCUSDT",
    },
    authenticated: false,
    stateChanging: false,
  }, "public REST probes must preserve symbol query and read-only classification")
  assert.match(getRestDiagnosticSkipReason({
    endpoint: {
      requiresDepthPrecision: true,
    },
    depthPrecision: null,
    credentialsConfigured: true,
  }).reason, /DEPTH_PRECISION/, "depth probes require explicit precision")
  assert.match(getRestDiagnosticSkipReason({
    endpoint: {
      privateResponse: true,
    },
    depthPrecision: 2,
    credentialsConfigured: false,
  }).reason, /BITUNIX_API_KEY/, "private probes require credentials")
})

test("Broker diagnostic requests and operations never enable state-changing calls", () => {
  assert.deepEqual(createReadOnlyBrokerRequest({
    method: "getBalances",
    args: [],
  }), {
    api: "Broker",
    method: "getBalances",
    params: {},
    stateChanging: false,
  }, "Broker diagnostics must remain read-only")
  assert.equal(getReadOnlyBrokerOperations({
    symbol: "BTCUSDT",
    credentialsConfigured: false,
  }).length, 3, "public-only mode should include three market operations")
  assert.equal(getReadOnlyBrokerOperations({
    symbol: "BTCUSDT",
    credentialsConfigured: true,
  }).length, 8, "authenticated mode should add five bounded private reads")
})
