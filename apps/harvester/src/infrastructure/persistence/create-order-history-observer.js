export function createOrderHistoryObserver() {
  return {
    flush: async () => ({
      ok: true,
      errors: [],
    }),
    close: async () => ({
      ok: true,
      errors: [],
    }),
    getDiagnostics: () => ({
      pendingCount: 0,
      droppedCount: 0,
    }),
  }
}
