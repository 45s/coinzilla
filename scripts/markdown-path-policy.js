const HISTORICAL_PATHS = [
  /^apps\/harvester\/AUDIT(?:_|\.|$)/,
  /^apps\/harvester\/docs\/audits\/(?:README_HISTORY|ROADMAP_HISTORY)\.md$/,
  /^apps\/harvester\/docs\/audits\/(?:evidence|reports|sessions)\/(?!README\.md$).+/,
  /^apps\/harvester\/docs\/incidents\/(?!README\.md$).+/,
  /^apps\/harvester\/docs\/tasks\/(?!README\.md$).+/,
  /^apps\/harvester\/docs\/DDD_CLEAN_ARCHITECTURE_AUDIT\.md$/,
  /^apps\/harvester\/docs\/DOMAIN_FIRST_DELIVERY_PLAN\.md$/,
  /^docs\/audits\/(?!README\.md$).+/,
  /^docs\/ai-agent\/repository-engineering-audit\.md$/,
]

const TEMPLATE_HEADING_EXEMPTIONS = [
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
]

function matchesAny({ path, patterns }) {
  return patterns.some((pattern) => pattern.test(path))
}

/**
 * Classify a repository-relative Markdown path for style and anchor enforcement.
 *
 * @param {string} path Repository-relative Markdown/MDX path.
 * @returns {"historical" | "github-template" | "maintained" | "unknown"}
 */
export function classifyMarkdownPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    return "unknown"
  }
  if (matchesAny({
    path,
    patterns: HISTORICAL_PATHS,
  })) {
    return "historical"
  }
  if (matchesAny({
    path,
    patterns: TEMPLATE_HEADING_EXEMPTIONS,
  })) {
    return "github-template"
  }
  return "maintained"
}

/**
 * Whether a document is historical evidence excluded from blocking enforcement.
 *
 * @param {string} path Repository-relative path.
 * @returns {boolean}
 */
export function isHistoricalPath(path) {
  return classifyMarkdownPath(path) === "historical"
}

/**
 * Whether GitHub's issue/PR template heading conventions are exempt.
 *
 * @param {string} path Repository-relative path.
 * @returns {boolean}
 */
export function isTemplateHeadingExempt(path) {
  return classifyMarkdownPath(path) === "github-template"
}
