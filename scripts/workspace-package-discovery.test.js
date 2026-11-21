import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import {
  discoverWorkspacePackages,
  parsePnpmWorkspacePatterns,
} from "./workspace-package-discovery.js"

const writeFixtureFile = ({ repositoryRoot, file, content }) => {
  const absolutePath = join(repositoryRoot, ...file.split("/"))
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

test("parses pnpm workspace package patterns deterministically", () => {
  assert.deepEqual(
    parsePnpmWorkspacePatterns({
      workspaceManifest: [
        "packages:",
        '  - "packages/*"',
        "  - 'apps/*'",
        "",
      ].join("\n"),
    }),
    ["apps/*", "packages/*"],
    "Workspace patterns must be extracted and returned in deterministic order.",
  )
})

test("rejects missing, empty and duplicate workspace pattern declarations", () => {
  assert.throws(
    () => parsePnpmWorkspacePatterns({ workspaceManifest: "packages: []\n" }),
    /Workspace manifest must declare a packages list/,
    "An empty inline list is not a supported workspace declaration.",
  )

  assert.throws(
    () => parsePnpmWorkspacePatterns({ workspaceManifest: "packages:\n" }),
    /Workspace manifest must declare at least one package pattern/,
    "A missing workspace pattern must fail closed.",
  )

  assert.throws(
    () => parsePnpmWorkspacePatterns({
      workspaceManifest: [
        "packages:",
        '  - "apps/*"',
        '  - "apps/*"',
      ].join("\n"),
    }),
    /Duplicate pnpm workspace package pattern: apps\/\*/,
    "Duplicate workspace patterns must not silently duplicate package discovery.",
  )
})

test("discovers direct workspace package manifests from declared patterns", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "coinzilla-workspace-discovery-"))

  try {
    writeFixtureFile({
      repositoryRoot,
      file: "apps/harvester/package.json",
      content: JSON.stringify({
        name: "@coinzilla/harvester",
        dependencies: {
          "@coinzilla/utils": "workspace:*",
        },
      }),
    })
    writeFixtureFile({
      repositoryRoot,
      file: "packages/utils/package.json",
      content: JSON.stringify({
        name: "@coinzilla/utils",
      }),
    })
    writeFixtureFile({
      repositoryRoot,
      file: "packages/not-a-package/README.md",
      content: "No package manifest here.",
    })
    writeFixtureFile({
      repositoryRoot,
      file: "packages/utils/nested/ignored/package.json",
      content: JSON.stringify({
        name: "@coinzilla/nested",
      }),
    })

    assert.deepEqual(
      discoverWorkspacePackages({
        repositoryRoot,
        patterns: ["apps/*", "packages/*"],
      }).map(({ file, name }) => ({
        file,
        name,
      })),
      [
        {
          file: "apps/harvester/package.json",
          name: "@coinzilla/harvester",
        },
        {
          file: "packages/utils/package.json",
          name: "@coinzilla/utils",
        },
      ],
      "Discovery must follow declared one-level workspace patterns and ignore nested/non-package directories.",
    )
  } finally {
    rmSync(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects unsupported patterns, duplicate package names and malformed manifests", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "coinzilla-workspace-invalid-"))

  try {
    mkdirSync(join(repositoryRoot, "apps"), { recursive: true })
    mkdirSync(join(repositoryRoot, "packages"), { recursive: true })

    assert.throws(
      () => discoverWorkspacePackages({
        repositoryRoot,
        patterns: ["apps/**"],
      }),
      /Unsupported pnpm workspace package pattern: apps\/\*\*/,
      "Unsupported glob syntax must fail instead of silently scanning a partial workspace.",
    )

    writeFixtureFile({
      repositoryRoot,
      file: "apps/harvester/package.json",
      content: JSON.stringify({
        name: "@coinzilla/harvester",
      }),
    })
    writeFixtureFile({
      repositoryRoot,
      file: "packages/harvester-copy/package.json",
      content: JSON.stringify({
        name: "@coinzilla/harvester",
      }),
    })

    assert.throws(
      () => discoverWorkspacePackages({
        repositoryRoot,
        patterns: ["apps/*", "packages/*"],
      }),
      /Duplicate workspace package name: @coinzilla\/harvester/,
      "Workspace package names must be globally unique.",
    )

    rmSync(join(repositoryRoot, "packages/harvester-copy"), {
      recursive: true,
      force: true,
    })
    writeFixtureFile({
      repositoryRoot,
      file: "packages/broken/package.json",
      content: "{ invalid json",
    })

    assert.throws(
      () => discoverWorkspacePackages({
        repositoryRoot,
        patterns: ["apps/*", "packages/*"],
      }),
      /Invalid workspace package manifest: packages\/broken\/package\.json/,
      "Malformed manifests must identify the repository-relative file.",
    )
  } finally {
    rmSync(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})
