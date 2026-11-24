/**
 * Execute a declarative scenario's ordered steps through explicitly supplied
 * handlers. The runner contains no RS business logic.
 *
 * @param {object} input Ordered scenario steps and handlers.
 * @param {object[]} input.steps Ordered step records.
 * @param {object} input.handlers Map from step type to implementation.
 * @param {object} [input.initialContext] Initial scenario context.
 * @returns {object} Frozen ordered results and named step outputs.
 */
export async function executeRecoverySellerScenarioSteps({
  steps,
  handlers,
  initialContext = {},
} = {}) {
  if (!Array.isArray(steps)) {
    throw new TypeError("Recovery Seller scenario steps must be an array")
  }
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
    throw new TypeError("Recovery Seller scenario handlers must be an object")
  }

  const context = { ...initialContext }
  const results = []

  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== "object" || Array.isArray(step) ||
        typeof step.type !== "string" || step.type.length === 0) {
      throw new TypeError(`Recovery Seller scenario step ${index} must have a type`)
    }
    const handler = handlers[step.type]
    if (typeof handler !== "function") {
      throw new Error(`Recovery Seller scenario has no handler for step type "${step.type}"`)
    }

    let input = step.input
    if (step.inputKey !== undefined) {
      if (typeof step.inputKey !== "string" || step.inputKey.trim().length === 0 ||
          !Object.hasOwn(context, step.inputKey)) {
        throw new Error(`Recovery Seller scenario step ${index} references missing input "${step.inputKey}"`)
      }
      input = context[step.inputKey]
    }

    const result = await handler({
      input,
      context: Object.freeze({ ...context }),
      step,
    })
    results.push(result)
    if (step.saveAs !== undefined) {
      if (typeof step.saveAs !== "string" || step.saveAs.trim().length === 0) {
        throw new TypeError(`Recovery Seller scenario step ${index} saveAs must be non-empty`)
      }
      context[step.saveAs] = result
    }
  }

  return Object.freeze({
    context: Object.freeze(context),
    results: Object.freeze(results),
  })
}
