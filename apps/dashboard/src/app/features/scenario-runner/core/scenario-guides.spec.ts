import { describe, expect, it } from 'vitest';
import { getScenarioGuide } from './scenario-guides';

const runtimeScenarioIds = [
  'RS-RUNTIME-SELL-SUBMISSION-001',
  'RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001',
  'RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001',
  'RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001',
  'RS-RUNTIME-SELL-BROKER-EXCEPTION-001',
  'RS-RUNTIME-SELL-RESERVATION-FAILURE-001',
  'RS-RUNTIME-SELL-REJECTION-001',
  'RS-RUNTIME-SELL-PARTIAL-CANCEL-001',
  'RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001',
  'RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001',
  'RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001',
  'RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001',
  'RS-004-011',
] as const;

describe('Scenario Runner catalog explanations', () => {
  it('provides a readable, scenario-specific flow for every published RS catalog entry', () => {
    for (const scenarioId of runtimeScenarioIds) {
      const guide = getScenarioGuide(scenarioId);

      expect(guide, `${scenarioId} must have an explanation before an operator can run it`).not.toBeNull();
      expect(guide?.purpose, `${scenarioId} must explain the business question it tests`).toBeTruthy();
      expect(guide?.startingState, `${scenarioId} must explain the seeded starting state`).toBeTruthy();
      expect(guide?.steps.length, `${scenarioId} must show more than a title in its flow diagram`).toBeGreaterThan(2);
      expect(guide?.expectedOutcome, `${scenarioId} must explain what result the assertions expect`).toBeTruthy();
      expect(guide?.limitations.length, `${scenarioId} must disclose what the scenario does not prove`).toBeGreaterThan(0);
      expect(guide?.steps[0]?.kind, `${scenarioId} diagram must begin at its actual scenario entry point`).toBe('start');
      expect(guide?.steps.at(-1)?.kind, `${scenarioId} diagram must end with an expected outcome`).toBe('outcome');
      expect(new Set(guide?.steps.map((step) => step.id)).size, `${scenarioId} diagram step IDs must be unique`).toBe(guide?.steps.length);
    }
  });

  it('identifies the exact injected failure point for persistence and broker failure scenarios', () => {
    const expectedFailureLabels = new Map([
      ['RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001', 'SELL intent persistence fails'],
      ['RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001', 'SELL outcome persistence fails'],
      ['RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001', 'SELL outcome and STOP persistence fail'],
      ['RS-RUNTIME-SELL-BROKER-EXCEPTION-001', 'Simulated broker placement throws'],
      ['RS-RUNTIME-SELL-RESERVATION-FAILURE-001', 'Sole-SELL reservation callback fails'],
      ['RS-RUNTIME-SELL-REJECTION-001', 'Simulated broker rejects the SELL'],
      ['RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001', 'Terminal reconciliation persistence fails'],
      ['RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001', 'Account STOP persistence fails'],
    ]);

    for (const [scenarioId, expectedLabel] of expectedFailureLabels) {
      const guide = getScenarioGuide(scenarioId);
      const injectedFailure = guide?.steps.find((step) => step.kind === 'injected-failure');

      expect(injectedFailure?.label, `${scenarioId} must show the actual fault injected by its runner branch`).toBe(expectedLabel);
    }
  });

  it('marks the helper-only profitability candidate as preliminary and non-executable', () => {
    const guide = getScenarioGuide('RS-004-011');

    expect(guide?.availability, 'RS-004-011 must not be described as a full executable runtime scenario').toBe('PRELIMINARY');
    expect(guide?.steps.some((step) => step.kind === 'production-flow'), 'the helper-only candidate must not claim to execute the full strategy lifecycle').toBe(false);
  });

  it('does not invent a strategy flow for unknown catalog entries', () => {
    expect(getScenarioGuide('RS-FUTURE-999'), 'unknown scenario IDs must remain explicitly unmapped').toBeNull();
    expect(getScenarioGuide(''), 'empty scenario IDs must not receive a generic scenario explanation').toBeNull();
  });
});
