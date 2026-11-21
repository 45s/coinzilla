const POLICY_TABLE_HEADER = "| Consumer | Allowed direct workspace dependencies |"
const PACKAGE_NAME_PATTERN = /^\`(@coinzilla\/[a-z0-9-]+)\`$/
const ALLOWED_PACKAGE_NAME_PATTERN = /\`(@coinzilla\/[a-z0-9-]+)\`/g

const parsePolicyPackageName = ({ cell }) => {
  const match = cell.match(PACKAGE_NAME_PATTERN)

  if (!match) {
    throw new Error(`Malformed workspace dependency policy row: ${cell}`)
  }

  return match[1]
}

const parseAllowedDependencies = ({ cell, consumer }) => {
  if (cell === "None") {
    return []
  }

  const matches = [...cell.matchAll(ALLOWED_PACKAGE_NAME_PATTERN)]
  const remainder = cell.replace(ALLOWED_PACKAGE_NAME_PATTERN, "").replace(/[\s,]/g, "")

  if (matches.length === 0 || remainder.length > 0) {
    throw new Error(`Malformed workspace dependency policy row for ${consumer}: ${cell}`)
  }

  const dependencies = matches.map((match) => match[1])
  const uniqueDependencies = new Set()

  for (const dependency of dependencies) {
    if (uniqueDependencies.has(dependency)) {
      throw new Error(`Duplicate allowed workspace dependency: ${dependency}`)
    }

    uniqueDependencies.add(dependency)
  }

  if (uniqueDependencies.has(consumer)) {
    throw new Error("Workspace dependency policy cannot allow a package to depend on itself.")
  }

  return [...uniqueDependencies].sort()
}

/**
 * Parse the canonical workspace dependency allowlist from Domain Ownership.
 *
 * The parser intentionally accepts only the documented two-column Markdown
 * table and @coinzilla package names. Unexpected formatting fails closed so
 * policy changes cannot silently disable dependency checks.
 *
 * @param {{markdown: string}} options
 * @returns {Record<string, string[]>}
 * @throws {Error} If the table is missing, malformed or contains duplicate rows/edges.
 */
export function parseWorkspaceDependencyPolicy({ markdown }) {
  const lines = markdown.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim() === POLICY_TABLE_HEADER)

  if (headerIndex < 0) {
    throw new Error("Canonical workspace dependency policy table header is missing.")
  }

  const separator = lines[headerIndex + 1]?.trim()

  if (!separator || !/^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|$/.test(separator)) {
    throw new Error("Canonical workspace dependency policy table separator is malformed.")
  }

  const policy = {}

  for (const line of lines.slice(headerIndex + 2)) {
    const row = line.trim()

    if (!row || !row.startsWith("|")) {
      break
    }

    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim())

    if (cells.length !== 2) {
      throw new Error(`Malformed workspace dependency policy row: ${row}`)
    }

    const consumer = parsePolicyPackageName({
      cell: cells[0],
    })

    if (Object.hasOwn(policy, consumer)) {
      throw new Error(`Duplicate workspace dependency policy consumer: ${consumer}`)
    }

    policy[consumer] = parseAllowedDependencies({
      cell: cells[1],
      consumer,
    })
  }

  if (Object.keys(policy).length === 0) {
    throw new Error("Canonical workspace dependency policy table contains no package rows.")
  }

  return Object.fromEntries(
    Object.keys(policy).sort().map((consumer) => [consumer, policy[consumer]]),
  )
}
