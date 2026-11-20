import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "generated",
  "vendor",
  "fixtures",
  "tests",
])

const EFFECTFUL_MODULES = new Set([
  "node:fs",
  "node:fs/promises",
  "node:net",
  "node:http",
  "node:https",
  "node:child_process",
  "node:worker_threads",
  "node:stream",
  "node:tls",
  "node:dgram",
  "node:os",
])

const PROHIBITED_API_PATTERNS = [
  { pattern: /\bDate\.now\s*\(/, label: "Date.now" },
  { pattern: /\bMath\.random\s*\(/, label: "Math.random" },
  { pattern: /\bprocess\.env\b/, label: "process.env" },
  { pattern: /\b(?:setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate)\s*\(/, label: "timer API" },
  { pattern: /\bfetch\s*\(/, label: "fetch" },
  { pattern: /\\b(?:console|logger)\\.(?:log|info|warn|error|debug|trace)\\s*\\(/, label: "logging" },
  { pattern: /\\bnew\\s+Date\\s*\\(\\s*\\)/, label: "uncontrolled Date construction" },
  { pattern: /\\b(?:randomBytes|randomUUID)\\s*\\(/, label: "randomness API" },
]

/**
 * Recursively discover production JavaScript helper modules and sibling tests.
 * @param {string} root Repository root.
 * @returns {{ directory: string, file: string, testPath: string, hasTest: boolean }[]}
 */
export function findHelperSources(root) {
  const helpers = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }
      const child = join(directory, entry.name)
      if (entry.name === "helpers") {
        collectHelperFiles(child)
        continue
      }
      visit(child)
    }
  }

  function collectHelperFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          collectHelperFiles(join(directory, entry.name))
        }
        continue
      }
      if (!entry.isFile() || !/\\.(?:js|mjs|cjs)$/.test(entry.name) ||
          /\\.(?:test|spec|fixture)\\.(?:js|mjs|cjs)$/.test(entry.name)) {
        continue
      }
      const file = join(directory, entry.name)
      const extension = entry.name.match(/\\.(js|mjs|cjs)$/)?.[0] ?? ".js"
      const stem = entry.name.slice(0, -extension.length)
      const testPath = join(directory, stem + ".test" + extension)
      const specPath = join(directory, stem + ".spec" + extension)
      helpers.push({
        directory,
        file,
        testPath,
        hasTest: existsSync(testPath) || existsSync(specPath),
      })
    }
  }

  for (const area of ["apps", "packages"]) {
    const directory = join(root, area)
    if (existsSync(directory)) {
      visit(directory)
    }
  }
  return helpers.sort((left, right) => left.file.localeCompare(right.file))
}

/**
 * Analyze one helper module for detectable impurity patterns.
 * This conservative scanner is a guardrail, not a mathematical purity proof.
 * @param {{ file: string, source: string }} options
 * @returns {string[]}
 */
export function analyzeHelperSource({ file, source }) {
  const violations = []
  const importPattern = /\bfrom\s*["']([^"']+)["']/g
  for (const match of source.matchAll(importPattern)) {
    if (EFFECTFUL_MODULES.has(match[1])) {
      violations.push(file + ": prohibited import from " + match[1])
    }
  }

  for (const { pattern, label } of PROHIBITED_API_PATTERNS) {
    if (pattern.test(source)) {
      violations.push(file + ": prohibited use of " + label)
    }
  }

  if (/\bclass\s+[A-Za-z_$][\w$]*/.test(source)) {
    violations.push(file + ": stateful classes are prohibited in helpers")
  }

  if (/\b(?:session|sessions|input|message|data|canonicalData|options|records|record|payload|params|order|fill|account|balances|orders|filters)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/.test(source)) {
    violations.push(file + ": mutation of caller-owned input is prohibited")
  }

  if (/^\\s*(?:export\\s+)?const\\s+[A-Za-z_$][\\w$]*\\s*=\\s*(?:new\\s+)?(?:Set|Map)\\s*\\(/m.test(source)) {
    violations.push(file + ": mutable module-level collections are prohibited")
  }

  return violations
}

/**
 * Return every helper-policy violation in the repository.
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function findHelperPolicyViolations(root) {
  const violations = []
  for (const helper of findHelperSources(root)) {
    if (!helper.hasTest) {
      violations.push(helper.file + ": missing directly associated unit test (" +
        helper.file.split("/").at(-1).replace(/\.(?:js|mjs|cjs)$/, ".test.js") +
        " or " + helper.file.split("/").at(-1).replace(/\.(?:js|mjs|cjs)$/, ".spec.js") + ")")
    }
    violations.push(...analyzeHelperSource({
      file: helper.file,
      source: readFileSync(helper.file, "utf8"),
    }))
  }
  return violations.sort()
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const root = new URL("../", import.meta.url).pathname
  const violations = findHelperPolicyViolations(root)
  if (violations.length > 0) {
    process.stderr.write("Helper policy violations:\n" + violations.map((violation) => "- " + violation).join("\n") + "\n")
    process.exitCode = 1
  } else {
    process.stdout.write("Helper policy passed for all discovered production helper modules.\n")
  }
}
