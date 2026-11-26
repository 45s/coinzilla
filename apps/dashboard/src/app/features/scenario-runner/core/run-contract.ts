export type ScenarioRunStatus =
  | 'Accepted' | 'Queued' | 'Starting' | 'Running' | 'Cancelling'
  | 'Completed' | 'Failed' | 'Cancelled' | 'Timed out' | 'Blocked';

export interface ScenarioRunRecord {
  readonly runId: string;
  readonly strategyId: string;
  readonly scenarioId: string;
  readonly sourceRevision?: string | null;
  readonly replayOfRunId?: string | null;
  readonly status: ScenarioRunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly input: unknown;
  readonly output: unknown;
  readonly diagnostics: readonly string[];
  readonly transitions: readonly { readonly status: ScenarioRunStatus; readonly at: string }[];
}

export interface ScenarioTraceStep {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly eventId?: string;
  readonly inputs?: unknown;
  readonly outputs?: unknown;
  readonly decision?: unknown;
  readonly reason?: string;
  readonly source?: string;
}

export interface ScenarioGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly step: ScenarioTraceStep;
}

export interface ScenarioGraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface ScenarioGraphModel {
  readonly nodes: readonly ScenarioGraphNode[];
  readonly edges: readonly ScenarioGraphEdge[];
}
