import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('scenario graph core architecture', () => {
  it('keeps domain and application modules free of framework and browser dependencies', () => {
    const sources = [
      readFileSync(fileURLToPath(new URL('../domain/scenario-graph.ts', import.meta.url)), 'utf8'),
      readFileSync(fileURLToPath(new URL('./scenario-graph-editor.ts', import.meta.url)), 'utf8'),
    ];
    const combined = sources.join('\n');

    expect(combined, 'the graph core must not import UI frameworks, RxJS, DOM or SVG libraries').not.toMatch(/from\s+['"](?:@angular|react|vue|rxjs|@syncfusion|d3|jointjs)/);
    expect(combined, 'the graph core must not access browser globals or DOM types').not.toMatch(/\b(?:window|document|navigator|HTMLElement|SVGElement|SVGSVGElement|localStorage|sessionStorage)\b/);
    expect(combined, 'the graph core must not depend on wall-clock, randomness or browser network APIs').not.toMatch(/\b(?:Date\.now|Math\.random|fetch\s*\()/);
  });
});
