export function createValidConfig(overrides = {}) {
  return {
    application: {
      name: "coin-farmer",
      environment: "test",
    },
    runtime: {
      shutdownTimeoutMs: 1000,
    },
    trading: {
      enabled: false,
    },
    markets: [],
    ...overrides,
  }
}
