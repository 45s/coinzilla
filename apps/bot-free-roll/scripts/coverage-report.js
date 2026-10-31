const COVERAGE_METRICS = ["statements", "branches", "functions"]

export function parseCoverageRow({ output, fileName }) {
  if (typeof output !== "string" || typeof fileName !== "string" || !fileName.trim()) {
    return { ok: false, error: "Coverage output and file name are required" }
  }

  const row = output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#\s?/, ""))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .find((cells) => cells[0]?.toLowerCase() === fileName.trim().toLowerCase())

  if (!row || row.length < COVERAGE_METRICS.length + 1) {
    return { ok: false, error: `Could not find coverage row for "${fileName}"` }
  }

  const values = row.slice(1, COVERAGE_METRICS.length + 1).map(Number)

  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return { ok: false, error: `Coverage row for "${fileName}" contains invalid percentages` }
  }

  return {
    ok: true,
    coverage: Object.fromEntries(
      COVERAGE_METRICS.map((metric, index) => [metric, values[index]]),
    ),
  }
}

export function evaluateCoverageThresholds({ coverage, thresholds }) {
  if (!coverage || !thresholds || typeof coverage !== "object" || typeof thresholds !== "object") {
    return {
      passed: false,
      violations: [{ metric: "configuration", actual: null, minimum: null }],
    }
  }

  const violations = Object.entries(thresholds)
    .filter(([metric, minimum]) => (
      !Number.isFinite(coverage[metric]) ||
      !Number.isFinite(minimum) ||
      minimum < 0 ||
      minimum > 100 ||
      coverage[metric] < minimum
    ))
    .map(([metric, minimum]) => ({
      metric,
      actual: coverage[metric] ?? null,
      minimum,
    }))

  return { passed: violations.length === 0, violations }
}
