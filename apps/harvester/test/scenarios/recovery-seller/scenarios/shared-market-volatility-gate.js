import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/bootstrap/market-evaluation.test.js"
const testTitle = "rejects conflicting CG/RS volatility settings for the same enabled market"
const rsOnlyTestTitle = "RS-008-017-A: RS-only market receives the shared market-owned volatility submission gate"
const disabledProtectionTestTitle = "RS-008-017-C: disabled volatility protection skips only volatility work and preserves other gates"
const recoverySellTestTitle = "RS-008-017-D: recovery SELL bypasses volatility only and retains other submission gates"
const cancellationTestTitle = "RS-008-017-E: volatility cancellation cancels CG/RS owned BUYs but never SELL or external orders"

export const recoverySellerSharedMarketVolatilityScenario = defineRecoverySellerScenario({
  id: "RS-008-017",
  family: "RS-008",
  name: "same-market CG and RS volatility protection settings must agree",
  priority: "P0",
  authority: [
    "apps/harvester/docs/volatility-protection.md",
    "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-008--cg-rs-shared-account-resources-and-concurrency-p0",
    "issue-1780: RS-008-017-A RS-only market shared volatility gate",
    "issue-1780: RS-008-017-B shared market volatility configuration",
    "issue-1780: RS-008-017-C disabled volatility protection",
    "issue-1780: RS-008-017-D recovery SELL volatility exception",
    "issue-1780: RS-008-017-E owned-BUY-only volatility cancellation",
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
    id: "RS-008-017-E",
    description: "market-owned volatility cancellation includes current-process CG and RS BUY orders but excludes registered SELL orders and external/manual orders outside the OrderRegistry",
    status: "TEST-MAPPED",
    test: {
      file: "apps/harvester/src/use-cases/conservative-trading-engine.multi-market.test.js",
      title: cancellationTestTitle,
    },
    evidence: null,
  }, {
    id: "RS-008-017-A",
    description: "an enabled RS-only market without a CG execution route receives the shared market-owned volatility submission gate",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: rsOnlyTestTitle,
    },
    evidence: null,
  }, {
    id: "RS-008-017-B",
    description: "same-market enabled CG and RS routes with conflicting explicit volatility-protection booleans fail during configuration resolution",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: testTitle,
    },
    evidence: null,
  }, {
    id: "RS-008-017-C",
    description: "disabled volatility protection skips volatility-specific reads and blocking, while an independent market pause still blocks the order",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: disabledProtectionTestTitle,
    },
    evidence: null,
  }, {
    id: "RS-008-017-D",
    description: "a recovery SELL bypasses active volatility protection only; an independent market pause still blocks it, while all other gates satisfied permit the SELL",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: recoverySellTestTitle,
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
