import { toResult } from "@coinzilla/utils"
import { createRecoverySellerStopWorkflow } from "../use-cases/create-recovery-seller-stop-workflow.js"

function validateRecoverySellerRoutes({ recoverySellerPairs } = {}) {
  if (!recoverySellerPairs ||
      typeof recoverySellerPairs !== "object" ||
      Array.isArray(recoverySellerPairs)) {
    throw new TypeError("Recovery Seller STOP runtime requires a valid route map")
  }
  return Object.keys(recoverySellerPairs).length > 0
}

export async function createRecoverySellerStopRuntime({
  recoverySellerPairs = {},
  operationalStateStore,
} = {}) {
  try {
    const enabled = validateRecoverySellerRoutes({
      recoverySellerPairs,
    })
    if (!enabled) {
      return toResult({
        data: {
          enabled: false,
          workflow: undefined,
        },
      })
    }
    if (!operationalStateStore) {
      throw new Error("Configured Recovery Seller routes require an Operational State Store for durable STOP")
    }
    const created = await createRecoverySellerStopWorkflow({
      operationalStateStore,
    })
    if (created?.ok !== true) {
      return created?.ok === false
        ? created
        : toResult({
          error: new Error("Recovery Seller STOP workflow startup was not confirmed"),
        })
    }
    return toResult({
      data: {
        enabled: true,
        workflow: created.data,
      },
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}
