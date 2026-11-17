import { createDatabase, createSqliteProvider } from "./index.js"
import { runDatabaseProviderConformanceTests } from "../test-support/provider-conformance.js"

runDatabaseProviderConformanceTests({
  name: "SQLite provider",
  createDatabase: ({ storageKey }) => createDatabase({
    provider: createSqliteProvider({
      filename: storageKey,
    }),
  }),
})
