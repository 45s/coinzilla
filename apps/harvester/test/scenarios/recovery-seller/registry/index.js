import { recoverySellerProfitabilityAllGatesScenario } from "../scenarios/profitability.js"
import { RS_CONFIG_FIELD_IDS } from "./config-fields.js"
import { RS_DECISION_IDS } from "./decisions.js"
import { RS_DOMAIN_RULE_IDS } from "./domain-rules.js"
import { RS_INVARIANT_IDS } from "./invariants.js"
import { RS_CYCLE_STATE_IDS } from "./states.js"
import { RS_TRANSITION_IDS } from "./transitions.js"

export {
  RS_CONFIG_FIELD_IDS,
  RS_DECISION_IDS,
  RS_DOMAIN_RULE_IDS,
  RS_INVARIANT_IDS,
  RS_CYCLE_STATE_IDS,
  RS_TRANSITION_IDS,
}
export { defineRecoverySellerScenario } from "./define-scenario.js"
export { validateRecoverySellerScenarioRegistry } from "./validate-registry.js"

export const recoverySellerScenarioRegistry = Object.freeze([
  recoverySellerProfitabilityAllGatesScenario,
])
