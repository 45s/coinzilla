import { Fill } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"

export function makeUpdatePortfolio() {
  return async function updatePortfolio({ portfolio, fill } = {}) {
    try {
      if (!(portfolio instanceof Portfolio)) throw new TypeError("updatePortfolio requires a Portfolio")
      if (!(fill instanceof Fill)) throw new TypeError("updatePortfolio requires a canonical Fill")
      const result = portfolio.applyFill({ fill })
      return toResult({
        data: {
          portfolio: result.portfolio,
          applied: result.applied,
          duplicate: result.duplicate,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}
