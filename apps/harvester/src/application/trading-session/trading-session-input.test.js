import assert from "node:assert/strict"
import test from "node:test"
import { mapTradingSessionInput } from "./trading-session-input.js"

const provenance = {
  application: "harvester",
  version: "1.0.001",
  processId: 12345,
  source: {
    branch: "develop",
    commit: "A".repeat(40),
    shortCommit: "AAAAAAAA",
    commitDate: "2026-11-17T15:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
    apiSecret: "secret",
  },
  apiKey: "secret",
}

test("maps build provenance into a bounded canonical application input", () => {
  const mapped = mapTradingSessionInput({ buildProvenance: provenance })
  assert.deepEqual(mapped.buildProvenance, {
    application: "harvester",
    version: "1.0.001",
    processId: 12345,
    source: {
      branch: "develop",
      commit: "a".repeat(40),
      shortCommit: "a".repeat(8),
      commitDate: "2026-11-17T15:00:00.000Z",
      workingTree: "clean",
      metadataSource: "git",
    },
  }, "The application mapper must canonicalize and allowlist provenance before the domain receives it.")
  assert.equal(JSON.stringify(mapped).includes("secret"), false, "Secrets and unknown provenance fields must be removed.")
})

test("accepts null git identity when provenance is unavailable", () => {
  const mapped = mapTradingSessionInput({
    buildProvenance: {
      application: "harvester",
      version: "1.0.001",
      processId: 12345,
      source: {
        branch: null,
        commit: null,
        shortCommit: null,
        commitDate: null,
        workingTree: "unknown",
        metadataSource: "unavailable",
      },
    },
  })
  assert.equal(mapped.buildProvenance.source.metadataSource, "unavailable", "Unavailable metadata must remain an explicit normalized source.")
})

test("rejects malformed build provenance at the application boundary", () => {
  const invalid = [
    {
      label: "commit SHA",
      value: { ...provenance, source: { ...provenance.source, commit: "bad" } },
      expected: /hexadecimal Git SHA/,
    },
    {
      label: "short SHA",
      value: { ...provenance, source: { ...provenance.source, shortCommit: "bbbbbbbb" } },
      expected: /match the full Git SHA/,
    },
    {
      label: "commit date",
      value: { ...provenance, source: { ...provenance.source, commitDate: "yesterday" } },
      expected: /canonical UTC ISO-8601/,
    },
    {
      label: "working-tree state",
      value: { ...provenance, source: { ...provenance.source, workingTree: "modified" } },
      expected: /workingTree must be/,
    },
    {
      label: "metadata source",
      value: { ...provenance, source: { ...provenance.source, metadataSource: "other" } },
      expected: /metadataSource must be/,
    },
    {
      label: "process id",
      value: { ...provenance, processId: 0 },
      expected: /positive safe integer/,
    },
  ]
  for (const entry of invalid) {
    assert.throws(() => mapTradingSessionInput({ buildProvenance: entry.value }), entry.expected, `Invalid ${entry.label} must be rejected by the application mapper.`)
  }
})
