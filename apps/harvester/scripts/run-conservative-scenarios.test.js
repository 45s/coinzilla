import test from "node:test"
import assert from "node:assert/strict"
import {
  formatBuildIdentity,
  parseScenarioCliArguments,
} from "./run-conservative-scenarios.js"

test("formats the full build identity for normal, help, and version CLI output", () => {
  const identity = formatBuildIdentity({
    buildMetadata: {
      application: "harvester-conservative-scenarios",
      version: "1.2.3",
      source: {
        branch: "feature/harvester/conservative-scenario-runner",
        commit: "0123456789abcdef0123456789abcdef01234567",
        workingTree: "clean",
        metadataSource: "git",
      },
    },
    runtimeVersion: "v24.22.3",
  })

  assert.equal(
    identity,
    [
      "[harvester-conservative-scenarios] harvester-conservative-scenarios@1.2.3",
      "[harvester-conservative-scenarios] branch=feature/harvester/conservative-scenario-runner commit=0123456789abcdef0123456789abcdef01234567 worktree=clean",
      "[harvester-conservative-scenarios] runtime=v24.22.3 metadataSource=git",
    ].join("\n"),
    "Every CLI entry point must expose application, version, source, worktree, and runtime identity.",
  )
})

test("recognizes the version flag without running scenarios", () => {
  const options = parseScenarioCliArguments({ argv: ["--version"] })

  assert.equal(options.version, true,
    "The version flag must be parsed before scenario loading or execution.")
})
