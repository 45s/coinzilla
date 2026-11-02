import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInstructionDirectories, findOwnershipGaps } from './check-agent-policy.js';

const ownershipRow = (path) => `| Domain | \`${path}/\` | Responsibility |\n`;
const workflowRow = (path) => `| Domain | \`${path}/**\` | Instructions |\n`;

test('accepts complete, unique ownership maps', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(findOwnershipGaps([directory], ownershipRow(directory), workflowRow(directory)), []);
});

test('reports missing ownership and workflow entries independently', () => {
  assert.deepEqual(findOwnershipGaps(['packages/new-domain'], '', ''), [
    'packages/new-domain missing from DOMAIN_OWNERSHIP.md',
    'packages/new-domain missing from AI_AGENT_WORKFLOW.md',
  ]);
});

test('detects duplicate ownership rows', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow(directory), workflowRow(directory)),
    ['apps/harvester appears more than once in DOMAIN_OWNERSHIP.md'],
  );
});

test('detects stale ownership rows without a matching AGENTS.md', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow('apps/retired-app'), workflowRow(directory)),
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
