import { spawnSync } from "node:child_process"

const coverageThresholds = [
  ["bot-free-roll.js", 95, 75],
  ["fill-ledger.js", 100, 100],
  ["inventory-allocation.js", 100, 100],
  ["event-handling.js", 90, 90],
  ["fill-reconciliation.js", 95, 75],
  ["accounting.js", 90, 85],
  ["decimal.js", 95, 90],
  ["order-planning.js", 90, 60],
  ["price.js", 80, 65],
  ["trading-rules.js", 90, 90],
  ["order-execution.js", 95, 75],
  ["prepare-broker.js", 80, 70],
  ["validate-config.js", 90, 90],
]

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-test-coverage"],
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
  const coverageLines = result.stdout.split(/\r?\n/)
  const failures = []

  for (const [filename, minimumLineCoverage, minimumBranchCoverage] of coverageThresholds) {
    const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(
      `^\\s*#\\s+${escapedFilename}\\s+\\|\\s+([\\d.]+)\\s+\\|\\s+([\\d.]+)`,
    )
    const matches = coverageLines
      .map((line) => line.match(pattern))
      .filter(Boolean)

    if (matches.length === 0) {
      failures.push(`${filename}: missing from coverage report`)
      continue
    }

    for (const match of matches) {
      const lineCoverage = Number(match[1])
      const branchCoverage = Number(match[2])

      if (
        lineCoverage < minimumLineCoverage ||
        branchCoverage < minimumBranchCoverage
      ) {
        failures.push(
          `${filename}: ${lineCoverage}% lines / ${branchCoverage}% branches; minimum ${minimumLineCoverage}% / ${minimumBranchCoverage}%`,
        )
      }
    }
  }

  console.log("\nFree-Roll source coverage gates:")
  for (const [filename, minimumLineCoverage, minimumBranchCoverage] of coverageThresholds) {
    console.log(`  ${filename}: minimum ${minimumLineCoverage}% lines / ${minimumBranchCoverage}% branches`)
  }

  if (failures.length > 0) {
    console.error("\nCoverage gate failed:")
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  }
}
