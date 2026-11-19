import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { publishBitunixDiagnostics } from "./bitunix-health-publisher.js"

const fixedTimestamp = Date.parse("2026-11-19T08:30:00.000Z")
const apiKey = "private-test-api-key"
const apiSecret = "private-test-api-secret"

function createFakeGit({ repositoryRoot, failPush = false } = {}) {
  const calls = []
  const runGit = async ({ args }) => {
    calls.push(args)
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return repositoryRoot
    }
    if (args[0] === "status") {
      return ""
    }
    if (args[0] === "branch") {
      return "develop"
    }
    if (args[0] === "remote") {
      return "https://github.com/45s/coinzilla.git"
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return "report-commit-sha"
    }
    if (args[0] === "push" && failPush) {
      throw new Error("simulated push failure")
    }
    return ""
  }
  return { calls, runGit }
}

function createDiagnosticReport({ failed = 0 } = {}) {
  return {
    schemaVersion: 1,
    startedAt: "2026-11-19T08:29:00.000Z",
    finishedAt: "2026-11-19T08:30:00.000Z",
    runtime: {
      node: "v24.0.0",
    },
    summary: {
      total: 2,
      passed: 2 - failed,
      failed,
      skipped: 0,
    },
    results: [{
      operation: "user.account",
      status: failed > 0 ? "failed" : "passed",
      request: {
        apiKey,
        sign: "private-signature",
      },
      response: {
        uid: "private-uid",
        balance: "123.456",
      },
    }],
    events: [],
  }
}

async function createRepositoryDirectory() {
  return mkdtemp(join(tmpdir(), "bitunix-health-publisher-"))
}

