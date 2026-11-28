import { describe, expect, it } from 'vitest';
import fixture from './fixtures/rs-runtime-sell-partial-cancel.debug.json';
import { createScenarioRunPresentation } from './create-scenario-run-presentation';

describe('createScenarioRunPresentation', () => {
  it('explains the supplied partial CANCELED SELL run without changing its evidence', () => {
    const presentation = createScenarioRunPresentation(fixture);

    expect(presentation.rawPayload, 'the original payload must remain available by reference').toBe(fixture);
    expect(presentation.identity, 'run identity and simulation mode must come from the source').toEqual({
      runId: '2e1936d6-e980-4751-9c22-966d063269ab',
      strategyId: 'RS',
      scenarioId: 'RS-RUNTIME-SELL-PARTIAL-CANCEL-001',
      symbol: 'ZROUSDT',
      venue: 'binance',
      executionMode: 'simulation-only',
    });
    expect(presentation.configuration, 'the effective scenario inputs must remain inspectable').toEqual(expect.objectContaining({
      investment: 100,
      orderQuantity: 5,
      sellQuantity: 50,
      keepQuantity: 1,
      minProfit: 0.2,
    }));
    expect(presentation.steps.map((step) => step.id), 'the visual path must retain source trace order').toEqual([
      'input-1',
      'fill-1',
      'runtime-1',
      'broker-1',
      'terminal-1',
      'assertions-1',
    ]);
    expect(presentation.orders, 'submission and terminal lifecycle evidence must be correlated').toEqual([
      expect.objectContaining({
        side: 'SELL',
        purpose: 'RECOVERY_SELL',
        quantity: '55',
        price: '12.3',
        orderType: 'LIMIT_MAKER',
        submissionOutcome: 'ACKNOWLEDGED',
        brokerOrderId: 'sim-86b71f74072d48afb82ae75fe153e8fb',
        terminalStatus: 'CANCELED',
        executedQuantity: '2.5',
        terminalReconciled: true,
      }),
    ]);
    expect(presentation.cycle.status, 'a partially executed canceled SELL must not be presented as a completed cycle').toBe('UNRESOLVED');
    expect(presentation.outcomes.execution.status, 'the server-reported run execution status must remain independent').toBe('Completed');
    expect(presentation.outcomes.assertions, 'all source assertion results must be counted without promoting readiness').toEqual({
      passed: 16,
      total: 16,
      failed: 0,
    });
    expect(presentation.outcomes.safety, 'STOP must distinguish BUY admission from SELL admission').toEqual(expect.objectContaining({
      stopRecorded: true,
      marketPaused: true,
      buyAdmissionBlocked: true,
      sellAdmissionBlocked: false,
    }));
    expect(presentation.outcomes.provenance, 'missing artifact attestation must remain unverified').toEqual(expect.objectContaining({
      verified: false,
      catalogStatus: 'PARTIAL',
      buildArtifactSha256: null,
    }));
    expect(presentation.steps[4].sourceEvidence, 'each visual step must retain its exact source trace object').toBe(fixture.trace[4]);
  });

  it('preserves unknown trace kinds and explicit source branches without inventing edges', () => {
    const source = {
      schema: 'coinzilla.scenario-run.debug',
      schemaVersion: 2,
      run: {
        runId: 'generic-run',
        strategyId: 'FUTURE_STRATEGY',
        scenarioId: 'future-case',
        status: 'Running',
        input: { enabled: false, absent: null },
        output: null,
      },
      trace: [
        { id: 'one', kind: 'future-event-kind', label: 'Unknown event', customField: false },
        { id: 'two', kind: 'decision', label: 'Observed decision' },
      ],
      traceEdges: [{ from: 'one', to: 'two', label: 'source-declared branch' }],
    };
    const presentation = createScenarioRunPresentation(source);

    expect(presentation.steps[0].kind, 'unknown event kinds must remain visible').toBe('future-event-kind');
    expect(presentation.steps[0].sourceEvidence, 'unknown fields must remain attached to their source evidence').toBe(source.trace[0]);
    expect(presentation.edges, 'only explicit source relationships may become diagram edges').toEqual([
      { from: 'one', to: 'two', label: 'source-declared branch' },
    ]);
    expect(presentation.configuration, 'false and null must not be collapsed into missing values').toEqual({
      enabled: false,
      absent: null,
    });
    expect(presentation.outcomes.execution.status, 'in-progress execution must not be promoted to complete').toBe('Running');
    expect(presentation.cycle.status, 'missing cycle evidence must remain unavailable').toBe('UNAVAILABLE');
  });

  it('keeps incomplete runs inspectable and does not synthesize lifecycle steps', () => {
    const source = {
      run: {
        runId: 'incomplete-run',
        strategyId: 'GC',
        scenarioId: 'gc-incomplete',
        status: 'Failed',
        input: {},
        output: null,
      },
      trace: [],
    };
    const presentation = createScenarioRunPresentation(source);

    expect(presentation.steps, 'an empty source trace must remain empty').toEqual([]);
    expect(presentation.edges, 'no edges may be fabricated for missing trace evidence').toEqual([]);
    expect(presentation.outcomes.execution.status, 'failed execution must remain failed').toBe('Failed');
    expect(presentation.outcomes.assertions, 'missing assertions must be unavailable rather than treated as zero failures').toBeNull();
    expect(presentation.rawPayload, 'the full incomplete source payload must remain inspectable').toBe(source);
  });
});
