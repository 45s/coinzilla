import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { createScenarioGraphViewModel } from './application/scenario-graph-editor';
import type { ScenarioGraph } from './domain/scenario-graph';

@Component({
  selector: 'app-scenario-graph-viewer',
  standalone: true,
  templateUrl: './scenario-graph-viewer.component.html',
  styleUrl: './scenario-graph-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioGraphViewerComponent {
  readonly graph = input.required<ScenarioGraph>();
  readonly viewModel = computed(() => {
    const graph = this.graph();
    const orientation = graph.source.kind === 'cg-domain-specification' ? 'tree' : 'vertical';
    return createScenarioGraphViewModel({ graph, orientation });
  });

  edgePath(edge: ReturnType<typeof createScenarioGraphViewModel>['edges'][number]): string {
    const { start, control1, control2, end } = edge.curve;
    return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
  }

  trackNode(_index: number, node: ReturnType<typeof createScenarioGraphViewModel>['nodes'][number]): string {
    return node.id;
  }

  trackEdge(_index: number, edge: ReturnType<typeof createScenarioGraphViewModel>['edges'][number]): string {
    return edge.id;
  }
}
