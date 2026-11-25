import type { ScenarioRunRecord, ScenarioTraceStep } from './run-contract';

const SECRET_KEY_PATTERN = /api.?key|secret|password|token|credential|authorization/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(item)]));
  }
  return value;
}

export interface DebugPackageInput {
  readonly run: ScenarioRunRecord;
  readonly trace: readonly ScenarioTraceStep[];
  readonly expected?: unknown;
  readonly assertionResults?: unknown;
  readonly metadata?: unknown;
}

export function createAiDebugPackage(input: DebugPackageInput): string {
  if (!input || !input.run || !Array.isArray(input.trace)) {
    throw new TypeError('Complete run record and trace are required to create a debug package.');
  }
  const report = {
    schema: 'coinzilla.scenario-run.debug',
    schemaVersion: 1,
    executionMode: 'simulation-only',
    run: input.run,
    trace: input.trace,
    expected: input.expected ?? null,
    assertionResults: input.assertionResults ?? null,
    metadata: input.metadata ?? null,
    traceCompleteness: 'completeness-unverified',
  };
  return JSON.stringify(redact(report), null, 2);
}
