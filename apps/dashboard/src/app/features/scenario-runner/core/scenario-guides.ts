export type ScenarioGuideStepKind = 'start' | 'production-flow' | 'decision' | 'injected-failure' | 'outcome';

export interface ScenarioGuideStep {
  readonly id: string;
  readonly kind: ScenarioGuideStepKind;
  readonly label: string;
  readonly detail: string;
}

export interface ScenarioGuide {
  readonly availability: 'EXECUTABLE' | 'PRELIMINARY';
  readonly purpose: string;
  readonly startingState: string;
  readonly expectedOutcome: string;
  readonly limitations: readonly string[];
  readonly steps: readonly ScenarioGuideStep[];
}

export function getScenarioGuide(_scenarioId: string): ScenarioGuide | null {
  return null;
}
