import type { ScenarioCatalogItem } from '../application';

const SCENARIO_RECORD = /Object\.freeze\(\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*layer:\s*"([^"]+)",\s*status:\s*"([^"]+)",\s*executionStatus:\s*"([^"]+)"/g;
const CONSERVATIVE_PART_ASSIGNMENT = /export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_(ONE|TWO|THREE|FOUR)\s*=/;
const CONSERVATIVE_PART_NAMES = ['ONE', 'TWO', 'THREE', 'FOUR'] as const;

const DEFAULT_CONSERVATIVE_DETAILS = Object.freeze({
  tags: [],
  preconditions: [],
  initialState: {},
  inputEvents: [],
  expectedState: {},
  expectedOrders: [],
  expectedAccounting: {},
  expectedSideEffects: {},
  invariants: [],
  relatedRequirements: [],
  relatedCriticalBehaviors: [],
  relatedSourceFiles: [],
  relatedExistingTests: [],
});

export interface GitHubScenarioCatalog {
  readonly catalog: readonly ScenarioCatalogItem[];
  readonly commitSha: string;
}

function extractJsonArray(source: string, assignmentIndex: number, assignmentLength: number): unknown[] {
  const start = source.indexOf('[', assignmentIndex + assignmentLength);
  if (start < 0) {
    throw new TypeError('GitHub Conservative catalogue part has no JSON array.');
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        const parsed: unknown = JSON.parse(source.slice(start, index + 1));
        if (!Array.isArray(parsed)) {
          throw new TypeError('GitHub Conservative catalogue part must contain a JSON array.');
        }
        return parsed;
      }
    }
  }
  throw new TypeError('GitHub Conservative catalogue part contains an unterminated JSON array.');
}

function parseConservativeScenarios(sources: readonly string[]): ScenarioCatalogItem['scenarios'][number][] {
  const parts = new Map<string, unknown[]>();
  for (const source of sources) {
    const assignment = CONSERVATIVE_PART_ASSIGNMENT.exec(source);
    if (!assignment) {
      continue;
    }
    const partName = assignment[1];
    if (parts.has(partName)) {
      throw new TypeError('GitHub Conservative catalogue contains duplicate part: ' + partName);
    }
    parts.set(partName, extractJsonArray(source, assignment.index, assignment[0].length));
  }
  if (parts.size === 0) {
    return [];
  }
  if (CONSERVATIVE_PART_NAMES.some((partName) => !parts.has(partName))) {
    throw new TypeError('GitHub Conservative catalogue is missing one or more metadata parts.');
  }
  const records = CONSERVATIVE_PART_NAMES.flatMap((partName) => parts.get(partName) ?? []);
  const scenarios = new Map<string, ScenarioCatalogItem['scenarios'][number]>();
  for (const record of records) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new TypeError('GitHub Conservative catalogue contains an invalid scenario record.');
    }
    const details = record as Readonly<Record<string, unknown>>;
    const id = details['id'];
    const name = details['title'];
    const status = details['coverageStatus'];
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name ||
      typeof status !== 'string' || !status) {
      throw new TypeError('GitHub Conservative catalogue scenario is missing ID, title or coverage status.');
    }
    if (scenarios.has(id)) {
      throw new TypeError('GitHub scenario catalogue contains duplicate scenario ID: ' + id);
    }
    const normalizedDetails = { ...DEFAULT_CONSERVATIVE_DETAILS, ...details };
    scenarios.set(id, {
      id,
      name,
      layer: 'DOMAIN',
      status,
      executionStatus: 'BLOCKED',
      executable: false,
      readinessReasons: ['GitHub develop metadata snapshot only. No isolated CG production-flow worker or executable input schema is registered.'],
      details: normalizedDetails,
    });
  }
  return [...scenarios.values()];
}

export function parseGitHubScenarioCatalog({ sources, commitSha }: {
  sources: readonly string[];
  commitSha: string;
}): GitHubScenarioCatalog {
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new TypeError('GitHub scenario catalogue requires a full commit SHA.');
  }
  const recoverySellerScenarios = new Map<string, ScenarioCatalogItem['scenarios'][number]>();
  for (const source of sources) {
    for (const match of source.matchAll(SCENARIO_RECORD)) {
      const id = match[1];
      const name = match[2];
      const layer = match[3];
      const status = match[4];
      if (!id || !name || !layer || !status) {
        continue;
      }
      if (recoverySellerScenarios.has(id)) {
        throw new TypeError('GitHub scenario catalogue contains duplicate scenario ID: ' + id);
      }
      recoverySellerScenarios.set(id, {
        id,
        name,
        layer,
        status,
        executionStatus: 'BLOCKED',
        executable: false,
        readinessReasons: ['GitHub develop catalogue is a read-only metadata snapshot. Refresh the live Harvester catalogue before execution.'],
      });
    }
  }
  const conservativeScenarios = parseConservativeScenarios(sources);
  for (const scenario of conservativeScenarios) {
    if (recoverySellerScenarios.has(scenario.id)) {
      throw new TypeError('GitHub scenario catalogue contains duplicate scenario ID: ' + scenario.id);
    }
  }
  if (recoverySellerScenarios.size === 0 && conservativeScenarios.length === 0) {
    throw new TypeError('GitHub develop did not contain any recognized scenario records.');
  }
  const catalog: ScenarioCatalogItem[] = [];
  if (recoverySellerScenarios.size > 0) {
    catalog.push({
      strategyId: 'RS',
      strategyName: 'Recovery Seller',
      scenarios: [...recoverySellerScenarios.values()],
    });
  }
  if (conservativeScenarios.length > 0) {
    catalog.push({
      strategyId: 'CG-conservative',
      strategyName: 'Conservative',
      scenarios: conservativeScenarios,
    });
  }
  return {
    commitSha: commitSha.toLowerCase(),
    catalog,
  };
}
