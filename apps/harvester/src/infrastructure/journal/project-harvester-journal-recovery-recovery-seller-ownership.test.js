import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery-with-deferrals.js"

function journalRecord({ name, data, lineNumber }) {
  const id = name
  return {
    id,
    payload: {
      id,
      name,
      data,
    },
    position: {
      fileName: "session.jsonl",
      lineNumber,
    },
  }
}

function recoverySellerJournalRecords() {
  const ownership = {
    purpose: "RECOVERY_BUY",
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-1",
    cycleId: "rs-cycle-1",
  }
  const clientOrderId = "rs-client-1"
  const brokerOrderId = "rs-broker-1"
  const intent = {
    clientOrderId,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "1",
    ...ownership,
  }
  return [
    journalRecord({
      name: "order.submission_requested",
      data: {
        ...intent,
        status: "PENDING",
      },
      lineNumber: 1,
    }),
    journalRecord({
      name: "order.submitted",
      data: {
        ...intent,
        brokerOrderId,
        status: "NEW",
      },
      lineNumber: 2,
    }),
    journalRecord({
      name: "execution.fill_applied",
      data: {
        fillId: "binance:BTCUSDT:trade-rs-1",
        tradeId: "trade-rs-1",
        brokerOrderId,
        clientOrderId,
        symbol: "BTCUSDT",
        side: "BUY",
        price: "100",
        quantity: "0.4",
        quoteQuantity: "40",
        liquidityRole: "MAKER",
        commissions: [],
        commissionStatus: "COMPLETE",
        ...ownership,
      },
      lineNumber: 3,
    }),
  ]
}

test("retains Recovery Seller ownership in projected Journal orders and fills", () => {
  const result = projectHarvesterJournalRecovery({
    records: recoverySellerJournalRecords(),
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.orders[0].strategyId, StrategyId.RECOVERY_SELLER)
  assert.equal(result.data.orders[0].positionId, "rs-position-1")
  assert.equal(result.data.orders[0].cycleId, "rs-cycle-1")
  assert.equal(result.data.orders[0].purpose, "RECOVERY_BUY")
  assert.equal(result.data.fills[0].strategyId, StrategyId.RECOVERY_SELLER)
  assert.equal(result.data.fills[0].positionId, "rs-position-1")
  assert.equal(result.data.fills[0].cycleId, "rs-cycle-1")
  assert.equal(result.data.fills[0].purpose, "RECOVERY_BUY")
})
