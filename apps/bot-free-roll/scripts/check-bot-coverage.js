import { spawnSync } from "node:child_process"

import {
  evaluateCoverageThresholds,
  parseCoverageRow,
} from "./coverage-report.js"

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
  const output = `${result.stdout}\n${result.stderr}`
  const coverageGates = [
    {
      name: "Free-Roll application",
      fileName: "all files",
      thresholds: { statements: 80, branches: 90, functions: 85 },
    },
    {
      name: "FreeRollBot orchestrator",
      fileName: "bot-free-roll.js",
      thresholds: { statements: 95, branches: 75 },
    },
  ]

  for (const gate of coverageGates) {
    const parsed = parseCoverageRow({ output, fileName: gate.fileName })

    if (!parsed.ok) {
      console.error(parsed.error)
      process.exitCode = 1
      continue
    }

    const evaluation = evaluateCoverageThresholds({
      coverage: parsed.coverage,
      thresholds: gate.thresholds,
    })

    const actual = Object.entries(parsed.coverage)
      .map(([metric, value]) => `${metric}: ${value}%`)
      .join(", ")
    const minimum = Object.entries(gate.thresholds)
      .map(([metric, value]) => `${metric}: ${value}%`)
      .join(", ")

    console.log(`${gate.name} coverage — ${actual} (minimum ${minimum})`)

    if (!evaluation.passed) {
      for (const violation of evaluation.violations) {
        console.error(
          `Coverage threshold failed for ${gate.name}: ${violation.metric} is ${violation.actual}%, minimum is ${violation.minimum}%`,
        )
      }

      process.exitCode = 1
    }
  }
}
