import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubPullRequestsApi } from './api';
import { GitHubPullRequestsComponent } from './page';

const snapshot = {
  pullRequests: [{
    repository: '45s/coinzilla' as const,
    number: 1824,
    title: 'Add the GitHub dashboard',
    htmlUrl: 'https://github.com/45s/coinzilla/pull/1824',
    isDraft: true,
    headSha: 'a'.repeat(40),
    lastCommit: { status: 'available' as const, sha: 'a'.repeat(40), committerDate: new Date(Date.now() - 4 * 60_000).toISOString() },
  }],
  rateLimitReset: null,
};

describe('GitHubPullRequestsComponent', () => {
  let fixture: ComponentFixture<GitHubPullRequestsComponent>;
  let loadOpenPullRequests: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    window.localStorage.removeItem('coinzilla.dashboard.github-pr-labels.v1');
    loadOpenPullRequests = vi.fn().mockResolvedValue(snapshot);
    await TestBed.configureTestingModule({
      imports: [GitHubPullRequestsComponent],
      providers: [{ provide: GitHubPullRequestsApi, useValue: { loadOpenPullRequests } }],
    }).compileComponents();
    fixture = TestBed.createComponent(GitHubPullRequestsComponent);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    window.localStorage.removeItem('coinzilla.dashboard.github-pr-labels.v1');
    vi.restoreAllMocks();
  });

  it('Scenario 01/02/03 — renders open PR link, title, draft state and exact committer time', () => {
    const root = fixture.nativeElement as HTMLElement;
    const link = root.querySelector('a[href="https://github.com/45s/coinzilla/pull/1824"]') as HTMLAnchorElement;
    expect(link).toBeDefined();
    expect(link.textContent).toContain('#1824');
    expect(root.textContent).toContain('Add the GitHub dashboard');
    expect(root.textContent).toContain('Draft');
    expect(root.textContent).toContain('4 min ago');
    expect(root.querySelector('time')?.getAttribute('datetime')).toBe(snapshot.pullRequests[0].lastCommit.committerDate);
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it('Scenario 09/10/11/15 — creates, directly assigns and persists local labels without another GitHub request', () => {
    const root = fixture.nativeElement as HTMLElement;
    const name = root.querySelector('.label-create input') as HTMLInputElement;
    name.value = 'Codex';
    name.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.label-create button')?.click();
    fixture.detectChanges();

    const assignment = root.querySelector<HTMLButtonElement>('.assignment-chip');
    expect(assignment).toBeDefined();
    assignment?.click();
    fixture.detectChanges();

    expect(assignment?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Codex');
    expect(JSON.parse(window.localStorage.getItem('coinzilla.dashboard.github-pr-labels.v1') ?? '{}').assignments)
      .toEqual({ '45s/coinzilla#1824': [expect.any(String)] });
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it('allows label names and colors to be edited directly without a separate rename action', () => {
    const root = fixture.nativeElement as HTMLElement;
    const name = root.querySelector('.label-create input') as HTMLInputElement;
    name.value = 'Codex';
    name.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.label-create button')?.click();
    fixture.detectChanges();

    const renameInput = root.querySelector<HTMLInputElement>('.label-name-input');
    expect(renameInput).toBeDefined();
    if (!renameInput) return;
    renameInput.value = 'Review';
    renameInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('[aria-label="Set green color for Review"]')?.click();
    fixture.detectChanges();

    expect(root.querySelector<HTMLInputElement>('.label-name-input')?.value).toBe('Review');
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Set green color for Review"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.assignment-editor')).toBeNull();
    expect(root.querySelector('.delete-label-button')?.getAttribute('aria-label')).toBe('Delete Review');
  });

  it('keeps a refresh action available in the viewport while browsing the PR list', () => {
    const root = fixture.nativeElement as HTMLElement;
    const refresh = root.querySelector<HTMLButtonElement>('.floating-refresh-button');
    expect(refresh).toBeDefined();
    refresh?.click();
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(2);
  });

  it('Scenario 17 — displays the explicit empty state when no open PRs exist', async () => {
    loadOpenPullRequests.mockResolvedValueOnce({ pullRequests: [], rateLimitReset: null });
    await fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No open Pull Requests found.');
    expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
  });

  it('Scenario 18 — displays a retryable error when the initial PR request fails', async () => {
    fixture.destroy();
    loadOpenPullRequests.mockRejectedValueOnce(new Error('GitHub unavailable'));
    fixture = TestBed.createComponent(GitHubPullRequestsComponent);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('GitHub PRs are unavailable');
    expect(fixture.nativeElement.textContent).toContain('GitHub unavailable');
    expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
  });

  it('Scenario 19 — retains a previous complete snapshot when refresh fails', async () => {
    loadOpenPullRequests.mockRejectedValueOnce(new Error('GitHub is unavailable'));
    await fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('STALE SNAPSHOT');
    expect(fixture.nativeElement.textContent).toContain('Add the GitHub dashboard');
    expect(fixture.nativeElement.textContent).toContain('GitHub is unavailable');
  });

  it('Scenario 21 — preserves the previous complete snapshot when commit metadata is rate-limited', async () => {
    const changedSnapshot = {
      pullRequests: [{ ...snapshot.pullRequests[0], title: 'New but rate-limited snapshot' }],
      rateLimitReset: 'unknown',
    };
    loadOpenPullRequests.mockResolvedValueOnce(changedSnapshot);
    await fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('STALE SNAPSHOT');
    expect(fixture.nativeElement.textContent).toContain('Add the GitHub dashboard');
    expect(fixture.nativeElement.textContent).not.toContain('New but rate-limited snapshot');
    expect(fixture.nativeElement.textContent).toContain('GitHub rate limit reached');
  });

  it('Scenario 23 — relative time advances locally without another GitHub request', () => {
    const callsBeforeClockUpdate = loadOpenPullRequests.mock.calls.length;
    const fiveMinutesAfterCommit = Date.parse(snapshot.pullRequests[0].lastCommit.committerDate) + 5 * 60_000;
    fixture.componentInstance.clock.set(fiveMinutesAfterCommit);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('5 min ago');
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(callsBeforeClockUpdate);
  });

  it('Scenario 24 — ignores repeated refresh while a request is already in flight', async () => {
    let resolvePending: (value: typeof snapshot) => void = () => undefined;
    loadOpenPullRequests.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
    const first = fixture.componentInstance.refresh();
    const second = fixture.componentInstance.refresh();

    expect(loadOpenPullRequests).toHaveBeenCalledTimes(2);
    resolvePending(snapshot);
    await Promise.all([first, second]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Add the GitHub dashboard');
  });

  it('Scenario 22 — does not overwrite malformed browser storage', async () => {
    fixture.destroy();
    window.localStorage.setItem('coinzilla.dashboard.github-pr-labels.v1', '{broken');
    fixture = TestBed.createComponent(GitHubPullRequestsComponent);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.labelStoreStatus()).toBe('invalid');
    expect(window.localStorage.getItem('coinzilla.dashboard.github-pr-labels.v1')).toBe('{broken');
    expect(fixture.nativeElement.textContent).toContain('It has not been overwritten');
  });
});
