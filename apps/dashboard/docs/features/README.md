# Dashboard feature specifications

This index lists durable feature behavior contracts owned by the Dashboard application. The repository-wide authoring and AI-agent usage rules are defined in the [Feature Specification Standard](../../../../docs/FEATURE_SPECIFICATION_STANDARD.md).

## Features

- [GitHub PR Dashboard](github-pr-dashboard/SPEC.md) — read-only overview of open `45s/coinzilla` pull requests, current head-commit timestamps and Dashboard-local work labels. [Domain scenarios](github-pr-dashboard/DOMAIN_SCENARIOS.md) and [schemas](github-pr-dashboard/schemas/).
- [GC Strategy Lab](gc-strategy-lab/SPEC.md) — simulation-only GC strategy exploration, dynamic decision-flow visualization, event injection, trace and calculation inspection. [Domain scenarios](gc-strategy-lab/DOMAIN_SCENARIOS.md).

## Creating a feature specification

Before adding a feature folder, follow the repository [Feature Specification Standard](../../../../docs/FEATURE_SPECIFICATION_STANDARD.md). Search existing documentation first, create only the files justified by the feature, and link the specification from this index and the Dashboard roadmap when it becomes planned or active.
