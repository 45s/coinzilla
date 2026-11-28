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

  it('extracts a CG-conservative catalogue from four static JSON metadata parts and keeps entries blocked', () => {
    const scenario = {
      id: 'CON-BUY-001',
      title: 'Conservative BUY lifecycle',
      category: 'buy-lifecycle',
      priority: 'P0',
      description: 'Inspect the BUY admission contract.',
      coverageStatus: 'TEST-MAPPED',
      coverageReason: 'Linked policy tests remain partial evidence.',
      inputEvents: [{ type: 'BUY_FILLED', sequence: 1 }],
    };
    const sources = [
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_ONE = ' + JSON.stringify([scenario]),
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_TWO = []',
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_THREE = []',
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_FOUR = []',
    ];
    const result = parseGitHubScenarioCatalog({ sources, commitSha: 'b'.repeat(40) });
    const conservative = result.catalog.find((strategy) => strategy.strategyId === 'CG-conservative');

    expect(conservative?.strategyName).toBe('Conservative');
    expect(conservative?.scenarios).toHaveLength(1);
    expect(conservative?.scenarios[0]).toMatchObject({
      id: 'CON-BUY-001',
      name: 'Conservative BUY lifecycle',
      status: 'TEST-MAPPED',
      executionStatus: 'BLOCKED',
      executable: false,
      details: {
        category: 'buy-lifecycle',
        inputEvents: [{ type: 'BUY_FILLED', sequence: 1 }],
        expectedAccounting: {},
      },
    });
  });

  it('rejects an incomplete Conservative metadata snapshot', () => {
    const sources = [
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_ONE = []',
      'export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_TWO = []',
    ];
    expect(() => parseGitHubScenarioCatalog({ sources, commitSha: 'c'.repeat(40) })).toThrow(/missing one or more metadata parts/i);
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
