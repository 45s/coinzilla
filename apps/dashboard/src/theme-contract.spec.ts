import { describe, expect, it } from 'vitest';

import rawDashboardStyles from './styles.css?raw';

const dashboardStyles = JSON.stringify(rawDashboardStyles) ?? '';

describe('dashboard theme surface contract', () => {
  it('maps feature surface aliases to the active palette tokens', () => {
    const aliases = dashboardStyles.match(
      /html\[data-theme\]:not\(\[data-theme="current"\]\):not\(\[data-theme="staradmin"\]\)\s*\{([^}]*)\}/,
    )?.[1];

    expect(aliases).toContain('--surface: var(--surface-bg);');
    expect(aliases).toContain('--surface-raised: var(--raised-bg);');
    expect(aliases).toContain('--border: var(--line);');
  });

  it('keeps System feature surfaces aligned with both OS color schemes', () => {
    const darkSystem = dashboardStyles.match(
      /html\[data-theme="system"\]\s*\{([^}]*)\}/,
    )?.[1];
    const lightSystem = dashboardStyles.match(
      /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*html\[data-theme="system"\]\s*\{([^}]*)\}/,
    )?.[1];

    expect(darkSystem).toContain('--panel-bg: #111a27;');
    expect(darkSystem).toContain('color-scheme: dark;');
    expect(lightSystem).toContain('--panel-bg: #ffffff;');
    expect(lightSystem).toContain('--text: #182335;');
    expect(lightSystem).toContain('color-scheme: light;');
  });

  it('keeps native select controls readable in the selected palette', () => {
    expect(dashboardStyles).toContain('html[data-theme]:not([data-theme="current"]) select,');
    expect(dashboardStyles).toContain('background: var(--control-bg);');
    expect(dashboardStyles).toContain('color: var(--text);');
  });

  it('applies shared panel surfaces to GitHub PR summaries and tables', () => {
    expect(dashboardStyles).toContain('html[data-theme]:not([data-theme="current"]) .summary-strip');
    expect(dashboardStyles).toContain('html[data-theme]:not([data-theme="current"]) .table-scroll');
  });
});
