/**
 * Create a logger adapter that tags market-owned diagnostics without assigning
 * a strategy identity.
 *
 * @param {{logger?: object, component: string}} options
 * @returns {object | undefined} Component logger adapter.
 */
export function createMarketComponentLogger({ logger, component } = {}) {
  if (!logger) {
    return logger
  }
  const decorate = (data = {}) => ({
    ...data,
    component,
  })
  return {
    system: (data) => logger.system?.(decorate(data)),
    warn: (data) => logger.warn?.(decorate(data)),
  }
}
