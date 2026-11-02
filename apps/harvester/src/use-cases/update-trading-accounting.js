import { Fill } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"

/**
 * Apply one canonical execution atomically to shared inventory and the
 * Conservative quote-recovery projection.
 *
 * Both domain values are immutable. The caller commits both returned values
 * together only when this use case succeeds.
 */
export function updateTradingAccounting({
  portfolio,
  recoveryLedger,
  fill,
} = {}) {
  try {
    if (!(portfolio instanceof Portfolio)) {
      throw new TypeError("updateTradingAccounting requires a Portfolio")
    }
    if (!(recoveryLedger instanceof RecoveryLedger)) {
      throw new TypeError("updateTradingAccounting requires a RecoveryLedger")
    }
    if (!(fill instanceof Fill)) {
      throw new TypeError("updateTradingAccounting requires a canonical Fill")
    }
    const portfolioResult = portfolio.applyFill({ fill })
    const ledgerResult = recoveryLedger.applyFill({ fill })
    if (portfolioResult.applied !== ledgerResult.applied ||
        portfolioResult.duplicate !== ledgerResult.duplicate) {
      throw new Error("Portfolio and RecoveryLedger execution identities are inconsistent")
    }

    return toResult({
      data: {
        portfolio: portfolioResult.portfolio,
        recoveryLedger: ledgerResult.ledger,
        applied: portfolioResult.applied,
        duplicate: portfolioResult.duplicate,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
