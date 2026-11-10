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
- Use `-` for every unordered-list marker; do not use `*` or `+` as list markers.
- Use ordered lists for sequences, procedures and ranked steps.
- Indent nested list items and continuation content by exactly two spaces per level; do not use tabs.
- Separate list blocks from adjacent paragraphs, headings, tables and fenced code blocks with one blank line. Blank lines inside a loose list are allowed.
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
- Include a header row and delimiter row; every delimiter cell must contain at least three hyphens, with optional leading/trailing colons for alignment.
- Keep the same number of cells in the header, delimiter and every data row.
- Separate table blocks from adjacent paragraphs, headings, lists and fenced code blocks with one blank line.
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

The required JavaScript Syntax workflow enforces balanced fenced-code delimiters and recursive local-path link validation through the agent-policy check. It also runs a **report-only** local heading-anchor baseline for same-file and cross-file Markdown/MDX fragments, including GitHub-style duplicate slugs, Setext headings and explicit HTML anchors. Historical documents remain included; external URLs, non-Markdown targets, code examples and text fragments are excluded. Unresolved anchors are reported but do not fail CI. The workflow also runs `scripts/markdown-style-baseline.js` as a **report-only** formatting measurement; neither report fails on existing findings or rewrites files. The formatting baseline measures whitespace, heading structure, fenced-code labels, unordered-list markers, nested-list indentation, list-block spacing, table delimiters, table column counts, and table-block spacing. The six list/table findings are report-only while the full-tree baseline and false-positive scope are reviewed; they are not yet part of changed-file enforcement.

For pull requests, the same required workflow runs the [changed-file style checker](../scripts/check-markdown-style.js) and its [tests](../scripts/check-markdown-style.test.js) against changed maintained Markdown/MDX. On existing files, line-level findings are enforced only in changed hunks and two lines of context; missing final newlines and CRLF are checked at file level. Newly added files are checked in full. This prevents unrelated pre-existing formatting or historical sections elsewhere in an edited file from forcing a mass reformat. Known historical evidence paths are explicitly excluded, and GitHub issue/PR templates are exempt from heading-only rules; both exceptions are covered by tests. The full-tree baseline remains informational, and this changed-line guard is not a full-repository Markdown linter.

The 2026-11-10 formatting baseline covers 113 tracked Markdown/MDX files in the PR #886 merge-preview tree (`d07ee71e1b754c9539d53fc9c32f72e5b7d89f3c`): 24 files / 123 trailing-whitespace occurrences, 0 files missing a final newline, 0 CRLF files, 49 files / 381 repeated-blank-line occurrences, 2 files without an H1, 1 file with multiple H1 headings (11 headings), 4 files / 5 heading-level skips, and 0 files with unlabeled fenced-code blocks. The earlier PR #876 measurement (27 / 127 trailing whitespace; 50 / 383 repeated blank lines; other counts unchanged) and the 2026-11-09 112-file measurement (28 / 128 trailing whitespace; 2 missing final newlines; 51 / 385 repeated blank lines; other counts unchanged) are historical checkpoints. The prose whitespace metrics exclude fenced-code contents. These are measurements, not a blanket violation list: the scan includes historical evidence and GitHub templates, and it does not distinguish intentional Markdown hard-break syntax. Preserve historical snapshots and review the maintained-document scope before enabling broader enforcement.

A full-repository Markdown linter remains an evaluation item under [#795](https://github.com/45s/coinzilla/issues/795). The external-link checker CLI is implemented by `scripts/check-external-links.js`, with pure IPv4/IPv6 address policy isolated in `scripts/external-link-address-policy.js` and DNS resolution/pinned HTTP(S) transport isolated in `scripts/external-link-network.js`. Its mocked unit tests run in required CI without network access. The separate networked **External Documentation Links** workflow runs changed maintained Markdown/MDX checks on pull requests to `develop`, plus weekly and manual full-tree report-only scans. It is an advisory workflow, not one of the six required `develop-core` contexts. Heading-anchor validation is currently report-only and is not an enforcement gate. Do not claim that all style rules are automatically enforced; only the changed-file rules listed above are enforced in the required workflow.

### External URL reliability policy

The external-link checker scans HTTP(S) destinations in Markdown/MDX inline links, reference definitions, autolinks, and bare prose URLs. It removes fenced/inline code and HTML comments, deduplicates requests by URL without fragments, and retains source paths for findings. It does not rewrite links.

- **Pull-request scope:** the non-required advisory workflow checks only changed maintained Markdown/MDX on pull requests to `develop`. Every candidate hostname is resolved for all A/AAAA answers; the full answer set is rejected if any address is private, shared, reserved, loopback, link-local, multicast, documentation-only, or metadata-related. HTTP(S) sockets use a custom lookup pinned to the validated address set, and each redirect is resolved and pinned independently. Unsafe DNS answers and ineligible redirect targets are skipped without opening a connection. Malformed HTTP(S) destinations, URL userinfo, and credential-like query parameters (for example, `token`, `api_key`, `password`, and signed-URL signatures) are invalid, redacted, and never requested. A URL is classified as broken only when a GET request confirms HTTP 404 or 410; a HEAD 404/410 is followed by GET confirmation. A HEAD method that is unsupported or blocked falls back to a ranged GET, but a GET 404/410 after a HEAD 401/403 remains unverifiable.
- **Full-tree scope:** weekly and manual advisory runs use `--all --report-only` and can include historical documents. Historical evidence is never mass-edited or used as a changed-document failure gate.
- **Request limits:** 10-second timeout per request, including DNS resolution; at most two retries (three attempts) for network errors and HTTP 408/425/429/5xx; exponential backoff starting at 500 ms; honor `Retry-After` up to 30 seconds; at most five redirects; four host groups concurrently; one request per host at a time with a 500 ms minimum interval between request starts.
- **Classification:** 2xx is successful. Only GET-confirmed 404/410 without a preceding HEAD access-control response is broken. An unresolved authentication/anti-bot response (401/403), or a GET 404/410 following HEAD 401/403, remains unverifiable; DNS failures, rate limits, server failures, timeouts, network errors, and other unusable responses are also unverifiable and do not fail the changed-document check. Unsafe DNS answer sets and ineligible redirect targets are skipped and never requested. Local-only hostnames and all IP-literal hosts are skipped. URLs containing credentials are invalid, redacted, and never requested.
- **Security and merge policy:** no cookies, authorization headers, repository secrets, or exchange credentials are sent. The checker validates every resolved address and pins the actual HTTP(S) connection to the vetted set; redirects are independently revalidated. The **External Documentation Links** workflow is advisory and is not a required `develop-core` context. A confirmed broken link is actionable feedback, not a branch-protection bypass or automatic merge blocker.
- **Address-policy maintenance:** the static range policy is maintained against the [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry). It deliberately blocks whole protocol-assignment ranges such as `192.0.0.0/24` and `2001::/23`, including some more-specific globally reachable exceptions, and blocks NAT64/6to4 transition prefixes rather than risking translation to embedded private IPv4 destinations. Review the registry and update both positive and negative tests when IANA assignments change.
