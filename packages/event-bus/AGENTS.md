# Event Bus Agent Instructions

Before making any change anywhere in this package:

1. Read `ROADMAP.md` completely. It defines the package mission, engineering standards, test expectations, and current reliability roadmap.
2. Follow its functional-core/imperative-shell guidance: use pure functions for deterministic validation, transformations, and policy decisions wherever practical; isolate I/O, time, randomness, scheduling, logging, and mutable lifecycle state.
3. Inspect all package consumers before changing public behavior.
4. Add deterministic regression tests for bugs and edge cases before or alongside fixes.
5. Run the package tests and relevant repository checks. Never claim a check passed unless it was actually run.
6. Update `ROADMAP.md` when implementation status, guarantees, or decisions change.

Do not create GitHub issues as a substitute for tracking this package's work. Keep the roadmap and focused pull requests as the source of truth.
