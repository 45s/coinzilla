import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery-with-deferrals.js"

const provider = {
  providerInstanceId: "binanceTestnet",
  providerType: "binance",
  accountId: "binance-primary",
}
const record = ({ name, data }) => ({
  id: name,
  payload: {
    id: name,
    name,
    data,
  },
  position: {
    fileName: "session.jsonl",
    lineNumber: 1,
  },
})
const submissionRequested = (identity = provider) => record({
  name: "order.submission_requested",
  data: {
    clientOrderId: "h-BTCUSDT-1",
    ...identity,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "1",
    status: "PENDING",
  },
})
const submitted = (identity = provider) => record({
  name: "order.submitted",
  data: {
    clientOrderId: "h-BTCUSDT-1",
    brokerOrderId: "9001",
    ...identity,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "1",
    status: "NEW",
  },
})
const fill = (identity = provider) => record({
  name: "execution.fill_applied",
  data: {
    fillId: "binance:BTCUSDT:trade-1",
    tradeId: "trade-1",
    brokerOrderId: "9001",
    clientOrderId: "h-BTCUSDT-1",
    ...identity,
    symbol: "BTCUSDT",
    side: "BUY",
    price: "100",
    quantity: "0.4",
    quoteQuantity: "40",
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "UNKNOWN",
  },
})

test("replays the original provider identity across order submission and execution fill", () => {
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), submitted(), fill()],
  })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual([
    result.data.orders[0].providerInstanceId,
    result.data.orders[0].providerType,
    result.data.orders[0].accountId,
  ], ["binanceTestnet", "binance", "binance-primary"])
  assert.deepEqual([
    result.data.fills[0].providerInstanceId,
    result.data.fills[0].providerType,
    result.data.fills[0].accountId,
  ], ["binanceTestnet", "binance", "binance-primary"])
})

test("rejects a replayed fill attributed to a different provider account", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({ ...provider, providerInstanceId: "binanceLive", accountId: "binance-live" }),
    ],
  })
  assert.equal(result.ok, false)
})
