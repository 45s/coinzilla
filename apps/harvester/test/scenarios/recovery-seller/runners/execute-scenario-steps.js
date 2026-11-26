function resolveStepInput({ step, context, index }) {
  const { inputKey } = step
  if (inputKey === undefined) {
    return step.input
  }
  if (typeof inputKey !== "string" || inputKey.trim().length === 0 ||
      !Object.hasOwn(context, inputKey)) {
    throw new Error(`Recovery Seller scenario step ${index} references missing input "${inputKey}"`)
  }
  const { [inputKey]: input } = context
  return input
}

function validateStep({ step, index }) {
  if (!step || typeof step !== "object" || Array.isArray(step) ||
      typeof step.type !== "string" || step.type.length === 0) {
    throw new TypeError(`Recovery Seller scenario step ${index} must have a type`)
  }
}

function saveStepOutput({ step, index, result, context }) {
  if (step.saveAs === undefined) {
    return
  }
  if (typeof step.saveAs !== "string" || step.saveAs.trim().length === 0) {
    throw new TypeError(`Recovery Seller scenario step ${index} saveAs must be non-empty`)
  }
  Object.defineProperty(context, step.saveAs, {
    configurable: true,
    enumerable: true,
    value: result,
    writable: true,
  })
}

async function executeStep({ step, index, handlers, context }) {
  validateStep({
    step,
    index,
  })
  const handler = Object.hasOwn(handlers, step.type)
    ? handlers[step.type]
    : undefined
  if (typeof handler !== "function") {
    throw new Error(`Recovery Seller scenario has no handler for step type "${step.type}"`)
  }
  const input = resolveStepInput({
    step,
    context,
    index,
  })
  return handler({
    input,
    context: Object.freeze({ ...context }),
    step,
  })
}

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
    const result = await executeStep({
      step,
      index,
      handlers,
      context,
    })
    results.push(result)
    saveStepOutput({
      step,
      index,
      result,
      context,
    })
  }

  return Object.freeze({
    context: Object.freeze(context),
    results: Object.freeze(results),
  })
}
