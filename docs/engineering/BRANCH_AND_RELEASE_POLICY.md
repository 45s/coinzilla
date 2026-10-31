# Branch and release policy

This page summarizes the branch rules in [AI_AGENT_WORKFLOW.md](../../AI_AGENT_WORKFLOW.md). The workflow document is authoritative.

## Branches

- `main`: stable release history.
- `develop`: shared integration branch.
- `feature/<domain>/<task>`, `fix/<domain>/<task>`, `docs/<task>`: short-lived branches created from latest `develop`.

Do not maintain permanent branches for entities, brokers, utils, or applications.

## Pull requests

- Task PRs target `develop`. The responsible agent merges after all required checks and freshness checks pass; no routine human approval is required.
- Only milestone/release PRs target `main`. The user approves the final release PR.
- Never bypass CI, branch protection, or branch freshness.
- The agent owns synchronization and conflict resolution. Never ask the user to update a branch manually.

## Release

When a meaningful milestone is complete, prepare one PR from `develop` to `main` containing a summary of included roadmap items, test evidence, migration/compatibility notes, and remaining risks.

## GitHub configuration

Protect both branches with PR-only changes, required checks, up-to-date branches, no force pushes, and no deletion. `develop` should require zero human approvals; `main` should retain final user approval. Verify exact check names before making them required.

The repository's auto-merge setting is optional. If it is disabled, agents can merge task PRs after every gate passes. Never claim auto-merge is enabled unless GitHub confirms it.
