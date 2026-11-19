# Production dependency audit playbook

The **Dependency Audit** workflow runs `pnpm audit --prod --audit-level high` on pushes, pull requests, manual dispatch, and its weekly schedule. It checks production dependency advisories; it is not a substitute for reviewing dependency changes or keeping the lockfile reproducible.

## Dependabot update policy

The canonical update configuration is [`.github/dependabot.yml`](../.github/dependabot.yml):

- npm and GitHub Actions version updates are checked weekly on Monday.
- Each ecosystem has a maximum of five open version-update pull requests.
- Patch and minor updates are grouped; major updates remain separate so they can receive deliberate compatibility review.
- Version-update pull requests target `develop`. Dependabot reads this configuration from the repository's default branch (`main`), so the new target takes effect only after the configuration reaches `main` through the approved `develop` → `main` release PR. Do not update `main` directly to accelerate activation.
- **Security-update exception:** GitHub always raises Dependabot security-update PRs against the default branch; `target-branch` affects version updates only. Treat a security PR/alert as an urgent remediation signal, assess the advisory promptly, and implement the compatible fix through a normal task PR into `develop`. Do not merge a task or security-update PR directly into `main`; release the validated `develop` change through the approved release process.

### Review and merge rules

1. **Security fixes:** triage promptly. Confirm the advisory, severity, affected dependency path, vulnerable range, and patched version. Prefer the smallest compatible fix, then run the affected tests and production dependency audit.
2. **Patch updates:** inspect the release notes and dependency path; accept only after relevant tests, the production audit, and all required CI checks pass.
3. **Minor updates:** review release notes for behavior/API changes and runtime requirements; test affected consumers before merging.
4. **Major updates:** require explicit manual compatibility review. Check breaking changes, supported Node/toolchain versions, action inputs/outputs, permissions, runtime migrations, and every affected workflow/package. Green CI is necessary but does not replace this review.
5. **GitHub Actions updates:** retain full commit-SHA pinning. Verify that the SHA belongs to the stated upstream release, review the release notes and action metadata, and confirm that the action's runtime and inputs remain compatible with the workflow.
6. **Lockfile updates:** review the complete importer and package-graph diff. Every addition, removal, or importer change must be explained by the intended manifest update; do not accept unrelated dependency removals or unexplained lockfile churn. Use pnpm to regenerate the lockfile, and verify reproducibility with `pnpm install --frozen-lockfile`.
7. **Merge gate:** never merge solely because a PR is mergeable or its first CI run is green. Confirm the complete diff, latest `develop` ancestry, and every required check on the exact current PR head. Do not enable automatic merging or bypass branch protection.

For this repository, routine dependency maintenance follows the same branch contract as all other maintenance: task PRs target `develop`; only the final release PR from `develop` targets `main`.

## When the audit fails

1. Open the failing **Dependency Audit** run in GitHub Actions and read the complete `pnpm audit` output.
2. Identify the affected package, advisory identifier, severity, vulnerable version range, and any patched version listed by the advisory.
3. Trace the affected dependency to the workspace importer or dependency that brings it in. Distinguish direct dependencies from transitive dependencies before choosing a fix.
4. Check whether a compatible patched release exists. Prefer a normal dependency update that preserves the package's supported API and runtime requirements.
5. Update dependencies through pnpm from the repository root and commit the corresponding `pnpm-lock.yaml` changes together with any necessary manifest changes. Do not hand-edit lockfile resolution data.
6. Run the relevant package tests and the repository checks, then rerun the audit.
7. In the pull request, explain the affected dependency, the remediation, and any compatibility considerations.

## Useful commands

Run from the repository root:

```sh
# Reproduce the same production-dependency audit threshold as CI
pnpm audit --prod --audit-level high

# Run workspace tests, full-workspace ESLint, JavaScript syntax, agent-policy checks, and mocked external-link tests
pnpm run quality

# Confirm the lockfile can reproduce the install
pnpm install --frozen-lockfile
```

If the report identifies a transitive dependency, inspect the dependency chain with pnpm's dependency inspection commands before deciding which direct dependency to update.

## If no safe fix is available

Do not hide the finding by lowering the audit threshold, disabling the workflow, or adding a broad ignore. Record the advisory, affected dependency path, assessed impact, available mitigations, and the reason a safe update is not currently possible. Raise the issue for review and revisit it when the dependency or advisory changes.

An exception should be explicit, scoped, and reviewable. Do not claim the vulnerability is resolved unless the patched dependency is actually present in the lockfile and the audit confirms the result.

## Review checklist

- [ ] The advisory and vulnerable dependency path are identified.
- [ ] A compatible fix was preferred where available.
- [ ] Manifest and lockfile changes are consistent.
- [ ] Relevant tests and the production audit were rerun.
- [ ] Any unresolved risk and follow-up are documented.
- [ ] No credentials, environment files, or unrelated dependency updates were included.

See [CI workflow reference](./ci-workflows.md) for workflow triggers and [contributing guide](./contributing.md) for the repository's testing expectations.
