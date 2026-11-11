import { createPauseMarket } from "../../use-cases/operator-control/pause-market.js"
import { createResumeMarket } from "../../use-cases/operator-control/resume-market.js"

/**
 * Compose Harvester's transport-independent operator capability.
 *
 * This is an application facade over explicit use cases, not a domain entity,
 * inheritance hierarchy, command bus, or transport dispatcher.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative trading engine control boundary.
 * @param {object} options.durableFacts - ADR-0001 application-owned durable-facts port.
 * @returns {Readonly<{pauseMarket: Function, resumeMarket: Function}>} Operator capability.
 */
export function createHarvesterOperator({ engine, durableFacts } = {}) {
  return Object.freeze({
    pauseMarket: createPauseMarket({ engine, durableFacts }),
    resumeMarket: createResumeMarket({ engine, durableFacts }),
  })
}
