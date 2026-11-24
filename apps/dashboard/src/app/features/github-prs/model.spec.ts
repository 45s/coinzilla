import { describe, expect, it } from 'vitest';

import { formatRelativeCommitTime, normalizePullRequest } from './model';

describe('GitHub PR view model', () => {
  it('normalizes GitHub PR metadata without changing the canonical URL or title', () => {
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
      htmlUrl: 'https://github.com/45s/coinzilla/pull/1824',
      isDraft: true,
      headSha: 'a'.repeat(40),
      lastCommit: { status: 'unavailable', sha: 'a'.repeat(40), committerDate: null },
    });
  });

  it('rejects malformed current head SHAs instead of constructing a commit request', () => {
    expect(() => normalizePullRequest({
      number: 1,
      title: 'Bad head',
      html_url: 'https://github.com/45s/coinzilla/pull/1',
      draft: false,
      head: { sha: 'not-a-sha' },
    })).toThrow(/head SHA/i);
  });

  it('formats relative time from the committer timestamp and handles future timestamps', () => {
    const now = Date.parse('2026-11-24T12:00:00.000Z');

    expect(formatRelativeCommitTime('2026-11-24T11:56:00.000Z', now)).toBe('4 min ago');
    expect(formatRelativeCommitTime('2026-11-24T12:02:00.000Z', now)).toBe('in the future');
    expect(formatRelativeCommitTime('invalid', now)).toBe('Unavailable');
  });
});
