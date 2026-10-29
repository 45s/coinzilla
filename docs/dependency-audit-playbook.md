# Production dependency audit playbook

The **Dependency Audit** workflow runs `pnpm audit --prod --audit-level high` on pushes, pull requests, manual dispatch, and its weekly schedule. It checks production dependency advisories; it is not a substitute for reviewing dependency changes or keeping the lockfile reproducible.

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

# Check workspace tests and JavaScript syntax
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
