import assert from "node:assert/strict"
import test from "node:test"
import { Logger } from "./logger.js"
import * as utils from "./index.js"

const COMMIT_SHA = "a".repeat(40)

const gitOutputs = ({
  branch = "develop",
  workingTree = "",
} = {}) => ({
  "rev-parse --show-toplevel": "C:/coinzilla\n",
  "rev-parse HEAD": COMMIT_SHA + "\n",
  "branch --show-current": branch + "\n",
  "log -1 --format=%s": "feat(utils): capture build provenance\n",
  "log -1 --format=%cI": "2026-11-08T22:00:00+00:00\n",
  "status --porcelain --untracked-files=all": workingTree,
})

const createGitRunner = (outputs, { failure } = {}) => (command, args, options) => {
  assert.equal(command, "git", "build metadata capture must invoke the Git executable")
  assert.equal(options.encoding, "utf8", "Git metadata must be decoded as UTF-8 text")
  assert.equal(options.cwd, "C:/coinzilla", "Git commands must run in the supplied repository directory")
  const operation = args.join(" ")
  if (operation === failure) {
    throw new Error("Git metadata unavailable")
  }
  return outputs[operation] ?? ""
}

const captureMetadata = (options) => {
  assert.equal(
    typeof utils.captureBuildMetadata,
    "function",
    "the public Utils API must export captureBuildMetadata for application startup",
  )
  return utils.captureBuildMetadata(options)
}

test("captures complete clean Git provenance for an application version", () => {
  const metadata = captureMetadata({
    application: "harvester",
    version: "1.0.001",
    cwd: "C:/coinzilla",
    env: {},
    execFileSync: createGitRunner(gitOutputs()),
  })

  assert.deepEqual(metadata, {
    application: "harvester",
    version: "1.0.001",
    source: {
      branch: "develop",
      commit: COMMIT_SHA,
      shortCommit: "aaaaaaaa",
      commitMessage: "feat(utils): capture build provenance",
      commitDate: "2026-11-08T22:00:00+00:00",
      workingTree: "clean",
      metadataSource: "git",
    },
  }, "startup provenance must identify the exact clean Git revision and application package version")
})

test("records dirty working trees and represents detached HEAD without inventing a branch", () => {
  const metadata = captureMetadata({
    application: "harvester",
    version: "1.0.001",
    cwd: "C:/coinzilla",
    env: {},
    execFileSync: createGitRunner(gitOutputs({
      branch: "",
      workingTree: " M apps/harvester/src/index.js\n?? local-notes.txt\n",
    })),
  })

  assert.equal(metadata.source.workingTree, "dirty", "tracked modifications and untracked files must mark the running source as dirty")
  assert.equal(metadata.source.branch, null, "detached HEAD must not be mislabeled with a branch name")
})

test("uses explicit build environment metadata when Git is unavailable", () => {
  const metadata = captureMetadata({
    application: "harvester",
    version: "1.0.001",
    cwd: "C:/coinzilla",
    env: {
      COINZILLA_BUILD_COMMIT: COMMIT_SHA,
      COINZILLA_BUILD_BRANCH: "release/1.0.001",
      COINZILLA_BUILD_COMMIT_MESSAGE: "release: harvester 1.0.001",
      COINZILLA_BUILD_COMMIT_DATE: "2026-11-08T22:00:00Z",
      COINZILLA_BUILD_WORKING_TREE: "clean",
    },
    execFileSync: createGitRunner({}, { failure: "rev-parse --show-toplevel" }),
  })

  assert.deepEqual(metadata.source, {
    branch: "release/1.0.001",
    commit: COMMIT_SHA,
    shortCommit: "aaaaaaaa",
    commitMessage: "release: harvester 1.0.001",
    commitDate: "2026-11-08T22:00:00Z",
    workingTree: "clean",
    metadataSource: "environment",
  }, "gitless deployments must retain explicitly supplied build identity without guessing missing fields")
})

test("keeps unavailable Git metadata explicit when no build environment is supplied", () => {
  const metadata = captureMetadata({
    application: "harvester",
    version: "1.0.001",
    cwd: "C:/coinzilla",
    env: {},
    execFileSync: createGitRunner({}, { failure: "rev-parse --show-toplevel" }),
  })

  assert.deepEqual(metadata.source, {
    branch: null,
    commit: null,
    shortCommit: null,
    commitMessage: null,
    commitDate: null,
    workingTree: "unknown",
    metadataSource: "unavailable",
  }, "missing Git and build metadata must be represented as unknown rather than blocking startup or inventing a revision")
})

test("rejects invalid build metadata capture inputs", () => {
  assert.throws(
    () => captureMetadata({ application: "", version: "1.0.0", cwd: "C:/coinzilla" }),
    /application/,
    "build metadata capture must reject an empty application identifier",
  )
  assert.throws(
    () => captureMetadata({ application: "harvester", version: "", cwd: "C:/coinzilla" }),
    /version/,
    "build metadata capture must reject an empty application version",
  )
  assert.throws(
    () => captureMetadata({ application: "harvester", version: "1.0.0", cwd: "" }),
    /cwd/,
    "build metadata capture must reject an empty working directory",
  )
})

test("attaches immutable redacted logger context without changing caller log data", () => {
  const entries = []
  const logger = new Logger({
    transports: [{
      name: "capture",
      level: "trace",
      write(entry) {
        entries.push(entry)
      },
    }],
  })

  assert.equal(typeof logger.setContext, "function", "Logger must expose an opt-in setContext method")
  logger.setContext({
    application: "harvester",
    runtimeSessionId: "session-123",
    accessToken: "must-not-be-written",
  })
  const eventData = { message: "process started" }
  logger.info(eventData)

  assert.deepEqual(entries[0].context, {
    application: "harvester",
    runtimeSessionId: "session-123",
    accessToken: "[REDACTED]",
  }, "logger context must be attached as a separate redacted structured field")
  assert.equal(Object.isFrozen(entries[0].context), true, "transport consumers must not be able to mutate shared logger context")
  assert.deepEqual(entries[0].data, eventData, "adding logger context must not mutate or merge into the caller's log data")
  assert.equal(JSON.stringify(entries[0]).includes("must-not-be-written"), false, "logger context must pass through the shared sensitive-field redactor")
})

test("replaces and clears logger context without retaining stale process identity", () => {
  const entries = []
  const logger = new Logger({
    transports: [{
      name: "capture",
      level: "trace",
      write(entry) {
        entries.push(entry)
      },
    }],
  })

  assert.equal(typeof logger.setContext, "function", "Logger must expose an explicit context replacement operation")
  logger.setContext({ application: "harvester", runtimeSessionId: "session-1" })
  logger.setContext({ application: "harvester", runtimeSessionId: "session-2" })
  logger.info({ message: "new process identity" })
  logger.setContext({})
  logger.info({ message: "context cleared" })

  assert.deepEqual(entries[0].context, {
    application: "harvester",
    runtimeSessionId: "session-2",
  }, "setting logger context again must replace the previous snapshot instead of merging stale fields")
  assert.equal(Object.hasOwn(entries[1], "context"), false, "an empty logger context must remove the optional context field")
})

test("preserves the existing Logger entry shape when no context is configured", () => {
  const entries = []
  const logger = new Logger({
    transports: [{
      name: "capture",
      level: "trace",
      write(entry) {
        entries.push(entry)
      },
    }],
  })

  logger.info({ message: "legacy entry" })

  assert.deepEqual(Object.keys(entries[0]), ["timestamp", "level", "method", "data"], "existing Logger consumers must receive the unchanged entry shape unless context is explicitly configured")
})
