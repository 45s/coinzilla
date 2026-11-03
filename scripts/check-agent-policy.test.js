import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInstructionDirectories, findMissingLocalLinks, findMissingRoadmaps, findOwnershipGaps } from './check-agent-policy.js';

const ownershipRow = (path) => `| Domain | \`${path}/\` | Responsibility |\n`;

test('accepts complete, unique ownership maps', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(findOwnershipGaps([directory], ownershipRow(directory)), []);
});

test('reports missing ownership entries', () => {
  assert.deepEqual(findOwnershipGaps(['packages/new-domain'], ''), [
    'packages/new-domain missing from DOMAIN_OWNERSHIP.md',
  ]);
});

test('detects duplicate ownership rows', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow(directory)),
    ['apps/harvester appears more than once in DOMAIN_OWNERSHIP.md'],
  );
});

test('detects stale ownership rows without a matching AGENTS.md', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow('apps/retired-app')),
    ['apps/retired-app in DOMAIN_OWNERSHIP.md has no matching AGENTS.md'],
  );
});

test('recursively discovers nested domain instruction files', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-policy-'));
  try {
    mkdirSync(join(root, 'apps', 'harvester', 'strategies'), { recursive: true });
    mkdirSync(join(root, 'packages', 'entities'), { recursive: true });
    writeFileSync(join(root, 'apps', 'harvester', 'strategies', 'AGENTS.md'), '# nested');
    writeFileSync(join(root, 'packages', 'entities', 'AGENTS.md'), '# package');
    assert.deepEqual(findInstructionDirectories(root), [
      'apps/harvester/strategies',
      'packages/entities',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('detects missing local Markdown links and ignores external links and anchors', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-links-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'existing.md'), '# Existing');
    const gaps = findMissingLocalLinks(root, [{
      path: 'docs/policy.md',
      content: '[valid](existing.md) [broken](missing.md) [external](https://example.com) [anchor](#section)',
    }]);
    assert.deepEqual(gaps, ['docs/policy.md links to missing path missing.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a roadmap for each domain in the ownership map', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-roadmaps-'));
  try {
    mkdirSync(join(root, 'apps', 'harvester'), { recursive: true });
    mkdirSync(join(root, 'packages', 'entities'), { recursive: true });
    writeFileSync(join(root, 'apps', 'harvester', 'ROADMAP.md'), '# Roadmap');
    const ownership = ownershipRow('apps/harvester') + ownershipRow('packages/entities');
    assert.deepEqual(findMissingRoadmaps(root, ownership), [
      'packages/entities is missing ROADMAP.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
