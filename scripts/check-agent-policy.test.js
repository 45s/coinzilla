import test from 'node:test';
import assert from 'node:assert/strict';
import { findOwnershipGaps } from './check-agent-policy.js';

test('accepts a domain documented in both ownership maps', () => {
  const directory = 'apps/harvester';
  const ownership = '| Harvester | `apps/harvester/` | app |';
  const workflow = '| Harvester | `apps/harvester/**` | instructions |';
  assert.deepEqual(findOwnershipGaps([directory], ownership, workflow), []);
});

test('reports missing ownership and workflow entries independently', () => {
  assert.deepEqual(findOwnershipGaps(['packages/new-domain'], '', ''), [
    'packages/new-domain missing from DOMAIN_OWNERSHIP.md',
    'packages/new-domain missing from AI_AGENT_WORKFLOW.md',
  ]);
});
