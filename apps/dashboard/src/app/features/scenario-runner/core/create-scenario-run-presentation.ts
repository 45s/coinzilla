export interface ScenarioRunPresentation {
  readonly rawPayload: unknown;
  readonly identity: {
    readonly runId: string | null;
    readonly strategyId: string | null;
    readonly scenarioId: string | null;
    readonly symbol: string | null;
    readonly venue: string | null;
    readonly executionMode: string | null;
  };
  readonly configuration: unknown;
  readonly steps: readonly {
    readonly id: string;
    readonly kind: string;
    readonly sourceEvidence: unknown;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly label?: string;
  }[];
  readonly orders: readonly Record<string, unknown>[];
  readonly cycle: { readonly status: string };
  readonly outcomes: {
    readonly execution: { readonly status: string };
    readonly assertions: { readonly passed: number; readonly total: number; readonly failed: number } | null;
    readonly safety: Readonly<Record<string, unknown>>;
    readonly provenance: Readonly<Record<string, unknown>>;
  };
}

export function createScenarioRunPresentation(rawPayload: unknown): ScenarioRunPresentation {
  void rawPayload;
  throw new Error('Scenario run presentation adapter is not implemented.');
}
