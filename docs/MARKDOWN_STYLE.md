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
- Indent nested list items to the parent item's content column. A one-digit ordered marker such as `1.` typically needs three spaces; an unordered marker such as `-` typically needs two. Apply the same alignment rule at deeper levels and do not use tabs.
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

## Authoring workflow

Use this workflow for every new or edited maintained Markdown/MDX document:

1. **Read this standard before writing.** Also read [Documentation Governance](DOCUMENTATION_GOVERNANCE.md) and the owning domain's instructions.
2. **Write plain Markdown.** Prefer paragraphs and lists over manual visual spacing. Do not add trailing spaces to create a line break; use a paragraph break or a separate list item instead.
3. **Keep source formatting clean.** Every line must end at its final visible character. Do not leave spaces or tabs after prose, links, list markers, table cells, headings or code-fence delimiters. Avoid repeated blank lines.
4. **Structure headings deliberately.** Use one H1 for the document title, then move down one level at a time. Do not use headings merely to make text look larger.
5. **Separate blocks.** Put exactly one blank line between paragraphs and surrounding headings, lists, tables, blockquotes and fenced code blocks. Keep nested list indentation aligned with the parent item's text.
6. **Validate before pushing.** Run the full-tree maintained style and anchor gates:
   `node --test scripts/markdown-path-policy.test.js scripts/check-markdown-style.test.js`
   `node scripts/check-markdown-style.js --all-maintained`
   `node --test scripts/check-maintained-markdown-anchors.test.js`
   `node scripts/check-maintained-markdown-anchors.js`
   For pull requests, also run the changed-file checker with the exact 40-character target base SHA: `node scripts/check-markdown-style.js <target-base-sha>`. Do not substitute a guessed branch name.
7. **Inspect the diff.** Review every changed Markdown line for trailing whitespace, accidental blank lines, broken links, malformed tables and unintended content changes. A local pass does not replace the exact-head GitHub Actions result.

Common CI failure to avoid: a single invisible space at the end of a changed line is enough to fail the required `Check JavaScript syntax` job, even when no JavaScript source changed. That workflow also validates changed Markdown/MDX.

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

The required JavaScript Syntax workflow enforces balanced fenced-code delimiters and recursive local-path link validation through the agent-policy check. The agent-policy command still prints a report-only anchor baseline across all discovered documents; the separate `check-maintained-markdown-anchors.js` gate blocks unresolved local anchors when the source document is maintained and reports historical-source findings without blocking. The gate uses GitHub-compatible duplicate heading slugs, Setext headings and explicit HTML `id`/`name` anchors; external URLs, non-Markdown targets, code examples and text fragments are excluded. The workflow also runs `scripts/markdown-style-baseline.js` as a report-only measurement across the complete tree. The blocking `check-markdown-style.js --all-maintained` gate scans every maintained Markdown/MDX file, while the changed-file checker additionally protects the exact PR diff. Both use the same scanner for whitespace, headings, fenced-code labels, unordered-list markers, nested-list indentation, list spacing, table delimiters, column counts and table spacing. All 14 style metrics are blocking for maintained documents; GitHub templates are exempt only from H1 and heading-hierarchy findings. Historical evidence paths remain excluded from blocking enforcement and are never mass-reformatted. Fenced and four-space-indented code blocks are excluded from prose/list/table metrics, including internal blank lines; valid nested lists remain analyzed. Regression coverage includes positive/negative list and table fixtures, code-block exclusions, historical path classification, maintained indexes and GitHub template exceptions.

For pull requests, the same required workflow runs the [full-tree maintained style gate](../scripts/check-markdown-style.js) on every event, the [maintained-source anchor gate](../scripts/check-maintained-markdown-anchors.js), and the [changed-file style checker](../scripts/check-markdown-style.js) against the exact PR base SHA. The full-tree gate treats each maintained document as a complete file; the changed-file checker also checks existing files only in changed hunks and two lines of context, with missing final newlines and CRLF checked at file level. Newly added files are checked in full. Historical evidence remains report-only for anchors and excluded from blocking style enforcement. GitHub issue/PR templates are exempt only from heading rules, not whitespace/list/table checks. This provides both repository-wide maintained-document coverage and a narrow diff guard without rewriting historical snapshots.

