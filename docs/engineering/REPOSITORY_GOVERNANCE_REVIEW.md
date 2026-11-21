# Repository governance drift review

**Status:** Active
**Type:** Maintenance procedure
**Owner:** Repository maintainer
**Cadence:** Monthly, plus after material CI or GitHub-settings changes
**Tracking:** [Repository engineering initiative #1568](https://github.com/45s/coinzilla/issues/1568)

This procedure keeps repository governance aligned with the actual GitHub configuration and current source. The scheduled [Governance Drift Review workflow](../../.github/workflows/governance-drift-review.yml) opens one review issue per month; the issue is the evidence record and must be completed against live settings.

## Review checklist

1. **Branch controls:** inspect active rulesets and classic branch protection for `develop` and `main`. Record rule IDs, target branches, strictness, bypass actors, required checks, and review-thread resolution. Do not infer settings from workflow files.
2. **Human review model:** this repository currently has a solo maintainer. Do not require approving reviews that the author cannot provide, and do not create placeholder CODEOWNERS entries. Keep required CI and thread-resolution protections. Revisit independent review only when another real maintainer is available.
3. **CI integrity:** verify required status contexts against live rulesets; check exact-head results and aggregate behavior for failed, cancelled, skipped, or missing jobs. Preserve context names unless a deliberate ruleset migration is planned.
4. **Workflow supply chain:** inspect all workflow actions for full-SHA pinning, update cadence, least-privilege permissions, pull-request trust boundaries, supported runtimes, and unnecessary write access.
5. **Security:** inspect production and development dependency findings, secret-scanning settings where accessible, and CodeQL/default code-scanning setup. Record inaccessible settings as unknown and route administrative changes to the repository owner. Review findings before making any alert a blocking policy.
6. **Package test matrix:** run the canonical workspace test-matrix check and compare discovered packages with unit and coverage workflows.
7. **Architecture and exceptions:** review open policy exceptions, helper-purity audit status, dependency-boundary findings, and any overdue follow-up issues.
8. **Documentation:** reconcile `docs/ci-workflows.md`, `ROADMAP.md`, and canonical engineering standards with the live configuration and current merged state.

## Evidence requirements

Each monthly issue records:

- UTC review date and exact `develop` / `main` commit SHAs.
- Ruleset identifiers and observed settings, plus explicit access limitations.
- Required status contexts and exact-head check results.
- Workflow/action findings and remediation PRs.
- Security findings, triage decisions, owners, and review dates.
- Package-matrix result and outstanding architecture/documentation follow-ups.
- Deferred items with a reason and the next review point.

A checklist without evidence is not a completed review. Close the monthly issue only after findings have a disposition and actionable work is linked to an issue or PR. The review is read-only unless a separate, authorized implementation task is opened.

## Initial known constraints

- The connected GitHub integration can read repository rulesets but cannot read classic branch-protection settings or the CodeQL default-setup endpoint. Those settings must be checked by a maintainer with the appropriate GitHub permissions.
- The current maintainer works alone. Approving-review and CODEOWNERS requirements are intentionally not enforced until independent reviewers exist.
- The JSDoc standard defers global `checkJs`. A package-scoped pilot requires a pinned compiler/toolchain, a measured baseline, and acceptable diagnostic noise before it becomes a CI gate.