test("publishes only a sanitized report from a fresh diagnostics branch and returns to develop", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishBitunixDiagnostics({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport(),
      env: { BITUNIX_API_KEY: apiKey, BITUNIX_API_SECRET: apiSecret },
      now: () => fixedTimestamp,
    })

    assert.equal(result.branch, "diagnostics/bitunix-health-20261119T083000000Z", "the report branch must have a unique UTC timestamped name")
    assert.equal(result.commitSha, "report-commit-sha", "the pushed report commit SHA must be returned for inspection")
    assert.equal(result.exitCode, 0, "a fully successful read-only health check must return a successful exit code")
    assert.equal(calls.some((args) => args[0] === "fetch" && args[1] === "origin" && args[2] === "develop"), true, "the report branch must start from the latest fetched origin/develop")
    assert.equal(calls.some((args) => args[0] === "switch" && args[1] === "--create" && args[3] === "--track" && args[4] === "origin/develop"), true, "the script must create a dedicated branch tracking the fetched develop tip")
    assert.equal(calls.some((args) => args[0] === "push" && args[1] === "--set-upstream" && args[2] === "origin"), true, "the report branch must be pushed without force")
    assert.deepEqual(calls.find((args) => args[0] === "commit"), ["commit", "--only", "-m", "chore(brokers): publish sanitized Bitunix health report", "--", result.reportPath], "the commit must include only the generated sanitized report even if other files become staged concurrently")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "the script must return to develop after publishing the report")
    const reportPath = join(repositoryRoot, "packages", "brokers", "diagnostics", "reports", "bitunix-health-20261119T083000000Z.json")
    const report = await readFile(reportPath, "utf8")
    const localReport = await readFile(join(repositoryRoot, "packages", "brokers", ".diagnostics", "bitunix-health-20261119T083000000Z.json"), "utf8")
    assert.equal(report.includes(apiKey), false, "the committed report must never contain the API key")
    assert.equal(report.includes(apiSecret), false, "the committed report must never contain the API secret")
    assert.equal(report.includes("private-signature"), false, "the committed report must never contain request signatures")
    assert.equal(report.includes("private-uid"), false, "the committed report must never contain account identifiers")
    assert.equal(report.includes("123.456"), false, "the committed report must never contain account balances")
    assert.equal(localReport.includes("123.456"), false, "the local report must apply the same account-value redaction as the committed report")
    assert.equal(result.reportPath.endsWith("bitunix-health-20261119T083000000Z.json"), true, "the result must identify the report path to inspect")
    assert.equal(result.localReportPath.endsWith(".diagnostics/bitunix-health-20261119T083000000Z.json"), true, "the full local diagnostic artifact must stay in the ignored diagnostics directory")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("rejects a dirty worktree before fetching, creating a branch or contacting Bitunix", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit: baseRunGit } = createFakeGit({ repositoryRoot })
  const runGit = async ({ args }) => {
    if (args[0] === "status") {
      calls.push(args)
      return " M packages/brokers/src/index.js"
    }
    return baseRunGit({ args })
  }
  try {
    await assert.rejects(
      publishBitunixDiagnostics({
        repositoryRoot,
        runGit,
        runDiagnostics: async () => {
          throw new Error("Bitunix must not be contacted when the worktree is dirty")
        },
        now: () => fixedTimestamp,
      }),
      /clean working tree/,
      "the command must refuse to risk switching away from uncommitted user work",
    )
    assert.equal(calls.some((args) => args[0] === "fetch"), false, "a dirty worktree must be rejected before network or branch operations")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("rejects a starting branch other than develop before contacting Bitunix", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit: baseRunGit } = createFakeGit({ repositoryRoot })
  const runGit = async ({ args }) => {
    if (args[0] === "branch") {
      calls.push(args)
      return "feature/user-work"
    }
    return baseRunGit({ args })
  }
  try {
    await assert.rejects(
      publishBitunixDiagnostics({
        repositoryRoot,
        runGit,
        runDiagnostics: async () => {
          throw new Error("Bitunix must not be contacted outside develop")
        },
        now: () => fixedTimestamp,
      }),
      /must start on develop/,
      "the command must require develop as its known return destination",
    )
    assert.equal(calls.some((args) => args[0] === "fetch"), false, "a non-develop starting branch must be rejected before any remote operation")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("push failure still switches the local checkout back to develop", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot, failPush: true })
  try {
    const result = await publishBitunixDiagnostics({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport(),
      env: {},
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "a failed report push must make the command fail rather than claiming publication")
    assert.match(result.pushError, /simulated push failure/, "the push failure must remain visible for troubleshooting")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "a failed push must not leave the user's checkout on the report branch")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("publishes failed API diagnostics and returns a failing exit code after cleanup", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishBitunixDiagnostics({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => createDiagnosticReport({ failed: 1 }),
      env: {},
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "an API diagnostic failure must remain a failing command result after its report is published")
    assert.equal(result.report.summary.failed, 1, "the pushed report must preserve the failed Bitunix operation")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "failed API diagnostics must still return the checkout to develop")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})


test("publishes a sanitized failure report when the diagnostic runner throws", async () => {
  const repositoryRoot = await createRepositoryDirectory()
  const { calls, runGit } = createFakeGit({ repositoryRoot })
  try {
    const result = await publishBitunixDiagnostics({
      repositoryRoot,
      runGit,
      runDiagnostics: async () => {
        throw new Error(`Bitunix request failed for ${apiSecret}`)
      },
      env: {
        BITUNIX_API_KEY: apiKey,
        BITUNIX_API_SECRET: apiSecret,
      },
      now: () => fixedTimestamp,
    })

    assert.equal(result.exitCode, 1, "an unexpected diagnostic exception must produce a failing health-check exit code")
    assert.equal(result.report.summary.failed, 1, "an unexpected diagnostic exception must be represented as a failed report operation")
    assert.equal(JSON.stringify(result.report).includes(apiSecret), false, "the generated failure report must redact credential values from exception messages")
    assert.equal(calls.some((args) => args[0] === "push"), true, "a sanitized failure report must still be pushed when Git operations succeed")
    assert.deepEqual(calls.at(-1), ["switch", "develop"], "a thrown diagnostic exception must still return the checkout to develop")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})
