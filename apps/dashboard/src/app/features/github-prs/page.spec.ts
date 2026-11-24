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

  it('loads open PRs and displays the canonical link, draft marker and commit time', () => {
    const root = fixture.nativeElement as HTMLElement;
    const link = root.querySelector('a[href="https://github.com/45s/coinzilla/pull/1824"]') as HTMLAnchorElement;
    expect(link).toBeDefined();
    expect(link.textContent).toContain('#1824');
    expect(root.textContent).toContain('Add the GitHub dashboard');
    expect(root.textContent).toContain('Draft');
    expect(root.textContent).toContain('4 min ago');
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it('creates and assigns local labels without sending them to GitHub', () => {
    const root = fixture.nativeElement as HTMLElement;
    const name = root.querySelector('.label-create input') as HTMLInputElement;
    name.value = 'Codex';
    name.dispatchEvent(new Event('input'));
    const add = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.includes('Add label'));
    add?.click();
    fixture.detectChanges();

    const assignment = root.querySelector('.assignment-editor summary') as HTMLElement;
    assignment.click();
    fixture.detectChanges();
    const checkbox = root.querySelector('.assignment-option input') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.textContent).toContain('Codex');
    expect(JSON.parse(window.localStorage.getItem('coinzilla.dashboard.github-pr-labels.v1') ?? '{}').assignments)
      .toEqual({ '45s/coinzilla#1824': [expect.any(String)] });
    expect(loadOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it('retains a previous complete snapshot when refresh fails', async () => {
    loadOpenPullRequests.mockRejectedValueOnce(new Error('GitHub is unavailable'));
    const refresh = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Refresh')) as HTMLButtonElement;
    refresh.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('STALE SNAPSHOT');
    expect(fixture.nativeElement.textContent).toContain('Add the GitHub dashboard');
    expect(fixture.nativeElement.textContent).toContain('GitHub is unavailable');
  });
});
