/**
 * A configured market is blocked because one or more applicable exchange
 * constraints do not yet have a Harvester domain evaluator.
 */
export class UnvalidatedMarketExchangeConstraintsError extends Error {
  constructor({ symbol, constraints } = {}) {
    if (typeof symbol !== "string" || !symbol.trim()) {
      throw new TypeError("UnvalidatedMarketExchangeConstraintsError requires a market symbol")
    }
    if (!Array.isArray(constraints) || constraints.length === 0) {
      throw new TypeError("UnvalidatedMarketExchangeConstraintsError requires at least one unvalidated exchange constraint")
    }

    const normalizedConstraints = Object.freeze(constraints.map((constraint) => {
      if (!constraint || typeof constraint !== "object" || Array.isArray(constraint)) {
        throw new TypeError("Unvalidated exchange constraint descriptors must be objects")
      }
      const { type, scope, sourceFilterType } = constraint
      if ([type, scope, sourceFilterType].some((field) => typeof field !== "string" || !field.trim())) {
        throw new TypeError("Unvalidated exchange constraint descriptors require type, scope, and sourceFilterType")
      }
      return Object.freeze({ type, scope, sourceFilterType })
    }))
    const blockers = normalizedConstraints.map(({ type, scope, sourceFilterType }) =>
      [type, scope, sourceFilterType].join("/")
    )
    const normalizedSymbol = symbol.trim().toUpperCase()
    const message = "Market " + normalizedSymbol +
      " cannot start because " + normalizedConstraints.length +
      " exchange constraint(s) are not validated: " + blockers.join(", ") + "."

    super(message)
    this.name = "UnvalidatedMarketExchangeConstraintsError"
    this.code = "HARVESTER_MARKET_UNVALIDATED_EXCHANGE_CONSTRAINTS"
    this.symbol = normalizedSymbol
    this.constraints = normalizedConstraints
    this.details = Object.freeze({
      component: "market-readiness",
      operation: "validate-market-trading-readiness",
      symbol: this.symbol,
      constraintCount: normalizedConstraints.length,
      constraints: normalizedConstraints,
      remediation: "Implement and test a domain evaluator for every listed constraint before enabling this market.",
    })
  }
}
