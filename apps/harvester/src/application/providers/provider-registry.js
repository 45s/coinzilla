/**
 * Create an immutable registry of named provider instances.
 *
 * @param {{providers: object[]}} input
 * @returns {object}
 */
export function createProviderRegistry() {
  return Object.freeze({
    get: () => undefined,
    list: () => Object.freeze([]),
    connect: async () => {},
    disconnect: async () => {},
  })
}
