# Markdown style standard

- Status: Accepted
- Type: Repository documentation standard
- Owner: Repository engineering
- Effective: 2026-11-09
- Canonical policy: [Documentation Governance](DOCUMENTATION_GOVERNANCE.md)
- Tracking: [#795](https://github.com/45s/coinzilla/issues/795)

## Purpose

Use one predictable Markdown style across repository documentation without sacrificing readability, technical precision, historical fidelity or useful source formatting.

This standard applies to maintained repository-authored `.md` and `.mdx` files. Generated content, vendored material, raw evidence exports and historical snapshots should not be mechanically reformatted. When editing those files, preserve their source structure unless a specific defect makes a narrow correction necessary.

## Formatting rules

### File structure

- Use UTF-8 text, LF line endings and one final newline.
- Do not leave trailing spaces or tabs in prose.
- Use one blank line between paragraphs, headings, lists, blockquotes, tables and fenced code blocks.
- Do not add repeated blank lines for visual spacing.
- Start a document with one descriptive level-one heading. Use subsequent heading levels in order; do not skip levels.
- Keep headings concise and descriptive. Use sentence case unless a proper name or established technical term requires otherwise.
- Do not use heading levels only to change visual size.

### Paragraphs and lists

- Prefer concise paragraphs focused on one idea.
- Use `-` for unordered lists consistently within a document.
- Use ordered lists for sequences, procedures and ranked steps.
- Indent nested list content consistently by two spaces per level.
- Keep list items grammatically parallel where practical.
- Use task-list checkboxes only for actionable work with a clear owner or completion condition; do not use them as decoration.
- Avoid manual line wrapping in prose. Wrap only where it improves source review, such as long command examples or structured data.

### Code and commands

- Use fenced code blocks for multi-line examples and include a language identifier whenever one is known.
- Use inline code for paths, commands, identifiers, configuration keys, environment variables and literal values.
- Keep examples executable and verify commands, paths, options and expected output against the current repository.
- Do not reformat code, JSON, YAML, shell commands or captured output in ways that change meaning.
- Use placeholders for secrets and credentials; never include real credentials in examples.

### Tables

- Use tables for compact comparisons or genuinely tabular data, not for long prose or nested procedures.
- Include a header row and delimiter row.
- Keep column order and alignment consistent within a document.
- Keep cell content concise; move detailed explanations into prose or linked documents.
- Do not force wide tables into a single line at the expense of source readability.

### Links and references

- Use descriptive link text that makes sense out of context.
- Prefer relative links for files within this repository.
- Link to the canonical living document instead of copying its rules or status.
- Preserve historical issue, pull-request, commit and evidence references.
- Check local paths and anchors when adding or changing links. External URL availability must be treated separately because remote sites can be transient or rate-limited.

### Metadata and diagrams

- Follow the metadata and lifecycle rules in [Documentation Governance](DOCUMENTATION_GOVERNANCE.md#6-metadata-and-document-lifecycle); do not add front matter mechanically to every file.
- Use Mermaid or another established text-based diagram format for diagrams where it improves understanding, and keep diagrams synchronized with the described behavior.
- Provide a text explanation or equivalent where a diagram alone would hide important decisions or constraints.

## Review checklist

Before merging a meaningful Markdown change, verify:

- [ ] The document has a clear purpose, owner and authority boundary.
- [ ] Heading hierarchy and spacing are consistent.
- [ ] Lists, tables and code fences are structurally valid.
- [ ] Commands, paths, examples and links are accurate.
- [ ] The canonical source is linked instead of duplicated.
- [ ] Historical evidence and provenance are preserved.
- [ ] The nearest documentation index and affected roadmaps are synchronized.
- [ ] The repository Markdown structure and internal-link checks pass.

## Tooling status

The required JavaScript Syntax workflow enforces balanced fenced-code delimiters and recursive local-path link validation through the agent-policy check. It also runs a **report-only** local heading-anchor baseline for same-file and cross-file Markdown/MDX fragments, including GitHub-style duplicate slugs, Setext headings and explicit HTML anchors. Historical documents remain included; external URLs, non-Markdown targets, code examples and text fragments are excluded. Unresolved anchors are reported but do not fail CI. The workflow also runs `scripts/markdown-style-baseline.js` as a **report-only** formatting measurement; neither report fails on existing findings or rewrites files.

For pull requests, the same required workflow runs the [changed-file style checker](../scripts/check-markdown-style.js) and its [tests](../scripts/check-markdown-style.test.js) against changed maintained Markdown/MDX. On existing files, line-level findings are enforced only in changed hunks and two lines of context; missing final newlines and CRLF are checked at file level. Newly added files are checked in full. This prevents unrelated pre-existing formatting or historical sections elsewhere in an edited file from forcing a mass reformat. Known historical evidence paths are explicitly excluded, and GitHub issue/PR templates are exempt from heading-only rules; both exceptions are covered by tests. The full-tree baseline remains informational, and this changed-line guard is not a full-repository Markdown linter.

The 2026-11-10 formatting baseline covers 113 tracked Markdown/MDX files in the PR #886 merge-preview tree (`d07ee71e1b754c9539d53fc9c32f72e5b7d89f3c`): 24 files / 123 trailing-whitespace occurrences, 0 files missing a final newline, 0 CRLF files, 49 files / 381 repeated-blank-line occurrences, 2 files without an H1, 1 file with multiple H1 headings (11 headings), 4 files / 5 heading-level skips, and 0 files with unlabeled fenced-code blocks. The earlier PR #876 measurement (27 / 127 trailing whitespace; 50 / 383 repeated blank lines; other counts unchanged) and the 2026-11-09 112-file measurement (28 / 128 trailing whitespace; 2 missing final newlines; 51 / 385 repeated blank lines; other counts unchanged) are historical checkpoints. The prose whitespace metrics exclude fenced-code contents. These are measurements, not a blanket violation list: the scan includes historical evidence and GitHub templates, and it does not distinguish intentional Markdown hard-break syntax. Preserve historical snapshots and review the maintained-document scope before enabling broader enforcement.

A full-repository Markdown linter remains an evaluation item under [#795](https://github.com/45s/coinzilla/issues/795). External URL checking is implemented by `scripts/check-external-links.js` and runs in the separate advisory **External Documentation Links** workflow. PR checks inspect changed maintained Markdown/MDX; weekly/manual runs scan the full `develop` tree in report-only mode, including historical evidence. The workflow is not a required status context. Heading-anchor validation is currently report-only and is not an enforcement gate. Do not claim that all style rules are automatically enforced; only the changed-file rules listed above are enforced in the required workflow.

### External URL reliability policy

The external-link checker scans HTTP(S) destinations in Markdown/MDX inline links, reference definitions, autolinks, and bare prose URLs. It removes fenced/inline code and HTML comments, deduplicates requests by URL without fragments, and retains source paths for findings. It does not rewrite links.

- **Pull-request scope:** inspect only changed maintained Markdown/MDX files. Malformed HTTP(S) destinations and credential-bearing URLs are invalid. A URL is classified as broken only when a GET request confirms HTTP 404 or 410; a HEAD 404/410 is followed by GET confirmation. A HEAD method that is unsupported or blocked falls back to a ranged GET.
- **Full-tree scope:** scheduled/manual reports include historical documents but are report-only. Historical evidence is never mass-edited or used as a changed-document failure gate.
- **Request limits:** 10-second timeout per request; at most two retries (three attempts) for network errors and HTTP 408/425/429/5xx; exponential backoff starting at 500 ms; honor `Retry-After` up to 30 seconds; at most five redirects; four host groups concurrently; one request per host at a time with a 500 ms minimum interval between request starts.
- **Classification:** 2xx is successful. Only GET-confirmed 404/410 is broken. Authentication/anti-bot responses (401/403), rate limits, server failures, timeouts, network errors, and unusable redirects are unverifiable and do not fail the changed-document check. Local-only hostnames and all IP-literal hosts are skipped. URLs containing credentials are invalid and are never requested.
- **Security and merge policy:** no cookies, authorization headers, repository secrets, or exchange credentials are sent. The **External Documentation Links** workflow is not a required `develop-core` status context; a confirmed broken link is actionable feedback, not a branch-protection bypass or automatic merge blocker.
