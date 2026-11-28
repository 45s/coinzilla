import { describe, expect, it } from 'vitest';

import { formatRelativeCommitTime, mapWithConcurrency, normalizePullRequest } from './model';

describe('GitHub PR view model', () => {
  it('Scenario 01/02 — normalizes open PR metadata and includes draft state', () => {
    const pullRequest = normalizePullRequest({
      number: 1824,
      title: 'Fix <script> display as text',
      html_url: 'https://github.com/45s/coinzilla/pull/1824',
      draft: true,
      head: { sha: 'a'.repeat(40) },
    });

    expect(pullRequest).toEqual({
      repository: '45s/coinzilla',
      number: 1824,
      title: 'Fix <script> display as text',
      headBranch: 'Unavailable',
      mergedAt: null,
      htmlUrl: 'https://github.com/45s/coinzilla/pull/1824',
      isDraft: true,
      headSha: 'a'.repeat(40),
      lastCommit: { status: 'unavailable', sha: 'a'.repeat(40), committerDate: null },
    });
  });

  it('Scenario 03 — rejects malformed current head SHAs before commit lookup', () => {
    expect(() => normalizePullRequest({
      number: 1,
      title: 'Bad head',
      html_url: 'https://github.com/45s/coinzilla/pull/1',
      draft: false,
      head: { sha: 'not-a-sha' },
    })).toThrow(/head SHA/i);
  });

  it('Scenario 25 — limits concurrent work to the configured number of workers', async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });
    expect(maximum).toBe(2);
    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('Scenario 04/07/08/23 — formats committer time, future skew and invalid values', () => {
    const now = Date.parse('2026-11-24T12:00:00.000Z');

    expect(formatRelativeCommitTime('2026-11-24T11:56:00.000Z', now)).toBe('4 min ago');
    expect(formatRelativeCommitTime('2026-11-24T12:02:00.000Z', now)).toBe('in the future');
    expect(formatRelativeCommitTime('2026-11-24T12:00:30.000Z', now)).toBe('in the future');
    expect(formatRelativeCommitTime('invalid', now)).toBe('Unavailable');
  });
});
