import { HttpClient, HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { mapWithConcurrency, normalizePullRequest, type GitHubPullRequest } from './model';

const API_ROOT = 'https://api.github.com';
const PULLS_URL = API_ROOT + '/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1';
const MAX_COMMIT_LOOKUPS = 4;

interface GitHubCommitPayload {
  readonly sha?: unknown;
  readonly commit?: {
    readonly committer?: { readonly date?: unknown } | null;
  } | null;
}

export interface GitHubMergedPullRequestsSnapshot { readonly pullRequests: readonly GitHubPullRequest[]; }

export interface GitHubPullRequestsSnapshot {
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly rateLimitReset: string | null;
}

function getNextPageUrl(response: HttpResponse<unknown[]>): string | null {
  const linkHeader = response.headers.get('Link');
  if (!linkHeader) return null;
  const nextLink = [...linkHeader.matchAll(/<([^>]+)>([^<]*?)(?=,\s*<|$)/g)]
    .find(([, , parameters]) => /(?:^|;)\s*rel\s*=\s*(?:"next"|'next'|next)\s*(?=;|$)/i.test(parameters ?? ''));
  if (!nextLink) return null;

  const nextUrl = new URL(nextLink[1] as string);
  if (nextUrl.origin !== API_ROOT || nextUrl.pathname !== '/repos/45s/coinzilla/pulls') {
    throw new Error('GitHub returned an unexpected pagination destination.');
  }
  return nextUrl.toString();
}

function readRateLimitReset(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const reset = error.headers.get('X-RateLimit-Reset');
  const retryAfter = error.headers.get('Retry-After');
  const isRateLimited = error.status === 429 || retryAfter !== null
    || (error.status === 403 && error.headers.get('X-RateLimit-Remaining') === '0');
  if (!isRateLimited) return null;

  if (reset && /^\d+$/.test(reset)) {
    const timestamp = Number(reset) * 1000;
    return Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : 'unknown';
  }
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    const timestamp = Date.now() + Number(retryAfter) * 1000;
    return Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : 'unknown';
  }
  return 'unknown';
}

@Injectable({ providedIn: 'root' })
export class GitHubPullRequestsApi {
  private readonly http = inject(HttpClient);
  private readonly commitDateBySha = new Map<string, string>();

  async loadMergedPullRequests(): Promise<GitHubMergedPullRequestsSnapshot> {
    const response = await firstValueFrom(this.http.get<unknown[]>(
      API_ROOT + '/repos/45s/coinzilla/pulls?state=closed&per_page=100&page=1',
    ));
    if (!Array.isArray(response)) throw new Error('GitHub returned an invalid merged pull request list.');
    const merged = response.filter((item) => typeof (item as { merged_at?: unknown }).merged_at === 'string');
    return {
      pullRequests: merged.map((item) => normalizePullRequest(item as Parameters<typeof normalizePullRequest>[0]))
        .sort((left, right) => Date.parse(right.mergedAt ?? '') - Date.parse(left.mergedAt ?? ''))
        .slice(0, 5),
    };
  }

  async loadOpenPullRequests(): Promise<GitHubPullRequestsSnapshot> {
    const rawPullRequests = await this.loadAllPullRequests();
    const uniquePullRequests = new Map<number, GitHubPullRequest>();
    for (const rawPullRequest of rawPullRequests) {
      const pullRequest = normalizePullRequest(rawPullRequest as Parameters<typeof normalizePullRequest>[0]);
      uniquePullRequests.set(pullRequest.number, pullRequest);
    }
    const normalized = [...uniquePullRequests.values()];
    let rateLimitReset: string | null = null;

    const pullRequests = await mapWithConcurrency(
      normalized,
      MAX_COMMIT_LOOKUPS,
      async (pullRequest) => {
        const cachedDate = this.commitDateBySha.get(pullRequest.headSha);
        if (cachedDate) {
          return {
            ...pullRequest,
            lastCommit: { status: 'available' as const, sha: pullRequest.headSha, committerDate: cachedDate },
          };
        }
        try {
          const commit = await firstValueFrom(this.http.get<GitHubCommitPayload>(
            API_ROOT + '/repos/45s/coinzilla/commits/' + pullRequest.headSha,
          ));
          const committerDate = commit.commit?.committer?.date;
          if (commit.sha !== pullRequest.headSha || typeof committerDate !== 'string' || !Number.isFinite(Date.parse(committerDate))) {
            return pullRequest;
          }
          this.commitDateBySha.set(pullRequest.headSha, committerDate);
          return {
            ...pullRequest,
            lastCommit: {
              status: 'available' as const,
              sha: pullRequest.headSha,
              committerDate,
            },
          };
        } catch (error) {
          rateLimitReset ??= readRateLimitReset(error);
          return pullRequest;
        }
      },
    );

    return {
      pullRequests: pullRequests.sort((left, right) => right.number - left.number),
      rateLimitReset,
    };
  }

  private async loadAllPullRequests(): Promise<unknown[]> {
    const results: unknown[] = [];
    const visitedUrls = new Set<string>();
    let nextUrl: string | null = PULLS_URL;
    while (nextUrl) {
      if (visitedUrls.has(nextUrl)) throw new Error('GitHub pagination repeated a page URL.');
      visitedUrls.add(nextUrl);
      const response = await firstValueFrom(this.http.get<unknown[]>(nextUrl, { observe: 'response' }));
      if (!Array.isArray(response.body)) throw new Error('GitHub returned an invalid pull request page.');
      results.push(...response.body);
      nextUrl = getNextPageUrl(response);
    }
    return results;
  }
}
