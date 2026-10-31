# Cross-domain requests

Use this process whenever an application/package needs a bug fix, missing capability, or contract change owned by another domain.

## Request types

### Bug report
Include:
- Owning domain and affected package/path.
- Actual behavior and expected behavior.
- Minimal deterministic reproduction, failing test, logs, or other evidence.
- Impact and severity.
- Consumer task blocked or affected.

### Capability request
Include:
- Consumer use case and why the current public API is insufficient.
- Required observable behavior and expected inputs/outputs.
- Failure/unknown-state behavior and safety constraints.
- Relevant consumers and compatibility expectations.
- Acceptance tests or examples where possible.

### Contract change
Include:
- Current contract and proposed observable change.
- Why compatibility cannot be preserved.
- All known consumers and migration plan.
- Versioning/deprecation implications, if applicable.
- Required coordinated rollout order.

## Ownership and implementation

1. Consumer agent creates the request and links it from its own task/roadmap.
2. Owning-domain agent evaluates it and decides whether to accept, defer, or reject it with a reason.
3. Accepted work is added to the owner's roadmap.
4. Owner implements and tests the change on a short-lived task branch from `develop`.
5. Owner opens a focused PR to `develop`; it is merged after required automated gates pass.
6. Consumer synchronizes from `develop`, then updates its own code and tests.
7. Link request, owner PR, and consumer PR to preserve traceability.

Do not make a private copy, app-local workaround, or speculative duplicate abstraction to avoid waiting for an owner decision. If an immediate safe workaround is essential, document it as temporary, obtain explicit cross-domain coordination, and create a follow-up request to remove it.

## Request template

```markdown
## Request type
Bug / Capability / Contract change

## Owning domain
Package/path:

## Consumer and use case
What are we trying to achieve?

## Current behavior
What happens today? Include reproduction/evidence.

## Expected behavior / contract
Describe observable behavior, not an assumed internal implementation.

## Acceptance criteria
- [ ] ...

## Consumer impact
Which app/package/task is blocked?

## Compatibility and safety
Known breaking changes, failure behavior, invariants, migration needs.

## Links
Related roadmap item, issue, PR, tests.
```
