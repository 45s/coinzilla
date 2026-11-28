import { describe, expect, it } from 'vitest';
import { parseGitHubScenarioCatalog } from './parse-github-scenario-catalog';

describe('parseGitHubScenarioCatalog', () => {
  it('extracts scenario metadata from pinned source and never authorizes remote execution', () => {
    const source = 'Object.freeze({ id: "RS-001-001", name: "Scenario one", layer: "APPLICATION", status: "PARTIAL", executionStatus: "EXECUTABLE" })';
    const result = parseGitHubScenarioCatalog({ sources: [source], commitSha: 'a'.repeat(40) });
    expect(result.catalog[0].scenarios).toEqual([expect.objectContaining({
      id: 'RS-001-001',
      name: 'Scenario one',
      executionStatus: 'BLOCKED',
      executable: false,
    })]);
  });

  it('rejects invalid commit identity and unrecognized source', () => {
    expect(() => parseGitHubScenarioCatalog({ sources: ['no scenario records'], commitSha: 'develop' })).toThrow(/full commit SHA/);
    expect(() => parseGitHubScenarioCatalog({ sources: ['no scenario records'], commitSha: 'a'.repeat(40) })).toThrow(/did not contain/);
  });

  it('rejects duplicate scenario IDs across source files', () => {
    const source = 'Object.freeze({ id: "RS-001-001", name: "Scenario one", layer: "APPLICATION", status: "PARTIAL", executionStatus: "EXECUTABLE" })';
    expect(() => parseGitHubScenarioCatalog({ sources: [source, source], commitSha: 'a'.repeat(40) })).toThrow(/duplicate scenario ID/);
  });
});
