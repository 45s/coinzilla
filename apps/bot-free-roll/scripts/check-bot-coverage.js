import { spawnSync } from "node:child_process"

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-test-coverage", "src/bot"],
  { encoding: "utf8" },
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1
} else {
  const match = result.stdout.match(
    /bot-free-roll\\.js\\s+\\|\\s+([\\d.]+)\\s+\\|\\s+([\\d.]+)/,
  )

  if (!match) {
    throw new Error("Could not find bot-free-roll.js in the Node.js coverage report")
  }

  const lineCoverage = Number(match[1])
  const branchCoverage = Number(match[2])
  const minimumLineCoverage = 95
  const minimumBranchCoverage = 75

  console.log(
    `FreeRollBot coverage: ${lineCoverage}% lines, ${branchCoverage}% branches (minimum ${minimumLineCoverage}% / ${minimumBranchCoverage}%)`,
  )

  if (
    lineCoverage < minimumLineCoverage ||
    branchCoverage < minimumBranchCoverage
  ) {
    process.exitCode = 1
  }
}
