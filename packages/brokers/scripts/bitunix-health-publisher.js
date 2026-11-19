import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import {
  createDiagnosticReport,
  createDiagnosticResult,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
} from "./bitunix-diagnostics.js"

const execFileAsync = promisify(execFile)
const REPORT_COMMIT_MESSAGE = "chore(brokers): publish sanitized Bitunix health report"
const REQUIRED_HEALTH_OPERATIONS = Object.freeze([
  "diagnostic safety confirmation",
  "diagnostic configuration",
  "REST private account balances",
  "WebSocket connection",
  "ping",
  "user.account",
  "user.info",
])

function createTimestamp({ now }) {
  return new Date(now()).toISOString().replaceAll(/[-:.]/g, "")
}

function createReportPaths({ repositoryRoot, timestamp }) {
  const filename = `bitunix-health-${timestamp}.json`
  return {
    local: resolve(repositoryRoot, "packages/brokers/.diagnostics", filename),
    published: resolve(repositoryRoot, "packages/brokers/diagnostics/reports", filename),
  }
}

function getRelativePath({ repositoryRoot, path }) {
  return relative(repositoryRoot, path).split(sep).join("/")
}

function getSecrets({ env }) {
  return [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
}

function validatePrivateCredentials({ env }) {
  const missing = ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"].filter((name) =>
    typeof env[name] !== "string" || !env[name].trim())
  if (missing.length > 0) {
    throw new Error(`Bitunix health check requires both read-only credentials; missing: ${missing.join(", ")}`)
  }
}

async function executeGitCommand({ repositoryRoot, args }) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
  return stdout.trim()
}

async function validateStartingState({ repositoryRoot, runGit }) {
  const actualRoot = await runGit({
    repositoryRoot,
    args: ["rev-parse", "--show-toplevel"],
  })
  if (resolve(actualRoot) !== repositoryRoot) {
    throw new Error("Run the Bitunix health command from inside the Coinzilla repository")
  }
  const status = await runGit({
    repositoryRoot,
    args: ["status", "--porcelain", "--untracked-files=all"],
  })
  if (status) {
    throw new Error("Bitunix health publishing requires a clean working tree; commit or move your changes first")
  }
  const branch = await runGit({
    repositoryRoot,
    args: ["branch", "--show-current"],
  })
  if (branch !== "develop") {
    throw new Error("Bitunix health publishing must start on develop so the script can safely return there")
  }
  const origin = await runGit({
    repositoryRoot,
    args: ["remote", "get-url", "origin"],
  })
  if (!origin) {
    throw new Error("Bitunix health publishing requires a configured origin remote")
  }
}

function createRunnerFailureReport({ error, env, startedAt, now }) {
  const finishedAt = now()
  const secrets = getSecrets({ env })
  const result = createDiagnosticResult({
    operation: "diagnostic runner",
    status: "failed",
    error,
    secrets,
  })
  return createDiagnosticReport({
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    results: [result],
    events: [],
  })
}

async function runDiagnosticsSafely({ runDiagnostics, env, now }) {
  const startedAt = now()
  try {
    return await runDiagnostics({ env })
  } catch (error) {
    return createRunnerFailureReport({
      error,
      env,
      startedAt,
      now,
    })
  }
}

function validateDiagnosticReport({ report }) {
  if (!report || typeof report !== "object" || !Array.isArray(report.results) || !report.summary) {
    throw new TypeError("Bitunix diagnostics returned an invalid report; refusing to publish it")
  }
  if (!Number.isInteger(report.summary.failed) || report.summary.failed < 0) {
    throw new TypeError("Bitunix diagnostics report has an invalid failed-check count")
  }
}

async function writeDiagnosticReport({ path, report }) {
  await mkdir(dirname(path), {
    recursive: true,
  })
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
}

function withholdFreeFormErrorMessages({ value }) {
  if (Array.isArray(value)) {
    return value.map((item) => withholdFreeFormErrorMessages({ value: item }))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const sanitized = Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    withholdFreeFormErrorMessages({ value: entryValue }),
  ]))
  if (typeof sanitized.name === "string" && typeof sanitized.message === "string") {
    sanitized.message = "[error message withheld]"
  }
  return sanitized
}

function createPublishedReport({ report }) {
  return {
    ...report,
    results: report.results.map((result) => {
      if (!result.error) {
        return result
      }
      const error = {
        ...result.error,
        message: "[error message withheld from public report]",
      }
      if (error.cause) {
        error.cause = {
          ...error.cause,
          message: "[nested error message withheld from public report]",
        }
      }
      return {
        ...result,
        error,
      }
    }),
  }
}

async function writeReports({ paths, report, env }) {
  const sanitized = withholdFreeFormErrorMessages({
    value: sanitizeDiagnosticValue({
      value: report,
      secrets: getSecrets({ env }),
    }),
  })
  const published = createPublishedReport({
    report: sanitized,
  })
  await writeDiagnosticReport({
    path: paths.local,
    report: sanitized,
  })
  await writeDiagnosticReport({
    path: paths.published,
    report: published,
  })
  return {
    local: sanitized,
    published,
  }
}

