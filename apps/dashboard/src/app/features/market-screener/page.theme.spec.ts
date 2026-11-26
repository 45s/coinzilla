import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const marketStyles = readFileSync('src/app/features/market-screener/page.css', 'utf8');

describe('market screener theme contract', () => {
  it('uses active theme tokens for page typography and feature surfaces', () => {
    expect(marketStyles).toContain('color: var(--text);');
    expect(marketStyles).toContain('background: var(--panel-bg);');
    expect(marketStyles).toContain('background: var(--surface-bg);');
    expect(marketStyles).toContain('color: var(--text-soft);');
  });

  it('uses active theme tokens for source, search and movement controls', () => {
    expect(marketStyles).toContain('background: var(--control-bg);');
    expect(marketStyles).toContain('border-color: var(--line);');
    expect(marketStyles).toContain('color: var(--muted);');
  });

  it('does not hardcode the legacy dark panel colors in the Markets stylesheet', () => {
    expect(marketStyles).not.toContain('#111a27');
    expect(marketStyles).not.toContain('#151e2b');
    expect(marketStyles).not.toContain('#141c29');
  });
});
