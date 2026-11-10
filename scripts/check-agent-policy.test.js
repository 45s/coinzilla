import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInstructionDirectories, findMarkdownDocuments, findMissingLocalAnchors, findMissingLocalLinks, findMissingRequiredDocuments, findMissingRoadmaps, findOwnershipGaps, findUnbalancedMarkdownFences } from './check-agent-policy.js';

const ownershipRow = (path) => `| Domain | \`${path}/\` | Responsibility |\n`;

test('accepts complete, unique ownership maps', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(findOwnershipGaps([directory], ownershipRow(directory)), []);
});

test('reports missing ownership entries', () => {
  assert.deepEqual(findOwnershipGaps(['packages/new-domain'], ''), [
    'packages/new-domain missing from DOMAIN_OWNERSHIP.md',
  ]);
});

test('detects duplicate ownership rows', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow(directory)),
    ['apps/harvester appears more than once in DOMAIN_OWNERSHIP.md'],
  );
});

test('detects stale ownership rows without a matching AGENTS.md', () => {
  const directory = 'apps/harvester';
  assert.deepEqual(
    findOwnershipGaps([directory], ownershipRow(directory) + ownershipRow('apps/retired-app')),
    ['apps/retired-app in DOMAIN_OWNERSHIP.md has no matching AGENTS.md'],
  );
});

