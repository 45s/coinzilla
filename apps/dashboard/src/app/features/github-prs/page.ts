import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { GitHubPullRequestsApi } from './api';
import { formatRelativeCommitTime, type GitHubPullRequest } from './model';
import {
  assignLabel,
  EMPTY_LABEL_STORE,
  createLabel,
  deleteLabel,
  LABEL_COLORS,
  loadLabelStore,
  renameLabel,
  saveLabelStore,
  unassignLabel,
  updateLabelColor,
  type LabelColor,
  type LabelStore,
  type LabelStoreStatus,
} from './label-store';

@Component({
  selector: 'app-github-prs',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitHubPullRequestsComponent implements OnInit, OnDestroy {
  private readonly api = inject(GitHubPullRequestsApi);
  private refreshInFlight = false;
  private relativeTimeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly storage = this.getBrowserStorage();
  private readonly initialLabelState = loadLabelStore(this.storage);

  readonly pullRequests = signal<readonly GitHubPullRequest[]>([]);
  readonly mergedPullRequests = signal<readonly GitHubPullRequest[]>([]);
  readonly mergedError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly stale = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly rateLimitReset = signal<string | null>(null);
  readonly lastSuccessfulRefresh = signal<number | null>(null);
  readonly clock = signal(Date.now());
  readonly labels = signal<LabelStore>(this.initialLabelState.store);
  readonly labelStoreStatus = signal<LabelStoreStatus>(this.initialLabelState.status);
  readonly labelColors = LABEL_COLORS;
  readonly newLabelName = signal('');
  readonly newLabelColor = signal<LabelColor>('blue');
  readonly labelError = signal<string | null>(null);
  readonly hasSnapshot = computed(() => this.lastSuccessfulRefresh() !== null);
  readonly labelEditingEnabled = computed(() => this.labelStoreStatus() === 'ready');
  readonly unavailableCommitCount = computed(() =>
    this.pullRequests().filter((pullRequest) => pullRequest.lastCommit.status === 'unavailable').length,
  );

  ngOnInit(): void {
    void this.refresh();
    this.relativeTimeTimer = setInterval(() => this.clock.set(Date.now()), 60_000);
  }

  ngOnDestroy(): void {
    if (this.relativeTimeTimer !== null) clearInterval(this.relativeTimeTimer);
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    this.refreshing.set(true);
    this.loading.set(!this.hasSnapshot());
    this.errorMessage.set(null);
    try {
      const snapshot = await this.api.loadOpenPullRequests();
      try {
        const merged = await this.api.loadMergedPullRequests();
        this.mergedPullRequests.set(merged.pullRequests.slice(0, 5));
        this.mergedError.set(null);
      } catch (mergedError) {
        this.mergedError.set(mergedError instanceof Error ? mergedError.message : 'Merged PR history unavailable.');
      }
      if (snapshot.rateLimitReset && this.hasSnapshot()) {
        this.rateLimitReset.set(snapshot.rateLimitReset);
        this.stale.set(true);
        this.errorMessage.set('GitHub rate limit reached. The previous complete snapshot is preserved.');
      } else {
        this.pullRequests.set(snapshot.pullRequests);
        this.rateLimitReset.set(snapshot.rateLimitReset);
        this.stale.set(false);
        this.lastSuccessfulRefresh.set(Date.now());
      }
    } catch (error) {
      this.stale.set(this.hasSnapshot());
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
      this.refreshInFlight = false;
    }
  }

  resetLabels(): void { this.applyLabelChange(() => EMPTY_LABEL_STORE); }

  async copyTitle(title: string): Promise<void> { await this.copyText(title); }
  async copyBranch(branch: string): Promise<void> { await this.copyText(branch); }

  private async copyText(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); }
    catch { this.errorMessage.set('Clipboard access failed. Select and copy the text manually.'); }
  }

  relativeTime(timestamp: string | null): string {
    return formatRelativeCommitTime(timestamp, this.clock());
  }

  labelsFor(pullRequest: GitHubPullRequest) {
    const assignedIds = this.labels().assignments['45s/coinzilla#' + pullRequest.number] ?? [];
    return this.labels().labels.filter((label) => assignedIds.includes(label.id));
  }

  isAssigned(pullRequest: GitHubPullRequest, labelId: string): boolean {
    return (this.labels().assignments['45s/coinzilla#' + pullRequest.number] ?? []).includes(labelId);
  }

  createNewLabel(): void {
    this.labelError.set(null);
    try {
      const next = createLabel(this.labels(), this.newLabelName(), this.newLabelColor());
      if (this.persistLabels(next)) this.newLabelName.set('');
    } catch (error) {
      this.labelError.set(error instanceof Error ? error.message : 'Label could not be created.');
    }
  }

  renameExistingLabel(id: string, name: string): void {
    this.applyLabelChange(() => renameLabel(this.labels(), id, name));
  }

  recolorExistingLabel(id: string, color: string): void {
    this.applyLabelChange(() => updateLabelColor(this.labels(), id, color as LabelColor));
  }

  removeLabel(id: string): void {
    this.applyLabelChange(() => deleteLabel(this.labels(), id));
  }

  toggleLabel(pullRequest: GitHubPullRequest, labelId: string, checked: boolean): void {
    const key = '45s/coinzilla#' + pullRequest.number;
    this.applyLabelChange(() => checked
      ? assignLabel(this.labels(), key, labelId)
      : unassignLabel(this.labels(), key, labelId));
  }

  private applyLabelChange(change: () => LabelStore): void {
    this.labelError.set(null);
    try {
      this.persistLabels(change());
    } catch (error) {
      this.labelError.set(error instanceof Error ? error.message : 'Label change could not be applied.');
    }
  }

  private persistLabels(next: LabelStore): boolean {
    if (!this.labelEditingEnabled()) {
      this.labelError.set('Local labels are read-only because browser storage is unavailable or invalid.');
      return false;
    }
    if (!saveLabelStore(this.storage, next)) {
      this.labelStoreStatus.set('save-failed');
      this.labelError.set('Could not save labels to browser storage. Your previous saved labels were kept.');
      return false;
    }
    this.labels.set(next);
    return true;
  }

  private getBrowserStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const retryAfter = error.headers.get('Retry-After');
      const isRateLimited = error.status === 429 || retryAfter !== null
        || (error.status === 403 && error.headers.get('X-RateLimit-Remaining') === '0');
      if (isRateLimited) {
        const reset = error.headers.get('X-RateLimit-Reset');
        if (reset && /^\d+$/.test(reset)) {
          const timestamp = Number(reset) * 1000;
          if (Number.isFinite(new Date(timestamp).getTime())) {
            this.rateLimitReset.set(new Date(timestamp).toISOString());
          }
        }
        return 'GitHub rate limit reached. Wait for the reset time before refreshing.';
      }
    }
    return error instanceof Error ? error.message : 'GitHub data could not be loaded.';
  }
}
