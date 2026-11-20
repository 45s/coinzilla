import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

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
  "fs",
  "fs/promises",
  "net",
  "http",
  "https",
  "child_process",
  "worker_threads",
  "stream",
  "tls",
  "dgram",
  "os",
])

const PROHIBITED_API_PATTERNS = [
  {
    pattern: /\bDate\.now\s*\(/,
    label: "Date.now",
  },
  {
    pattern: /\bMath\.random\s*\(/,
    label: "Math.random",
  },
  {
    pattern: /\bprocess\.env\b/,
    label: "process.env",
  },
  {
    pattern: /\b(?:setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate)\s*\(/,
    label: "timer API",
  },
  {
    pattern: /\bfetch\s*\(/,
    label: "fetch",
  },
  {
    pattern: /\b(?:console|logger)\.(?:log|info|warn|error|debug|trace)\s*\(/,
    label: "logging",
  },
  {
    pattern: /\bnew\s+Date\s*\(\s*\)/,
    label: "uncontrolled Date construction",
  },
  {
    pattern: /\bperformance\.now\s*\(/,
    label: "performance.now",
  },
  {
    pattern: /\bprocess\.(?:cwd|hrtime)\b/,
    label: "process clock or working directory",
  },
  {
    pattern: /\b(?:randomBytes|randomUUID)\s*\(/,
    label: "randomness API",
  },
]

/**
 * Discover production JavaScript helper modules and colocated tests.
 * @param {string} root Repository root.
 * @returns {{ directory: string, file: string, testPath: string, hasTest: boolean }[]}
 */
export function findHelperSources(root) {
  const helpers = []

  function collectHelperFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          collectHelperFiles(join(directory, entry.name))
        }
        continue
      }
      if (
        !entry.isFile() ||
        !/\.(?:js|mjs|cjs)$/.test(entry.name) ||
        /\.(?:test|spec|fixture)\.(?:js|mjs|cjs)$/.test(entry.name)
      ) {
        continue
      }

      const file = join(directory, entry.name)
      const extension = entry.name.match(/\.(js|mjs|cjs)$/)?.[0] ?? ".js"
      const stem = entry.name.slice(0, -extension.length)
      const testPath = join(directory, [stem, ".test", extension].join(""))
      const specPath = join(directory, [stem, ".spec", extension].join(""))
      helpers.push({
        directory,
        file,
        testPath,
        hasTest: existsSync(testPath) || existsSync(specPath),
      })
    }
  }

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }
      const child = join(directory, entry.name)
      if (entry.name === "helpers") {
        collectHelperFiles(child)
      } else {
        visit(child)
      }
    }
  }

  for (const area of ["apps", "packages"]) {
    const directory = join(root, area)
    if (existsSync(directory)) {
      visit(directory)
    }
  }
  return helpers
}

/**
 * Heuristic purity checks; this does not prove purity or inspect transitive imports.
 * @param {{ file: string, source: string }} options
 * @returns {string[]}
 */
export function analyzeHelperSource({ file, source }) {
  const violations = []
  const importPattern = /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gm
  for (const match of source.matchAll(importPattern)) {
    if (EFFECTFUL_MODULES.has(match[1])) {
      violations.push([file, ": prohibited import from ", match[1]].join(""))
    }
  }

  for (const { pattern, label } of PROHIBITED_API_PATTERNS) {
    if (pattern.test(source)) {
      violations.push([file, ": prohibited use of ", label].join(""))
    }
  }

  if (/\bclass\s+[A-Za-z_$][\w$]*/.test(source)) {
    violations.push([file, ": classes are prohibited in helpers"].join(""))
  }
  if (/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:\{|\[)/m.test(source)) {
    violations.push([file, ": mutable module-level objects or arrays must be frozen"].join(""))
  }
  if (/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:new\s+)?(?:Set|Map)\s*\(/m.test(source)) {
    violations.push([file, ": mutable module-level collections are prohibited"].join(""))
  if (/\b(?:session|sessions|input|message|data|canonicalData|options|records|record|payload|params|order|fill|account|balances|orders|filters)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=|>)/.test(source)) {
    violations.push([file, ": possible caller-owned input mutation"].join(""))
  }
  }
  if (/\b(?:session|sessions|input|message|data|canonicalData|options|records|record|payload|params|order|fill|account|balances|orders|filters)\s*\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|set|add|delete|clear)\s*\(/.test(source)) {
    violations.push([file, ": possible caller-owned collection mutation"].join(""))
  }

  return violations
}

