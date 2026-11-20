export async function synchronizeAccountHistory() {
  return {
    ok: true,
    data: {
      historyScope: "CONFIGURED_MARKETS",
      marketUniverseComplete: false,
      retentionCoverageConfirmed: false,
      ordersPersisted: 0,
      fillsPersisted: 0,
    },
  }
}
