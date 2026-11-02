# Task-specific agent workflows

All tasks must follow root AGENTS.md, AI_AGENT_WORKFLOW.md, the owning domain's AGENTS.md, and its roadmap. Use the smallest applicable checklist below; high-risk requirements are additive.

## Documentation-only change

- Confirm the owning documentation/domain and check linked references.
- Follow the canonical [documentation-impact policy](../../ENGINEERING_STANDARDS.md#documentation-impact).
- Preserve technical meaning; verify every command, path, and policy statement against the repository.
- Run pnpm run check:agent-policy when ownership or agent instructions change.
- Run actionlint/syntax checks when workflow or executable configuration files change.
- Do not run broad application test suites for prose-only edits unless the change affects executable examples or contracts.

## Bug fix

- Reproduce the defect with a deterministic regression test where practical.
- Identify the owning domain and inspect callers, public contracts, and adjacent failure paths.
- Make the smallest cohesive fix; do not bundle unrelated refactors.
- Run the owning package's tests and coverage, then applicable workspace CI.

## Feature or behavior change

- Identify the user-visible contract, owning roadmap item, dependencies, and failure modes before implementation.
- Add tests for success, invalid input, boundaries, failures, and relevant interactions.
- Apply the canonical [documentation-impact policy](../../ENGINEERING_STANDARDS.md#documentation-impact) to the changed behavior and affected roadmap.
- Include the required **Documentation impact** note in the PR description, as specified by the canonical policy.
- Run focused tests/coverage, workspace tests, syntax/policy checks, and applicable CI.

## Cross-domain or shared-infrastructure change

- Identify every affected owner and link the cross-domain request(s).
- Keep domain implementation changes in owner-scoped PRs where practical.
- For CI, agent policy, manifests, shared utilities, or GitHub rules, state the affected domains and verify all current consumers.
- Validate workflow syntax and the exact required GitHub status-check context names.
- Do not claim GitHub ruleset configuration changed unless the live ruleset was read back and verified.

## Financial, exchange, or production-safety change

- Preserve exact decimal arithmetic and established entity/broker boundaries.
- Keep default tests offline and credential-free.
- Broker order integration tests must use TESTNET only; no live order placement.
- Verify explicit safety gates, authorization, idempotency, reconciliation, failure handling, and secret redaction.
- Never enable production order execution or relax a safety gate without explicit user authorization.

## Before merge

- Synchronize with the latest actual PR target branch.
- Inspect the complete diff and verify the documentation-impact policy is satisfied.
- Wait for every required CI status check to complete successfully on the exact PR head SHA.
- Confirm the target branch is up to date; do not bypass rules or merge with pending/failed checks.
- Merge task PRs to develop without routine human approval; reserve user approval for the release PR to main.
- Delete the source branch after successful merge and verify deletion.
