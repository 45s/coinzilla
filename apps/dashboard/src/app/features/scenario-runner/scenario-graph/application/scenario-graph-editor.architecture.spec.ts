import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('scenario graph core architecture', () => {
  it('keeps domain and application modules free of framework and browser dependencies', () => {
    const sourcePath = (relativePath: string): string => {
      const pathname = decodeURIComponent(new URL(relativePath, import.meta.url).pathname);
      return pathname.startsWith('/') && /^[A-Za-z]:/.test(pathname.slice(1)) ? pathname.slice(1) : pathname;
    };
    const sources = [
      readFileSync(sourcePath('../domain/scenario-graph.ts'), 'utf8'),
      readFileSync(sourcePath('./scenario-graph-editor.ts'), 'utf8'),
    ];
    const combined = sources.join('\n');

    expect(combined, 'the graph core must not import UI frameworks, RxJS, DOM or SVG libraries').not.toMatch(/from\s+['"](?:@angular|react|vue|rxjs|@syncfusion|d3|jointjs)/);
    expect(combined, 'the graph core must not access browser globals or DOM types').not.toMatch(/\b(?:window|document|navigator|HTMLElement|SVGElement|SVGSVGElement|localStorage|sessionStorage)\b/);
    expect(combined, 'the graph core must not depend on wall-clock, randomness or browser network APIs').not.toMatch(/\b(?:Date\.now|Math\.random|fetch\s*\()/);
  });
});
