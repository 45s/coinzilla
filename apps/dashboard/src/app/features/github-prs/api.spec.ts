import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitHubPullRequestsApi } from './api';

describe('GitHubPullRequestsApi', () => {
  let api: GitHubPullRequestsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), GitHubPullRequestsApi],
    });
    api = TestBed.inject(GitHubPullRequestsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('Scenario 01/02/03/04/25 — follows pages and uses the current head committer date, not updated_at or author date', async () => {
    const resultPromise = api.loadOpenPullRequests();
    const firstPage = http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1');
    firstPage.flush([{
      number: 1824,
      title: 'A PR',
      html_url: 'https://github.com/45s/coinzilla/pull/1824',
      draft: true,
      head: { sha: 'a'.repeat(40) },
      updated_at: '2026-11-24T11:59:00.000Z',
    }], {
      headers: { Link: '<https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=2>; rel="next"' },
    });

    await Promise.resolve();
    const secondPage = http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=2');
    secondPage.flush([{
      number: 1823,
      title: 'B PR',
      html_url: 'https://github.com/45s/coinzilla/pull/1823',
      draft: false,
      head: { sha: 'b'.repeat(40) },
    }]);

    await Promise.resolve();
    await Promise.resolve();
    const firstCommit = http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'a'.repeat(40));
    const secondCommit = http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'b'.repeat(40));
    firstCommit.flush({ sha: 'a'.repeat(40), commit: { author: { date: '2026-11-24T11:00:00.000Z' }, committer: { date: '2026-11-24T11:50:00.000Z' } } });
    secondCommit.flush({ sha: 'b'.repeat(40), commit: { committer: { date: '2026-11-24T10:50:00.000Z' } } });

    const result = await resultPromise;
    expect(result.pullRequests.map((item) => item.number)).toEqual([1824, 1823]);
    expect(result.pullRequests[0].lastCommit.committerDate).toBe('2026-11-24T11:50:00.000Z');
    expect(result.pullRequests[0].isDraft).toBe(true);
  });


  it('Scenario 04 — a PR metadata update with the same head SHA reuses the cached commit date', async () => {
    const firstResult = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        updated_at: '2026-11-24T11:00:00.000Z',
        head: { sha: 'a'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'a'.repeat(40))
      .flush({ sha: 'a'.repeat(40), commit: { committer: { date: '2026-11-24T10:00:00.000Z' } } });
    await firstResult;

    const secondResult = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'Updated title',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        updated_at: '2026-11-24T11:59:00.000Z',
        head: { sha: 'a'.repeat(40) },
      }]);
    const refreshed = await secondResult;

    expect(refreshed.pullRequests[0].title).toBe('Updated title');
    expect(refreshed.pullRequests[0].lastCommit.committerDate).toBe('2026-11-24T10:00:00.000Z');
    expect(http.match((request) => request.url.includes('/commits/'))).toHaveLength(0);
  });

  it('Scenario 05 — a changed head SHA retrieves and displays its new commit time', async () => {
    const firstResult = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'a'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'a'.repeat(40))
      .flush({ sha: 'a'.repeat(40), commit: { committer: { date: '2026-11-24T10:00:00.000Z' } } });
    await firstResult;

    const secondResult = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'b'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'b'.repeat(40))
      .flush({ sha: 'b'.repeat(40), commit: { committer: { date: '2026-11-24T11:00:00.000Z' } } });

    const refreshed = await secondResult;
    expect(refreshed.pullRequests[0].lastCommit.committerDate).toBe('2026-11-24T11:00:00.000Z');
  });

  it('Scenario 06 — keeps a PR when its individual commit lookup fails', async () => {
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'a'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'a'.repeat(40))
      .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });

    const result = await resultPromise;
    const [item] = result.pullRequests;
    expect(item.number).toBe(1824);
    expect(item.lastCommit.status).toBe('unavailable');
  });

  it('Scenario 07 — missing or invalid committer date remains unavailable', async () => {
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'c'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'c'.repeat(40))
      .flush({ sha: 'c'.repeat(40), commit: { committer: { date: 'not-a-date' } } });

    const result = await resultPromise;
    expect(result.pullRequests[0].lastCommit.status).toBe('unavailable');
    expect(result.pullRequests[0].lastCommit.committerDate).toBeNull();
  });

  it('Scenario 20 — does not treat a failed later page as a complete result', async () => {
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'a'.repeat(40) },
      }], {
        headers: { Link: '<https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=2>; rel="next"' },
      });
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=2')
      .flush({ message: 'temporary failure' }, { status: 500, statusText: 'Server Error' });

    await expect(resultPromise).rejects.toThrow();
    expect(http.match((request) => request.url.includes('/commits/'))).toHaveLength(0);
  });

  it('Scenario 21 — reports rate limits from isolated commit lookups without hiding the PR', async () => {
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'a'.repeat(40) },
      }]);
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + 'a'.repeat(40))
      .flush({ message: 'API rate limit exceeded' }, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1795525200' },
      });

    const result = await resultPromise;
    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0].lastCommit.status).toBe('unavailable');
    expect(result.rateLimitReset).toBe(new Date(1795525200 * 1000).toISOString());
  });

  it('Scenario 25 — limits actual commit HTTP requests to four at a time', async () => {
    const pullRequests = Array.from({ length: 5 }, (_value, index) => ({
      number: 1900 - index,
      title: 'PR ' + index,
      html_url: 'https://github.com/45s/coinzilla/pull/' + (1900 - index),
      draft: false,
      head: { sha: String(index + 1).repeat(40) },
    }));
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush(pullRequests);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const firstBatch = http.match((request) => request.url.includes('/commits/'));
    expect(firstBatch).toHaveLength(4);
    firstBatch[0].flush({ sha: '1'.repeat(40), commit: { committer: { date: '2026-11-24T11:00:00.000Z' } } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const fifthRequest = http.expectOne('https://api.github.com/repos/45s/coinzilla/commits/' + '5'.repeat(40));
    for (const request of firstBatch.slice(1)) {
      const sha = request.request.url.split('/').at(-1);
      request.flush({ sha, commit: { committer: { date: '2026-11-24T11:00:00.000Z' } } });
    }
    fifthRequest.flush({ sha: '5'.repeat(40), commit: { committer: { date: '2026-11-24T11:00:00.000Z' } } });

    const result = await resultPromise;
    expect(result.pullRequests).toHaveLength(5);
  });
});