/**
 * Find missing colocated tests and source-level purity violations.
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function findHelperPolicyViolations(root) {
  const violations = []
  for (const helper of findHelperSources(root)) {
    if (!helper.hasTest) {
      const fileName = helper.file.split(/[\\/]/).at(-1)
      const testName = fileName.replace(/\.(?:js|mjs|cjs)$/, ".test.js")
      const specName = fileName.replace(/\.(?:js|mjs|cjs)$/, ".spec.js")
      violations.push([
        helper.file,
        ": missing directly associated unit test (",
        testName,
        " or ",
        specName,
        ")",
      ].join(""))
    }
    violations.push(...analyzeHelperSource({
      file: helper.file,
      source: readFileSync(helper.file, "utf8"),
    }))
  }
  return violations.sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const violations = findHelperPolicyViolations(root)
  if (violations.length > 0) {
    process.stderr.write([
      "Helper policy violations:\n",
      violations.map((violation) => ["- ", violation, "\n"].join("")).join(""),
    ].join(""))
    process.exitCode = 1
  } else {
    process.stdout.write("Helper policy passed for all discovered production helper modules.\n")
  }
}  if (/\bclass\s+[A-Za-z_$][\w$]*/.test(source)) {
    violations.push([file, ": classes are prohibited in helpers"].join(""))
  }
  if (/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:\{|\[)/m.test(source)) {
    violations.push([file, ": mutable module-level objects or arrays must be frozen"].join(""))
  }
  if (/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:new\s+)?(?:Set|Map)\s*\(/m.test(source)) {
    violations.push([file, ": mutable module-level collections are prohibited"].join(""))
  }
  if (/\b(?:session|sessions|input|message|data|canonicalData|options|records|record|payload|params|order|fill|account|balances|orders|filters)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=|>)/.test(source)) {
    violations.push([file, ": possible caller-owned input mutation"].join(""))
  }
  if (/\b(?:session|sessions|input|message|data|canonicalData|options|records|record|payload|params|order|fill|account|balances|orders|filters)\s*\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|set|add|delete|clear)\s*\(/.test(source)) {
    violations.push([file, ": possible caller-owned collection mutation"].join(""))
  }

  return violations
}

/**
 * Find missing colocated tests and source-level purity violations.
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function findHelperPolicyViolations(root) {
  const violations = []
  for (const helper of findHelperSources(root)) {
    if (!helper.hasTest) {
      const fileName = helper.file.split(/[\\/]/).at(-1)
      const testName = fileName.replace(/\.(?:js|mjs|cjs)$/, ".test.js")
      const specName = fileName.replace(/\.(?:js|mjs|cjs)$/, ".spec.js")
      violations.push([
        helper.file,
        ": missing directly associated unit test (",
        testName,
        " or ",
        specName,
        ")",
      ].join(""))
    }
    violations.push(...analyzeHelperSource({
      file: helper.file,
      source: readFileSync(helper.file, "utf8"),
    }))
  }
  return violations.sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const violations = findHelperPolicyViolations(root)
  if (violations.length > 0) {
    process.stderr.write([
      "Helper policy violations:\n",
      violations.map((violation) => ["- ", violation, "\n"].join("")).join(""),
    ].join(""))
    process.exitCode = 1
  } else {
    process.stdout.write("Helper policy passed for all discovered production helper modules.\n")
  }
}
