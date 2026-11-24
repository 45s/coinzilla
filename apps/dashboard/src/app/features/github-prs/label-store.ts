export type LabelColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'cyan' | 'yellow' | 'gray';

export interface DashboardLabel {
  readonly id: string;
  readonly name: string;
  readonly color: LabelColor;
}

export interface LabelStore {
  readonly schemaVersion: 1;
  readonly labels: readonly DashboardLabel[];
  readonly assignments: Readonly<Record<string, readonly string[]>>;
}

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;
export type LabelStoreStatus = 'ready' | 'unavailable' | 'invalid' | 'save-failed';

export const LABEL_STORAGE_KEY = 'coinzilla.dashboard.github-pr-labels.v1';
export const LABEL_COLORS: readonly LabelColor[] = [
  'blue', 'green', 'red', 'orange', 'purple', 'cyan', 'yellow', 'gray',
];

export const EMPTY_LABEL_STORE: LabelStore = {
  schemaVersion: 1,
  labels: [],
  assignments: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && LABEL_COLORS.includes(value as LabelColor);
}

function isValidLabelStore(value: unknown): value is LabelStore {
  if (!isRecord(value) || value['schemaVersion'] !== 1 || !Array.isArray(value['labels']) || !isRecord(value['assignments'])) {
    return false;
  }

  const labels = value['labels'];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of labels) {
    if (!isRecord(candidate)) return false;
    const id = candidate['id'];
    const name = candidate['name'];
    const color = candidate['color'];
    if (typeof id !== 'string' || id.length === 0 || ids.has(id)) return false;
    if (typeof name !== 'string' || name.length === 0 || name.length > 40 || name.trim() !== name) return false;
    if (!isLabelColor(color)) return false;
    const normalizedName = name.toLocaleLowerCase();
    if (names.has(normalizedName)) return false;
    ids.add(id);
    names.add(normalizedName);
  }

  for (const [key, assignments] of Object.entries(value['assignments'])) {
    if (!/^[^/]+\/[^#]+#[1-9][0-9]*$/.test(key) || !Array.isArray(assignments)) return false;
    const seen = new Set<string>();
    for (const id of assignments) {
      if (typeof id !== 'string' || !ids.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return true;
}

export function loadLabelStore(storage: StorageReader | null | undefined): {
  readonly status: LabelStoreStatus;
  readonly store: LabelStore;
} {
  if (!storage) return { status: 'unavailable', store: EMPTY_LABEL_STORE };
  let stored: string | null;
  try {
    stored = storage.getItem(LABEL_STORAGE_KEY);
  } catch {
    return { status: 'unavailable', store: EMPTY_LABEL_STORE };
  }
  if (stored === null) return { status: 'ready', store: EMPTY_LABEL_STORE };
  try {
    const parsed: unknown = JSON.parse(stored);
    return isValidLabelStore(parsed)
      ? { status: 'ready', store: parsed }
      : { status: 'invalid', store: EMPTY_LABEL_STORE };
  } catch {
    return { status: 'invalid', store: EMPTY_LABEL_STORE };
  }
}

export function saveLabelStore(storage: StorageWriter | null | undefined, store: LabelStore): boolean {
  if (!storage || !isValidLabelStore(store)) return false;
  try {
    storage.setItem(LABEL_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function createLabel(
  store: LabelStore,
  name: string,
  color: LabelColor,
  createId: () => string = () => crypto.randomUUID(),
): LabelStore {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Label name cannot be empty.');
  if (normalizedName.length > 40) throw new Error('Label name cannot exceed 40 characters.');
  if (store.labels.some((label) => label.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
    throw new Error('A label with that name already exists.');
  }
  if (!isLabelColor(color)) throw new Error('Choose a supported label color.');
  const id = createId();
  if (!id || store.labels.some((label) => label.id === id)) throw new Error('Label ID must be unique.');

  return { ...store, labels: [...store.labels, { id, name: normalizedName, color }] };
}

export function renameLabel(store: LabelStore, id: string, name: string): LabelStore {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Label name cannot be empty.');
  if (normalizedName.length > 40) throw new Error('Label name cannot exceed 40 characters.');
  if (store.labels.some((label) => label.id !== id && label.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
    throw new Error('A label with that name already exists.');
  }
  if (!store.labels.some((label) => label.id === id)) throw new Error('Label does not exist.');
  return { ...store, labels: store.labels.map((label) => label.id === id ? { ...label, name: normalizedName } : label) };
}

export function updateLabelColor(store: LabelStore, id: string, color: LabelColor): LabelStore {
  if (!isLabelColor(color)) throw new Error('Choose a supported label color.');
  if (!store.labels.some((label) => label.id === id)) throw new Error('Label does not exist.');
  return { ...store, labels: store.labels.map((label) => label.id === id ? { ...label, color } : label) };
}

export function assignLabel(store: LabelStore, key: string, id: string): LabelStore {
  if (!store.labels.some((label) => label.id === id)) throw new Error('Label does not exist.');
  const current = store.assignments[key] ?? [];
  if (current.includes(id)) return store;
  return { ...store, assignments: { ...store.assignments, [key]: [...current, id] } };
}

export function unassignLabel(store: LabelStore, key: string, id: string): LabelStore {
  const current = store.assignments[key] ?? [];
  const remaining = current.filter((candidate) => candidate !== id);
  const assignments = { ...store.assignments };
  if (remaining.length > 0) assignments[key] = remaining;
  else delete assignments[key];
  return { ...store, assignments };
}

export function deleteLabel(store: LabelStore, id: string): LabelStore {
  const assignments = Object.fromEntries(
    Object.entries(store.assignments)
      .map(([key, ids]) => [key, ids.filter((candidate) => candidate !== id)])
      .filter(([, ids]) => (ids as readonly string[]).length > 0),
  );
  return {
    schemaVersion: 1,
    labels: store.labels.filter((label) => label.id !== id),
    assignments,
  };
}
