import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/bootstrap/market-evaluation.test.js"
const testTitle = "rejects conflicting CG/RS volatility settings for the same enabled market"

export const recoverySellerSharedMarketVolatilityScenario = defineRecoverySellerScenario({
  id: "RS-008-017",
  family: "RS-008",
  name: "same-market CG and RS volatility protection settings must agree",
  priority: "P0",
  authority: [
    "apps/harvester/docs/volatility-protection.md",
    "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-008--cg-rs-shared-account-resources-and-concurrency-p0",
    "issue-1780: RS-008-017-B shared market volatility configuration",
  ],
  layer: "APPLICATION",
  configFields: ["RS_PAIR.enableVolatilityProtection"],
  covers: {
    rules: [],
    decisions: [],
    states: [],
    transitions: [],
    invariants: [],
  },
  given: {
    input: {
      marketSymbol: "BTCUSDT",
      cgProtectionEnabled: true,
      rsProtectionEnabled: false,
    },
  },
  when: [{
    type: "resolve-shared-market-volatility-config",
    inputKey: "input",
  }],
  then: {
    configurationRejected: true,
    error: "Market BTCUSDT has conflicting volatility protection settings for CG and RS",
  },
  mustNot: [
    "silently choose the CG or RS volatility setting for a shared enabled market",
    "start Harvester or connect a broker while validating this configuration",
    "submit, cancel or otherwise mutate any order",
  ],
  subcases: [{
    id: "RS-008-017-B",
    description: "same-market enabled CG and RS routes with conflicting explicit volatility-protection booleans fail during configuration resolution",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: testTitle,
    },
    evidence: null,
  }],
  implementation: [
    "apps/harvester/src/bootstrap/config/resolve-harvester-options.js",
  ],
  test: {
    file: testFile,
    title: testTitle,
  },
  status: "TEST-MAPPED",
  evidence: null,
})
