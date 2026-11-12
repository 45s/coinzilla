/**
 * Structured failure raised while building an authorized operator read model.
 */
export class OperatorQueryError extends Error {
  /**
   * @param {object} options
   * @param {string} options.message - Concise operation-specific failure.
   * @param {string} options.code - Stable Harvester operator error code.
   * @param {unknown} [options.cause] - Original lower-level failure.
   * @param {object} [options.context] - Bounded safe diagnostic context.
   */
  constructor({ message, code, cause, context = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = new.target.name
    this.code = code
    this.context = Object.freeze({
      component: "harvester.operator",
      ...context,
    })
  }
}
