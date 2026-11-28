import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  HARVESTER_ERROR_CATALOG,
  resolveHarvesterErrorDiagnostic,
} from "./harvester-error-catalog.js"

test("catalog codes are unique and every entry has operator guidance", () => {
  const entries = Object.values(HARVESTER_ERROR_CATALOG)
  const codes = entries.map(({ errorCode }) => errorCode)
  assert.equal(new Set(codes).size, codes.length, "Catalog error codes must be unique")
  for (const entry of entries) {
    assert.ok(entry.title, `${entry.errorCode} needs an operator-facing title`)
    assert.ok(entry.subsystem, `${entry.errorCode} needs an owning subsystem`)
    assert.ok(entry.failureStage, `${entry.errorCode} needs a failure stage`)
    assert.ok(entry.severity, `${entry.errorCode} needs a severity`)
    assert.ok(entry.stopBehavior, `${entry.errorCode} needs explicit stop behavior`)
    assert.ok(entry.meaning, `${entry.errorCode} needs a concise meaning`)
    assert.ok(entry.operatorAction, `${entry.errorCode} needs a concrete operator action`)
  }
})

test("resolves a catalog entry without losing the concrete cause or observed stage", () => {
  const diagnostic = resolveHarvesterErrorDiagnostic({
    errorCode: "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    stage: "RELATIONAL_MIGRATION_V5",
    errorMessage: "SQLITE_ERROR: no such column: broker_order_id",
  })
  assert.equal(diagnostic.diagnosticId, "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED")
  assert.equal(diagnostic.stage, "RELATIONAL_MIGRATION_V5")
  assert.equal(diagnostic.cause, "SQLITE_ERROR: no such column: broker_order_id")
  assert.match(diagnostic.operatorAction, /do not reset/)
})

test("returns no catalog guidance for unknown codes instead of misclassifying them", () => {
  assert.equal(resolveHarvesterErrorDiagnostic({
    errorCode: "UNKNOWN_PROVIDER_FAILURE",
    errorMessage: "provider rejected request",
  }), null)
})


test("operator error vocabulary documents every catalog entry", async () => {
  const documentation = await readFile(
    new URL("../../../docs/error-vocabulary.md", import.meta.url),
    "utf8",
  )
  const generatedStart = documentation.indexOf("<!-- BEGIN GENERATED HARVESTER ERROR CATALOG -->")
  const generatedEnd = documentation.indexOf("<!-- END GENERATED HARVESTER ERROR CATALOG -->")
  assert.ok(generatedStart >= 0 && generatedEnd > generatedStart, "The operator vocabulary must contain the generated catalog block.")
  const generatedCatalog = documentation.slice(generatedStart, generatedEnd)
  for (const entry of Object.values(HARVESTER_ERROR_CATALOG)) {
    for (const field of [
      entry.errorCode,
      entry.title,
      entry.subsystem,
      entry.failureStage,
      entry.severity,
      entry.stopBehavior,
      entry.meaning,
      entry.operatorAction,
    ]) {
      assert.ok(
        generatedCatalog.includes(field),
        `Operator error vocabulary must document catalog field ${field} from ${entry.errorCode}.`,
      )
    }
  }
})