The historical 2026-11-10 full-tree baseline measurement was recorded on PR #913 head `baaf2762e22d50537e3b778bfb29016aaefd33ed` across 113 tracked Markdown/MDX files. At the time of the later `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d` checkpoint, the inventory contained 117 files; the `ea6110fb39c1c86acfbf9673910965e7f698d511` checkpoint contained 157 files (86 under Harvester, 71 elsewhere). The latest 2026-11-18 source-verified `develop` checkpoint `543753da5938eba2d95ad19d74c3f98a991e6461` contains 160 files (89 under Harvester, 71 elsewhere), classified as 132 maintained paths and 28 historical paths. See [the repository documentation inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md) for the complete path set and dispositions. The 160-file baseline found no maintained structural list/table violations; the sole maintained repeated-blank-line finding was in the PR template and is normalized by this enforcement change. Non-zero trailing-whitespace, newline, repeated-blank-line, heading and list-spacing findings otherwise belong to historical documents or template heading exemptions.

- Trailing whitespace: 22 files / 112 occurrences; missing final newline: 0; CRLF line endings: 0.
- Repeated blank lines: 44 files / 371 occurrences; missing H1: 2 files; multiple H1: 1 file / 11 headings; skipped heading levels: 4 files / 5 occurrences; unlabeled fenced-code blocks: 0.
- Non-hyphen unordered markers: 0; nested-list items misaligned with their parent content columns: 0; list blocks missing blank-line separation: 41 files / 156 occurrences.
- Malformed table delimiters: 0; inconsistent table column counts: 1 file / 1 occurrence (`packages/brokers/ROADMAP.md:251`); table blocks missing blank-line separation: 0.

The historical 114-file baseline on PR #931 head `137e56a44d134096d094c8aad6850a7ccc9d9876` reports 41 files / 156 list-spacing occurrences. The path review classifies 13 historical files / 56 occurrences and 28 maintained files / 100 occurrences. PR #940 corrects the 100 maintained boundaries and enables changed-maintained-file list-spacing enforcement; the 56 historical findings remain unchanged and excluded.

The pre-correction 117-file report-only scan ran in the required JavaScript Syntax workflow on exact PR #968 head `d0d52dddb8f3c8d9e73f9f6dc484c6b3987e22f2`. It reports: trailing whitespace 22 files / 112 occurrences; missing final newline 0; CRLF 0; repeated blank lines 41 files / 353 occurrences; missing H1 2 files / 2 occurrences; multiple H1 1 file / 11 headings; skipped heading levels 4 files / 5 occurrences; unlabeled fences 0; non-hyphen unordered markers 0; nested-list misalignment 0; list-block spacing 14 files / 57 occurrences; malformed table delimiters 0; inconsistent table columns 0; and table-block spacing 1 file / 1 occurrence. The table-block finding is the source-review table in `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`, whose delimiter row is corrected in this follow-up. These full-tree metrics remain report-only; historical evidence and templates remain included.

The post-correction report-only scan on final PR #969 head `0788f384b6f27e02c6b6bab8f8b75309c623c1be` covered 117 files and reported **zero tables without blank-line separation**; every other metric above was unchanged. The changed-file style checker scanned 8 maintained files, skipped 0 historical files and 0 generated/vendor paths, and passed. The full-tree metrics remain report-only; only the documented changed-file rules are enforced.

