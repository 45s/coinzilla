import { describe, expect, it } from 'vitest';

import {
  assignLabel,
  createLabel,
  deleteLabel,
  loadLabelStore,
  renameLabel,
  saveLabelStore,
  unassignLabel,
  updateLabelColor,
} from './label-store';

const emptyStore = { schemaVersion: 1 as const, labels: [], assignments: {} };

describe('GitHub PR local label store', () => {
  it('Scenario 09/13 — creates trimmed, case-insensitively unique labels', () => {
    const first = createLabel(emptyStore, ' Codex ', 'blue', () => 'label-1');
    expect(first.labels).toEqual([{ id: 'label-1', name: 'Codex', color: 'blue' }]);
    expect(() => createLabel(first, 'codex', 'red', () => 'label-2')).toThrow(/already exists/i);
    expect(() => createLabel(first, '   ', 'red', () => 'label-2')).toThrow(/empty/i);
  });

  it('Scenario 10/11 — assigns multiple labels to one PR and reuses labels across PRs', () => {
    const withFirst = createLabel(emptyStore, 'Testing', 'green', () => 'label-1');
    const withTwo = createLabel(withFirst, 'Codex', 'blue', () => 'label-2');
    const onePr = assignLabel(assignLabel(withTwo, '45s/coinzilla#1824', 'label-1'), '45s/coinzilla#1824', 'label-2');
    const twoPrs = assignLabel(onePr, '45s/coinzilla#1825', 'label-1');

    expect(twoPrs.assignments['45s/coinzilla#1824']).toEqual(['label-1', 'label-2']);
    expect(twoPrs.assignments['45s/coinzilla#1825']).toEqual(['label-1']);
    expect(assignLabel(twoPrs, '45s/coinzilla#1825', 'label-1')).toBe(twoPrs);
    expect(unassignLabel(twoPrs, '45s/coinzilla#1824', 'label-1').assignments['45s/coinzilla#1824'])
      .toEqual(['label-2']);
  });

  it('Scenario 12/14 — preserves assignments on rename/recolor and removes all on deletion', () => {
    const assigned = assignLabel(
      createLabel(emptyStore, 'Codex', 'blue', () => 'label-1'),
      '45s/coinzilla#1824',
      'label-1',
    );
    const renamed = renameLabel(assigned, 'label-1', 'Agent');
    const recolored = updateLabelColor(renamed, 'label-1', 'purple');

    expect(recolored.labels[0]).toEqual({ id: 'label-1', name: 'Agent', color: 'purple' });
    expect(recolored.assignments['45s/coinzilla#1824']).toEqual(['label-1']);
    expect(deleteLabel(recolored, 'label-1').assignments).toEqual({});
  });

  it('Scenario 15/16/22 — persists assignments and preserves them when a PR is absent', () => {
    const assigned = assignLabel(
      createLabel(emptyStore, 'Testing', 'green', () => 'label-1'),
      '45s/coinzilla#1824',
      'label-1',
    );
    let written = '';
    const storage = {
      getItem: () => written || null,
      setItem: (_key: string, value: string) => { written = value; },
    };

    expect(saveLabelStore(storage, assigned)).toBe(true);
    expect(loadLabelStore(storage)).toEqual({ status: 'ready', store: assigned });
    expect(loadLabelStore({ getItem: () => '{broken' }).status).toBe('invalid');
    expect(loadLabelStore({ getItem: () => { throw new Error('storage unavailable'); } }).status).toBe('unavailable');
    expect(loadLabelStore({ getItem: () => JSON.stringify({ ...emptyStore, schemaVersion: 2 }) }).status).toBe('invalid');
    expect(loadLabelStore({
      getItem: () => JSON.stringify({
        schemaVersion: 1,
        labels: [{ id: 'known', name: 'Codex', color: 'blue' }],
        assignments: { '45s/coinzilla#1824': ['missing'] },
      }),
    }).status).toBe('invalid');
    expect(saveLabelStore({ setItem: () => { throw new Error('quota'); } }, assigned)).toBe(false);
  });
  it('rejects additional properties forbidden by the persisted-store schema', () => {
    const extraStoreProperty = { ...emptyStore, unexpected: true };
    const extraLabelProperty = {
      schemaVersion: 1,
      labels: [{ id: 'label-1', name: 'Codex', color: 'blue', unexpected: true }],
      assignments: {},
    };

    expect(loadLabelStore({ getItem: () => JSON.stringify(extraStoreProperty) }).status).toBe('invalid');
    expect(loadLabelStore({ getItem: () => JSON.stringify(extraLabelProperty) }).status).toBe('invalid');
  });

});
