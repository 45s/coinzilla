const HISTORICAL_PATHS = Object.freeze([
  /^apps\\/harvester\\/AUDIT(?:_|\\.|$)/,
  /^apps\\/harvester\\/docs\\/audits\\//,
  /^apps\\/harvester\\/docs\\/incidents\\//,
  /^apps\\/harvester\\/docs\\/tasks\\//,
  /^apps\\/harvester\\/docs\\/DDD_CLEAN_ARCHITECTURE_AUDIT\\.md$/,
  /^apps\\/harvester\\/docs\\/DOMAIN_FIRST_DELIVERY_PLAN\\.md$/,
  /^docs\\/audits\\//,
  /^docs\\/ai-agent\\/repository-engineering-audit\\.md$/,
]);

const TEMPLATE_HEADING_EXEMPTIONS = Object.freeze([
  /^\\.github\\/ISSUE_TEMPLATE\\//,
  /^\\.github\\/PULL_REQUEST_TEMPLATE\\.md$/,
]);

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

/**
 * Whether a document is historical evidence excluded from maintained-doc enforcement.
 * @param {string} path Repository-relative path.
 * @returns {boolean}
 */
export function isHistoricalPath(path) {
  return typeof path === "string" && matchesAny(path, HISTORICAL_PATHS);
}

/**
 * Whether a GitHub issue or pull-request template uses an exempt heading convention.
 * @param {string} path Repository-relative path.
 * @returns {boolean}
 */
export function isTemplateHeadingExempt(path) {
  return typeof path === "string" && matchesAny(path, TEMPLATE_HEADING_EXEMPTIONS);
}
