import { describe, expect, it } from 'vitest';
import { createTraceGraph } from './create-trace-graph';
import { createAiDebugPackage } from './create-ai-debug-package';
import type { ScenarioRunRecord } from './run-contract';

const run: ScenarioRunRecord = {
  runId: 'run-1', strategyId: 'RS', scenarioId: 'RS-001-001', status: 'Completed',
  createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:01Z',
  startedAt: '2026-11-25T00:00:00Z', completedAt: '2026-11-25T00:00:01Z',
  input: { secret: 'hidden' }, output: { ok: true }, diagnostics: [],
  transitions: [{ status: 'Completed', at: '2026-11-25T00:00:01Z' }],
};

describe('scenario-runner framework-independent core', () => {
  it('builds a sequential graph from execution-produced trace records', () => {
    const graph = createTraceGraph([
      { id: 'a', kind: 'input', label: 'Given' },
      { id: 'b', kind: 'decision', label: 'Decision' },
    ]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('rejects malformed or duplicate trace step identities', () => {
    expect(() => createTraceGraph([{ id: 'x', kind: 'step', label: 'One' }, { id: 'x', kind: 'step', label: 'Two' }])).toThrow(/duplicate/);
    expect(() => createTraceGraph([{ id: '', kind: 'step', label: 'Empty ID' }])).toThrow(/malformed/);
  });

  it('produces versioned JSON and redacts secret-like keys recursively', () => {
    const report = JSON.parse(createAiDebugPackage({
      run, trace: [{ id: 's1', kind: 'step', label: 'Step', outputs: { apiKey: 'secret', value: 1 } }],
    }));
    expect(report.schemaVersion).toBe(1);
    expect(report.run.input.secret).toBe('[REDACTED]');
    expect(report.trace[0].outputs.apiKey).toBe('[REDACTED]');
    expect(report.traceCompleteness).toBe('completeness-unverified');
  });

  it('redacts private keys, cookies, session identifiers and signatures recursively', () => {
    const sensitiveEvidence = {
      privateKey: 'private-key-value',
      sessionCookie: 'session-cookie-value',
      nested: {
        signature: 'signature-value',
        accessToken: 'access-token-value',
      },
    };
    const report = JSON.parse(createAiDebugPackage({
      run: { ...run, output: sensitiveEvidence },
      trace: [{
        id: 'sensitive-step',
        kind: 'step',
        label: 'Sensitive evidence',
        outputs: sensitiveEvidence,
      }],
      metadata: { sessionId: 'session-id-value' },
    }));

    expect(report.run.output).toEqual({
      privateKey: '[REDACTED]',
      sessionCookie: '[REDACTED]',
      nested: {
        signature: '[REDACTED]',
        accessToken: '[REDACTED]',
      },
    });
    expect(report.trace[0].outputs.nested.accessToken).toBe('[REDACTED]');
    expect(report.metadata.sessionId).toBe('[REDACTED]');
    expect(sensitiveEvidence.privateKey).toBe('private-key-value');
    expect(sensitiveEvidence.nested.signature).toBe('signature-value');
  });

  it('requires run record and ordered trace', () => {
    expect(() => createAiDebugPackage({ run: null as never, trace: [] })).toThrow(/required/);
  });
});
