/**
 * Authorize a trusted application actor for trading-control operations.
 *
 * Transport adapters authenticate external identities and may assign this
 * role only after their configured identity policy succeeds. Application
 * use cases still enforce the role; adapters cannot bypass this boundary.
 *
 * @param {object} options
 * @param {object} options.actor - Trusted, transport-neutral actor.
 * @returns {{id: string}} Authorized actor identity.
 * @throws {Error} When actor identity or trading-operator role is invalid.
 */
export function authorizeOperatorActor({ actor } = {}) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor) ||
      typeof actor.id !== "string" || actor.id.trim() === "") {
    const error = new TypeError("Operator actor requires a non-empty identity")
    error.code = "INVALID_OPERATOR_ACTOR"
    throw error
  }
  if (!Array.isArray(actor.roles) || !actor.roles.includes("trading-operator")) {
    const error = new Error("Actor is not authorized for trading control")
    error.code = "OPERATOR_UNAUTHORIZED"
    throw error
  }
  return Object.freeze({ id: actor.id })
}
