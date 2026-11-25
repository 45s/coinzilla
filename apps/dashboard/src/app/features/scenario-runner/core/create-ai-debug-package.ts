import type { ScenarioRunRecord, ScenarioTraceStep } from './run-contract';

const SECRET_KEY_PATTERN = /api.?key|access.?key|private.?key|secret|password|passphrase|token|credential|authorization|bearer|cookie|session|jwt|signature/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /\\b((?:x-)?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|secret|password|passphrase|credential|authorization|bearer|cookie|set-cookie|session(?:[_ -]?(?:id|token))?|jwt|signature))\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;&]+)/gi;
const AUTH_HEADER_PATTERN = /\\b(authorization)\\s*:\\s*(?:bearer|basic)\\s+[^\\r\\n,;]+/gi;
const COOKIE_HEADER_PATTERN = /\\b(set-cookie|cookie)\\s*:\\s*[^\\r\\n]+/gi;
const BEARER_TOKEN_PATTERN = /\\b(bearer)\\s+[A-Za-z0-9._~+/-]+=*/gi;
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\\s\\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const JWT_PATTERN = /\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b/g;

function redactString(value: string): string {
  return value
    .replace(PEM_PRIVATE_KEY_PATTERN, '[REDACTED PRIVATE KEY]')
    .replace(AUTH_HEADER_PATTERN, '$1: [REDACTED]')
    .replace(COOKIE_HEADER_PATTERN, '$1: [REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1=[REDACTED]')
    .replace(BEARER_TOKEN_PATTERN, '$1 [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED JWT]');
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : key, SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(item)]));
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
