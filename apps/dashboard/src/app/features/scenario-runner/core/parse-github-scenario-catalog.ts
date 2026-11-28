import type { ScenarioCatalogItem } from '../application';

const SCENARIO_RECORD = /Object\.freeze\(\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*layer:\s*"([^"]+)",\s*status:\s*"([^"]+)",\s*executionStatus:\s*"([^"]+)"/g;

export interface GitHubScenarioCatalog {
  readonly catalog: readonly ScenarioCatalogItem[];
  readonly commitSha: string;
}

export function parseGitHubScenarioCatalog({ sources, commitSha }: {
  sources: readonly string[];
  commitSha: string;
}): GitHubScenarioCatalog {
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new TypeError('GitHub scenario catalogue requires a full commit SHA.');
  }
  const scenarios = new Map<string, ScenarioCatalogItem['scenarios'][number]>();
  for (const source of sources) {
    for (const match of source.matchAll(SCENARIO_RECORD)) {
      const id = match[1];
      const name = match[2];
      const layer = match[3];
      const status = match[4];
      if (!id || !name || !layer || !status) {
        continue;
      }
      if (scenarios.has(id)) {
        throw new TypeError(\`GitHub scenario catalogue contains duplicate scenario ID: \${id}\`);
      }
      scenarios.set(id, {
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
  if (scenarios.size === 0) {
    throw new TypeError('GitHub develop did not contain any recognized Recovery Seller scenarios.');
  }
  return {
    commitSha: commitSha.toLowerCase(),
    catalog: [{
      strategyId: 'RS',
      strategyName: 'Recovery Seller',
      scenarios: [...scenarios.values()],
    }],
  };
}