test('recursively discovers nested domain instruction files', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-policy-'));
  try {
    mkdirSync(join(root, 'apps', 'harvester', 'strategies'), { recursive: true });
    mkdirSync(join(root, 'packages', 'entities'), { recursive: true });
    writeFileSync(join(root, 'apps', 'harvester', 'strategies', 'AGENTS.md'), '# nested');
    writeFileSync(join(root, 'packages', 'entities', 'AGENTS.md'), '# package');
    assert.deepEqual(findInstructionDirectories(root), [
      'apps/harvester/strategies',
      'packages/entities',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('checks inline and reference-style local links while ignoring external links, code and HTML comments', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-links-'));
  try {
    mkdirSync(join(root, 'docs', 'audits'), { recursive: true });
    writeFileSync(join(root, 'docs', 'existing.md'), '# Existing');
    writeFileSync(join(root, 'docs', 'with space.md'), '# Spaced');
    const inlineCode = String.fromCharCode(96) + '[inline example](missing-inline.md)' + String.fromCharCode(96);
    const gaps = findMissingLocalLinks(root, [
      {
        path: 'docs/policy.md',
        content: [
          '[valid](existing.md) [angle path](<with space.md>) [broken](missing.md)',
          '[external](https://example.com) [anchor](#section)',
          '[valid reference][good] [missing reference][bad]',
          '[good]: existing.md',
          '[bad]: missing-reference.md',
          '[angle reference]: <missing path.md>',
          '[external reference]: https://example.com/docs',
          '[^footnote]: footnote text, not a link destination',
          '<!-- [comment](missing-comment.md) -->',
          '~~~md',
          '[code example](missing-in-code.md)',
          '~~~',
          inlineCode,
        ].join('\n'),
      },
      {
        path: 'docs/audits/old.md',
        content: '[historical reference]: missing-historical.md',
      },
    ]);

    assert.deepEqual(gaps, [
      'docs/audits/old.md links to missing path missing-historical.md',
      'docs/policy.md links to missing path missing.md',
      'docs/policy.md links to missing path missing-reference.md',
      'docs/policy.md links to missing path missing path.md',
    ], 'reference definitions and historical documents remain covered; code/comments do not');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports malformed percent-encoded local paths without throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-malformed-path-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    const gaps = findMissingLocalLinks(root, [{
      path: 'docs/policy.md',
      content: '[malformed](bad%ZZ.md)',
    }]);
    assert.deepEqual(gaps, [
      'docs/policy.md has malformed URL-encoded local link path "bad%ZZ.md"',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects missing same-file and cross-file heading anchors with GitHub-style slugs', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-heading-anchors-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'source.md'), '# Source');
    writeFileSync(join(root, 'docs', 'target.md'), '## Repeated\n\n## Repeated\n\nUnderlined Heading\n------------------\n\n<a id="custom-anchor"></a>\n\n## Café &amp; tea!\n\n## First — second\n\n## 2026-11-07/08 session audit — issue #667');
    writeFileSync(join(root, 'docs', 'asset.png'), '');

    const documents = [
      {
        path: 'docs/source.md',
        content: [
          '# Source',
          '',
          '[valid same-file](#source) [missing same-file](#missing)',
          '[duplicate](target.md#repeated-1) [setext](target.md#underlined-heading)',
          '[custom](target.md#custom-anchor) [unicode](target.md#café--tea)',
          '[dash punctuation](target.md#first--second) [dated slash](target.md#2026-11-0708-session-audit--issue-667)',
          '[missing target](target.md#absent)',
          '[external](https://example.com#external) [asset](asset.png#not-a-heading)',
          '',
          '```md',
          '[code example](#ignored)',
          '```',
          '',
          '`[inline example](#ignored-inline)`',
        ].join('\n'),
      },
      {
        path: 'docs/target.md',
        content: '## Repeated\n\n## Repeated\n\nUnderlined Heading\n------------------\n\n<a id="custom-anchor"></a>\n\n## Café &amp; tea!\n\n## First — second\n\n## 2026-11-07/08 session audit — issue #667',
      },
    ];

    assert.deepEqual(findMissingLocalAnchors(root, documents), [
      'docs/source.md links to missing heading anchor "#absent" in docs/target.md',
      'docs/source.md links to missing heading anchor "#missing" in docs/source.md',
    ], 'only unresolved local Markdown fragments should be reported in stable sorted order');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates reference-style heading fragments and ignores HTML-comment references', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-reference-heading-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'target.md'), '## Present');
    const gaps = findMissingLocalAnchors(root, [
      {
        path: 'docs/source.md',
        content: [
          '[valid reference][present]',
          '[missing reference][absent]',
          '[present]: target.md#present',
          '[absent]: target.md#missing',
          '<!-- [comment]: target.md#comment -->',
        ].join('\n'),
      },
      {
        path: 'docs/target.md',
        content: '## Present',
      },
    ]);

    assert.deepEqual(gaps, [
      'docs/source.md links to missing heading anchor "#missing" in docs/target.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports malformed percent-encoded local paths during anchor validation without throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-heading-path-encoding-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    assert.deepEqual(findMissingLocalAnchors(root, [{
      path: 'docs/source.md',
      content: '[malformed](bad%ZZ.md#section)',
    }]), [
      'docs/source.md has malformed URL-encoded local link path "bad%ZZ.md"',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports malformed percent-encoded heading fragments without throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-heading-encoding-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'source.md'), '# Source');
    assert.deepEqual(findMissingLocalAnchors(root, [{
      path: 'docs/source.md',
      content: '[malformed](#bad%ZZ)',
    }]), [
      'docs/source.md has malformed URL-encoded heading fragment "#bad%ZZ"',
    ], 'malformed fragments should be reported as a controlled validation finding');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('includes archived Markdown documents in the report-only anchor inventory', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-historical-heading-'));
  try {
    mkdirSync(join(root, 'docs', 'audits'), { recursive: true });
    writeFileSync(join(root, 'docs', 'audits', 'old.md'), '# Archived');
    assert.deepEqual(findMissingLocalAnchors(root, [{
      path: 'docs/audits/old.md',
      content: '# Archived\n\n[stale](#removed-section)',
    }]), [
      'docs/audits/old.md links to missing heading anchor "#removed-section" in docs/audits/old.md',
    ], 'historical documents remain visible in the baseline rather than being silently omitted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a roadmap for each domain in the ownership map', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-agent-roadmaps-'));
  try {
    mkdirSync(join(root, 'apps', 'harvester'), { recursive: true });
    mkdirSync(join(root, 'packages', 'entities'), { recursive: true });
    writeFileSync(join(root, 'apps', 'harvester', 'ROADMAP.md'), '# Roadmap');
    const ownership = ownershipRow('apps/harvester') + ownershipRow('packages/entities');
    assert.deepEqual(findMissingRoadmaps(root, ownership), [
      'packages/entities is missing ROADMAP.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('discovers Markdown and MDX recursively while ignoring generated directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-markdown-files-'));
  try {
    mkdirSync(join(root, 'docs', 'nested'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'dependency'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# root');
    writeFileSync(join(root, 'docs', 'nested', 'index.mdx'), '# nested');
    writeFileSync(join(root, 'node_modules', 'dependency', 'README.md'), '# ignored');
    writeFileSync(join(root, 'dist', 'generated.md'), '# ignored');
    assert.deepEqual(
      findMarkdownDocuments(root).map(({ path }) => path),
      ['docs/nested/index.mdx', 'README.md'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports missing required documentation entry points', () => {
  const root = mkdtempSync(join(tmpdir(), 'coinzilla-required-docs-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'README.md'), '# index');
    assert.deepEqual(
      findMissingRequiredDocuments(root, ['docs/README.md', 'docs/DOCUMENTATION_GOVERNANCE.md']),
      ['Required documentation file is missing: docs/DOCUMENTATION_GOVERNANCE.md'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('reports an unclosed backtick fence with its source line', () => {
  assert.deepEqual(findUnbalancedMarkdownFences([{
    path: 'docs/broken.md',
    content: '# Heading\n\n```sh\npnpm test\n',
  }]), [
    'docs/broken.md has an unclosed ``` fence opened at line 3',
  ]);
});

test('accepts tilde fences and closing fences longer than their opener', () => {
  assert.deepEqual(findUnbalancedMarkdownFences([{
    path: 'docs/valid.md',
    content: '~~~md\n```js\n~~~\n\n````text\ncode\n`````\n',
  }]), []);
});

test('does not allow a mismatched fence character to close a block', () => {
  assert.deepEqual(findUnbalancedMarkdownFences([{
    path: 'docs/mismatch.md',
    content: '~~~js\n```\n',
  }]), [
    'docs/mismatch.md has an unclosed ~~~ fence opened at line 1',
  ]);
});