The earlier PR #886 merge-preview measurement (`d07ee71e1b754c9539d53fc9c32f72e5b7d89f3c`: 24 / 123 trailing whitespace; 49 / 381 repeated blank lines; other counts unchanged), PR #876 measurement (27 / 127 trailing whitespace; 50 / 383 repeated blank lines), and the 2026-11-09 112-file measurement (28 / 128 trailing whitespace; 2 missing final newlines; 51 / 385 repeated blank lines) are historical checkpoints. Prose whitespace and list/table metrics exclude fenced-code contents. These are measurements, not a blanket violation list: the scan includes historical evidence and GitHub templates, and it does not distinguish intentional Markdown hard-break syntax. Preserve historical snapshots and review the maintained-document scope before enabling broader enforcement.

The full-tree maintained Markdown style gate and maintained-source local-anchor gate are implemented as blocking steps in the required JavaScript Syntax workflow and tracked by [#1402](https://github.com/45s/coinzilla/issues/1402), under documentation governance [#795](https://github.com/45s/coinzilla/issues/795). The report-only baseline continues to include historical documents for visibility; historical anchor findings remain non-blocking. External URL checking remains a separate advisory workflow. Do not claim external-link availability is guaranteed by required CI.

### External URL reliability policy

The external-link checker scans HTTP(S) destinations in Markdown/MDX inline links, reference definitions, autolinks, and bare prose URLs. It removes fenced/inline code and HTML comments, deduplicates requests by URL without fragments, and retains source paths for findings. It does not rewrite links.

- **Pull-request scope:** the non-required advisory workflow checks only changed maintained Markdown/MDX on pull requests to `develop`. Every candidate hostname is resolved for all A/AAAA answers; the full answer set is rejected if any address is private, shared, reserved, loopback, link-local, multicast, documentation-only, or metadata-related. HTTP(S) sockets use a custom lookup pinned to the validated address set, and each redirect is resolved and pinned independently. Unsafe DNS answers and ineligible redirect targets are skipped without opening a connection. Malformed HTTP(S) destinations, URL userinfo, and credential-like query parameters (for example, `token`, `api_key`, `password`, and signed-URL signatures) are invalid, redacted, and never requested. A URL is classified as broken only when a GET request confirms HTTP 404 or 410; a HEAD 404/410 is followed by GET confirmation. A HEAD method that is unsupported or blocked falls back to a ranged GET, but a GET 404/410 after a HEAD 401/403 remains unverifiable.
- **Full-tree scope:** weekly and manual advisory runs use `--all --report-only` and can include historical documents. Historical evidence is never mass-edited or used as a changed-document failure gate.
- **Request limits:** 10-second timeout per request, including DNS resolution; at most two retries (three attempts) for network errors and HTTP 408/425/429/5xx; exponential backoff starting at 500 ms; honor `Retry-After` up to 30 seconds; at most five redirects; four host groups concurrently; one request per host at a time with a 500 ms minimum interval between request starts.
- **Classification:** 2xx is successful. Only GET-confirmed 404/410 without a preceding HEAD access-control response is broken. An unresolved authentication/anti-bot response (401/403), or a GET 404/410 following HEAD 401/403, remains unverifiable; DNS failures, rate limits, server failures, timeouts, network errors, and other unusable responses are also unverifiable and do not fail the changed-document check. Unsafe DNS answer sets and ineligible redirect targets are skipped and never requested. Local-only hostnames and all IP-literal hosts are skipped. URLs containing credentials are invalid, redacted, and never requested.
- **Security and merge policy:** no cookies, authorization headers, repository secrets, or exchange credentials are sent. The checker validates every resolved address and pins the actual HTTP(S) connection to the vetted set; redirects are independently revalidated. The **External Documentation Links** workflow is advisory and is not a required context in either active `core` (`main`) or `develop-core` (`develop`) ruleset. A confirmed broken link is actionable feedback, not a branch-protection bypass or automatic merge blocker.
- **Address-policy maintenance:** the static range policy is maintained against the [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry). It deliberately blocks whole protocol-assignment ranges such as `192.0.0.0/24` and `2001::/23`, including some more-specific globally reachable exceptions, and blocks NAT64/6to4 transition prefixes rather than risking translation to embedded private IPv4 destinations. Review the registry and update both positive and negative tests when IANA assignments change.