async function publishReportBranch({ repositoryRoot, runGit, branch, reportPath, env }) {
  await runGit({
    repositoryRoot,
    args: ["add", "--", reportPath],
  })
  await runGit({
    repositoryRoot,
    args: ["commit", "--only", "-m", REPORT_COMMIT_MESSAGE, "--", reportPath],
  })
  const commitSha = await runGit({
    repositoryRoot,
    args: ["rev-parse", "HEAD"],
  })
  let pushError = null
  try {
    await runGit({
      repositoryRoot,
      args: ["push", "--set-upstream", "origin", branch],
    })
  } catch (error) {
    pushError = sanitizeDiagnosticError({
      error,
      secrets: getSecrets({ env }),
    }).message
  }
  return {
    commitSha,
    pushError,
  }
}

async function switchBackToDevelop({ repositoryRoot, runGit }) {
  await runGit({
    repositoryRoot,
    args: ["switch", "develop"],
  })
}

function evaluateHealthCheck({ report }) {
  const passedOperations = new Set(
    report.results
      .filter((result) => result.status === "passed")
      .map((result) => result.operation),
  )
  const missingRequiredOperations = REQUIRED_HEALTH_OPERATIONS.filter((operation) =>
    !passedOperations.has(operation))
  return {
    requiredOperations: REQUIRED_HEALTH_OPERATIONS,
    missingRequiredOperations,
    healthy: report.summary.failed === 0 && missingRequiredOperations.length === 0,
  }
}

async function runOnReportBranch({ repositoryRoot, runGit, branch, paths, publishedReportPath, runDiagnostics, env, now }) {
  const report = await runDiagnosticsSafely({
    runDiagnostics,
    env,
    now,
  })
  validateDiagnosticReport({ report })
  const healthCheck = evaluateHealthCheck({ report })
  const reports = await writeReports({
    paths,
    report: {
      ...report,
      healthCheck,
    },
    env,
  })
  const publication = await publishReportBranch({
    repositoryRoot,
    runGit,
    branch,
    reportPath: publishedReportPath,
    env,
  })
  return {
    report: reports.published,
    healthCheck,
    ...publication,
  }
}

function throwWorkflowErrors({ operationError, cleanupError }) {
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "Bitunix diagnostics failed and the checkout could not be returned to develop",
    )
  }
  if (operationError) {
    throw operationError
  }
  if (cleanupError) {
    throw cleanupError
  }
}

async function executeReportBranchWorkflow({ repositoryRoot, runGit, branch, paths, publishedReportPath, runDiagnostics, env, now }) {
  let branchCreated = false
  let operationError = null
  let cleanupError = null
  let result

  try {
    await runGit({
      repositoryRoot,
      args: ["fetch", "origin", "refs/heads/develop:refs/remotes/origin/develop"],
    })
    await runGit({
      repositoryRoot,
      args: ["switch", "--create", branch, "--track", "origin/develop"],
    })
    branchCreated = true
    result = await runOnReportBranch({
      repositoryRoot,
      runGit,
      branch,
      paths,
      publishedReportPath,
      runDiagnostics,
      env,
      now,
    })
  } catch (error) {
    operationError = error
  } finally {
    if (branchCreated) {
      try {
        await switchBackToDevelop({
          repositoryRoot,
          runGit,
        })
      } catch (error) {
        cleanupError = error
      }
    }
  }

  throwWorkflowErrors({
    operationError,
    cleanupError,
  })
  return result
}

export async function publishBitunixDiagnostics({
  repositoryRoot,
  runDiagnostics,
  runGit = executeGitCommand,
  env = process.env,
  now = Date.now,
} = {}) {
  if (typeof runDiagnostics !== "function") {
    throw new TypeError("A Bitunix diagnostic runner must be provided")
  }
  const root = resolve(repositoryRoot)
  await validateStartingState({
    repositoryRoot: root,
    runGit,
  })
  validatePrivateCredentials({ env })
  const timestamp = createTimestamp({ now })
  const branch = `diagnostics/bitunix-health-${timestamp}`
  const paths = createReportPaths({
    repositoryRoot: root,
    timestamp,
  })
  const publishedReportPath = getRelativePath({
    repositoryRoot: root,
    path: paths.published,
  })
  const execution = await executeReportBranchWorkflow({
    repositoryRoot: root,
    runGit,
    branch,
    paths,
    publishedReportPath,
    runDiagnostics,
    env,
    now,
  })
  return {
    branch,
    commitSha: execution.commitSha,
    report: execution.report,
    healthCheck: execution.healthCheck,
    reportPath: publishedReportPath,
    localReportPath: getRelativePath({
      repositoryRoot: root,
      path: paths.local,
    }),
    pushError: execution.pushError,
    exitCode: !execution.healthCheck.healthy || execution.pushError ? 1 : 0,
  }
}
