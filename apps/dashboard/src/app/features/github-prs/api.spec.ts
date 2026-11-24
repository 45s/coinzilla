import { HttpClient, provideHttpClient } from '@angular/common/http';
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

  it('retrieves every linked page and uses only the current head commit committer date', async () => {
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

    const secondPage = http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=2');
    secondPage.flush([{
      number: 1823,
      title: 'B PR',
      html_url: 'https://github.com/45s/coinzilla/pull/1823',
      draft: false,
      head: { sha: 'b'.repeat(40) },
    }]);

    const firstCommit = http.expectOne(`https://api.github.com/repos/45s/coinzilla/commits/${'a'.repeat(40)}`);
    const secondCommit = http.expectOne(`https://api.github.com/repos/45s/coinzilla/commits/${'b'.repeat(40)}`);
    firstCommit.flush({ commit: { author: { date: '2026-11-24T11:00:00.000Z' }, committer: { date: '2026-11-24T11:50:00.000Z' } } });
    secondCommit.flush({ commit: { committer: { date: '2026-11-24T10:50:00.000Z' } } });

    const result = await resultPromise;
    expect(result.map((item) => item.number)).toEqual([1824, 1823]);
    expect(result[0].lastCommit.committerDate).toBe('2026-11-24T11:50:00.000Z');
    expect(result[0].isDraft).toBe(true);
  });

  it('keeps a PR when its individual commit lookup fails', async () => {
    const resultPromise = api.loadOpenPullRequests();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1')
      .flush([{
        number: 1824,
        title: 'A PR',
        html_url: 'https://github.com/45s/coinzilla/pull/1824',
        draft: false,
        head: { sha: 'a'.repeat(40) },
      }]);
    http.expectOne(`https://api.github.com/repos/45s/coinzilla/commits/${'a'.repeat(40)}`)
      .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });

    const [item] = await resultPromise;
    expect(item.number).toBe(1824);
    expect(item.lastCommit.status).toBe('unavailable');
  });
});
