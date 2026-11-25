import { BrokerUnsupportedOperationError } from "../../../../broker/errors/broker-unsupported-operation-error.js"

export function createUserDataReadinessError({ operation }) {
  return new BrokerUnsupportedOperationError({
    provider: "bitunix-futures",
    operation,
    reason: "An authenticated private user-data session with caller-acknowledged REST reconciliation is required. Bitunix provides no event sequence or replay guarantee; the acknowledgement does not make observations authoritative.",
  })
}
