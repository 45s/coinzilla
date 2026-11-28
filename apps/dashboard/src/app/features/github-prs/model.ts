export interface GitHubPullRequest {
  readonly repository: '45s/coinzilla';
  readonly number: number;
  readonly title: string;
  readonly headBranch: string;
  readonly mergedAt: string | null;
  readonly htmlUrl: string;
  readonly isDraft: boolean;
  readonly headSha: string;
  readonly lastCommit: {
    readonly status: 'available' | 'unavailable';
    readonly sha: string;
    readonly committerDate: string | null;
  };
}

interface GitHubPullRequestPayload {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly draft?: unknown;
  readonly head?: { readonly sha?: unknown; readonly ref?: unknown } | null;
  readonly merged_at?: unknown;
}

export function normalizePullRequest(payload: GitHubPullRequestPayload): GitHubPullRequest {
  const headSha = payload.head?.sha;
  if (typeof headSha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(headSha)) {
    throw new Error('GitHub pull request has an invalid head SHA.');
  }
  if (!Number.isSafeInteger(payload.number) || (payload.number as number) < 1) {
    throw new Error('GitHub pull request has an invalid number.');
  }
  if (typeof payload.title !== 'string' || typeof payload.html_url !== 'string' || typeof payload.draft !== 'boolean') {
    throw new Error('GitHub pull request is missing its title, canonical URL or draft state.');
  }
  if (!payload.html_url.startsWith('https://github.com/45s/coinzilla/pull/')) {
    throw new Error('GitHub pull request has an unexpected canonical URL.');
  }

  return {
    repository: '45s/coinzilla',
    number: payload.number as number,
    title: payload.title,
    headBranch: typeof payload.head?.ref === 'string' ? payload.head.ref : 'Unavailable',
    mergedAt: typeof payload.merged_at === 'string' ? payload.merged_at : null,
    htmlUrl: payload.html_url,
    isDraft: payload.draft,
    headSha,
    lastCommit: { status: 'unavailable', sha: headSha, committerDate: null },
  };
}

export function formatRelativeCommitTime(timestamp: string | null, now = Date.now()): string {
  if (!timestamp) return 'Unavailable';
  const commitTime = Date.parse(timestamp);
  if (!Number.isFinite(commitTime)) return 'Unavailable';

  const difference = now - commitTime;
  if (difference < 0) return 'in the future';
  if (difference < 60_000) return 'just now';

  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return minutes + ' min ago';

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';

  const days = Math.floor(hours / 24);
  if (days < 30) return days + ' days ago';

  const months = Math.floor(days / 30);
  if (months < 12) return months + ' mo ago';

  return Math.floor(months / 12) + ' yr ago';
}

export async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }

  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as Input, index);
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}
