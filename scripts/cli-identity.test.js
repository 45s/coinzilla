import assert from "node:assert/strict"
import test from "node:test"
import { formatCliIdentity, resolveCliIdentity } from "./cli-identity.js"

const packageMetadata = JSON.stringify({
  name: "@coinzilla/notifiers",
  version: "1.0.0",
})
const commit = "d82cf8f0bd7ac2a2db540c17f6283c0b82395fa1"

function createIdentity({ commitOutput = commit, statusOutput = "", gitFails = false } = {}) {
  return resolveCliIdentity({
    packageRoot: "/repo/packages/notifiers",
    repositoryRoot: "/repo",
    scriptName: "telegram:smoke",
    readFile: () => packageMetadata,
    exec: (...callArgs) => {
      const [, gitArgs] = callArgs
      if (gitFails) {
        throw new Error("git unavailable")
      }
      return gitArgs[0] === "rev-parse" ? commitOutput : statusOutput
    },
  })
}

test("CLI identity includes package, command, full commit, worktree, and Node runtime", () => {
  const identity = createIdentity()
  assert.equal(identity.packageName, "@coinzilla/notifiers", "identity must name the package that owns the executable")
  assert.equal(identity.scriptName, "telegram:smoke", "identity must name the invoked command")
  assert.equal(identity.packageVersion, "1.0.0", "identity must report the package version")
  assert.equal(identity.commitSha, commit, "identity must preserve the full source commit SHA")
  assert.equal(identity.worktree, "clean", "an empty Git status must be reported as clean")
  assert.equal(identity.nodeVersion, process.version, "identity must report the active Node.js runtime")
  assert.equal(
    formatCliIdentity(identity),
    `@coinzilla/notifiers telegram:smoke v1.0.0 | commit ${commit} | worktree clean | Node ${process.version}`,
    "formatted identity must expose every required source and runtime field",
  )
})

test("CLI identity marks a dirty worktree", () => {
  assert.equal(
    createIdentity({ statusOutput: " M src/index.js" }).worktree,
    "dirty",
    "any tracked or untracked Git status output must mark the source checkout dirty",
  )
})

test("CLI identity explicitly reports unavailable Git metadata", () => {
  const identity = createIdentity({ gitFails: true })
  assert.equal(identity.commitSha, null, "unavailable Git metadata must not be replaced with a fabricated SHA")
  assert.equal(identity.worktree, "unknown", "unavailable Git status must be reported as unknown")
  assert.match(
    formatCliIdentity(identity),
    /commit unknown \| worktree unknown/,
    "formatted identity must visibly disclose unavailable Git metadata",
  )
})
