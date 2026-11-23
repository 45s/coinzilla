import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('./quality-gate.yml', import.meta.url), 'utf8');

function extractJob(jobId) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  assert.notEqual(start, -1, `Expected workflow job "${jobId}" to exist.`);

  const nextJobOffset = lines.slice(start + 1).findIndex(
    (line) => /^ {2}[a-z][a-z-]*:$/.test(line),
  );
  const end = nextJobOffset === -1 ? undefined : start + 1 + nextJobOffset;
  return lines.slice(start + 1, end).join('\n');
}

test('task preflight is isolated from JavaScript quality and gates the required status', () => {
  assert.match(workflow, /^name: Repository Quality$/m);
  assert.match(workflow, /name: Check JavaScript syntax/);

  const workspaceQuality = extractJob('workspace-quality');
  assert.doesNotMatch(workspaceQuality, /task:preflight|test:task-preflight/i);

  const preflightTests = extractJob('task-preflight-tests');
  assert.match(preflightTests, /pnpm run test:task-preflight/);
  assert.match(preflightTests, /node --test \.github\/workflows\/task-preflight\.test\.js/);

  const evidencePublisher = extractJob('publish-task-preflight-evidence');
  assert.match(evidencePublisher, /issues: write/);
  assert.match(evidencePublisher, /Verification evidence/);
  assert.match(evidencePublisher, /gh api/);
  assert.doesNotMatch(evidencePublisher, /uses:\s+actions\/checkout|run:\s+pnpm/);

  const validator = extractJob('task-preflight');
  assert.match(validator, /needs: publish-task-preflight-evidence/);
  assert.match(validator, /github\.event\.pull_request\.head\.sha/);
  assert.match(validator, /pnpm run task:preflight -- --pull-request/);

  const requiredQuality = extractJob('required-javascript-quality');
  assert.match(requiredQuality, /task-preflight/);
  assert.match(requiredQuality, /TASK_PREFLIGHT_RESULT/);
  assert.match(requiredQuality, /Check JavaScript syntax/);
});
