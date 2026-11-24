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
  it('creates trimmed, case-insensitively unique labels with stable IDs', () => {
    const first = createLabel(emptyStore, ' Codex ', 'blue', () => 'label-1');
    expect(first.labels).toEqual([{ id: 'label-1', name: 'Codex', color: 'blue' }]);
    expect(() => createLabel(first, 'codex', 'red', () => 'label-2')).toThrow(/already exists/i);
    expect(() => createLabel(first, '   ', 'red', () => 'label-2')).toThrow(/empty/i);
  });

  it('supports many-to-many assignment and independent unassignment', () => {
    const withLabel = createLabel(emptyStore, 'Testing', 'green', () => 'label-1');
    const first = assignLabel(withLabel, '45s/coinzilla#1824', 'label-1');
    const second = assignLabel(first, '45s/coinzilla#1825', 'label-1');

    expect(second.assignments['45s/coinzilla#1824']).toEqual(['label-1']);
    expect(second.assignments['45s/coinzilla#1825']).toEqual(['label-1']);
    expect(unassignLabel(second, '45s/coinzilla#1824', 'label-1').assignments)
      .toEqual({ '45s/coinzilla#1825': ['label-1'] });
  });

  it('preserves assignments on rename/recolor and removes all on label deletion', () => {
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

  it('retains invalid stored JSON and reports corruption rather than overwriting it', () => {
    let written: string | null = null;
    const storage = {
      getItem: () => '{broken',
      setItem: (_key: string, value: string) => { written = value; },
    };

    expect(loadLabelStore(storage).status).toBe('invalid');
    expect(written).toBeNull();
    expect(loadLabelStore({ getItem: () => { throw new Error('storage unavailable'); } }).status).toBe('unavailable');
    expect(loadLabelStore({ getItem: () => JSON.stringify({ ...emptyStore, schemaVersion: 2 }) }).status).toBe('invalid');
    expect(loadLabelStore({ getItem: () => JSON.stringify({ schemaVersion: 1, labels: [{ id: 'known', name: 'Codex', color: 'blue' }], assignments: { '45s/coinzilla#1824': ['missing'] } }) }).status).toBe('invalid');
  });

  it('persists valid stores under the specified key and tolerates storage failures', () => {
    let writtenKey = '';
    let writtenValue = '';
    const storage = {
      getItem: () => JSON.stringify(emptyStore),
      setItem: (key: string, value: string) => { writtenKey = key; writtenValue = value; },
    };

    expect(loadLabelStore(storage)).toEqual({ status: 'ready', store: emptyStore });
    expect(saveLabelStore(storage, emptyStore)).toBe(true);
    expect(writtenKey).toBe('coinzilla.dashboard.github-pr-labels.v1');
    expect(JSON.parse(writtenValue)).toEqual(emptyStore);
    expect(saveLabelStore({ setItem: () => { throw new Error('quota'); } }, emptyStore)).toBe(false);
  });
});
