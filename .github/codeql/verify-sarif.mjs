#!/usr/bin/env node
/**
 * Assert the CodeQL query experiment preserves password-hash coverage.
 * Uses only Node.js built-ins; no Python or third-party runtime dependency.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const CUSTOM_RULE_ID = "coinzilla/js-insufficient-password-hash";
const BUILTIN_RULE_ID = "js/insufficient-password-hash";
const BITUNIX_API_KEY_SOURCE_PATHS = [
  "packages/brokers/scripts/bitunix/operator/order-probe-attempt.js",
  "packages/brokers/scripts/bitunix/operator/order-probe-attempt.test.js",
  "packages/brokers/src/infrastructure/bitunix/spot/api/rest-client.js",
  "packages/brokers/src/infrastructure/bitunix/spot/api/websocket-client.js",
  "packages/brokers/src/infrastructure/bitunix/spot/auth/create-rest-signature.js",
  "packages/brokers/src/infrastructure/bitunix/spot/auth/create-websocket-signature.js",
  "packages/brokers/src/infrastructure/bitunix/spot/broker.js",
];
const BITUNIX_ALERT_SINKS = new Set([
  "packages/brokers/src/infrastructure/bitunix/spot/auth/create-rest-signature.js:75",
  "packages/brokers/src/infrastructure/bitunix/spot/auth/create-websocket-signature.js:63",
]);

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function loadSarif(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function getRun(sarif) {
  const runs = sarif.runs ?? [];
  if (runs.length !== 1) {
    throw new Error(`Expected one SARIF run, received ${runs.length}`);
  }
  return runs[0];
}

function normalizeUri(uri) {
  return uri.replaceAll("\\", "/");
}

function* codeFlowLocations(codeFlows) {
  for (const codeFlow of codeFlows ?? []) {
    for (const threadFlow of codeFlow.threadFlows ?? []) {
      for (const threadLocation of threadFlow.locations ?? []) {
        if (threadLocation.location) {
          yield threadLocation.location;
        }
      }
    }
  }
}

function* locationsInResult(result) {
  for (const location of result.locations ?? []) {
    yield location;
  }
  yield* codeFlowLocations(result.codeFlows);
}

function locationDetails(location) {
  const physical = location.physicalLocation ?? {};
  return {
    uri: normalizeUri(physical.artifactLocation?.uri ?? "<no-uri>"),
    line: physical.region?.startLine,
    snippet: physical.region?.snippet?.text ?? "",
    message: location.message?.text ?? "",
  };
}

function describeLocation(location) {
  const details = locationDetails(location);
  let output = `${details.uri}:${details.line ?? "?"}`;
  if (details.message) {
    output += ` (${details.message})`;
  }
  if (details.snippet) {
    output += ` :: ${details.snippet.trim()}`;
  }
  return output;
}

function printThreadFlow({ threadFlow, flowIndex, threadIndex }) {
  log(`  code flow ${flowIndex}.${threadIndex}:`);
  let locationIndex = 0;
  for (const threadLocation of threadFlow.locations ?? []) {
    locationIndex += 1;
    if (threadLocation.location) {
      log(`    ${locationIndex}: ${describeLocation(threadLocation.location)}`);
    }
  }
}

function printCodeFlow({ codeFlow, flowIndex }) {
  let threadIndex = 0;
  for (const threadFlow of codeFlow.threadFlows ?? []) {
    threadIndex += 1;
    printThreadFlow({ threadFlow, flowIndex, threadIndex });
  }
}

function printResultFlows(results) {
  let resultIndex = 0;
  for (const result of results) {
    resultIndex += 1;
    log(`Custom result ${resultIndex} primary locations:`);
    for (const location of result.locations ?? []) {
      log(`  primary: ${describeLocation(location)}`);
    }

    let flowIndex = 0;
    for (const codeFlow of result.codeFlows ?? []) {
      flowIndex += 1;
      printCodeFlow({ codeFlow, flowIndex });
    }
  }
}

function assertRuleSelection({ rules, requireDefaultSuite }) {
  log(`Repository SARIF rule count: ${rules.size}`);
  log(`Coinzilla replacement query selected: ${rules.has(CUSTOM_RULE_ID)}`);
  log(`Built-in query selected: ${rules.has(BUILTIN_RULE_ID)}`);
  if (!rules.has(CUSTOM_RULE_ID)) {
    throw new Error("The Coinzilla replacement query was not selected.");
  }
  if (rules.has(BUILTIN_RULE_ID)) {
    throw new Error("The original built-in query was not excluded.");
  }
  const hasDefaultJavaScriptRule = [...rules].some(
    (id) => id.startsWith("js/") && id !== BUILTIN_RULE_ID,
  );
  if (requireDefaultSuite && (rules.size < 80 || !hasDefaultJavaScriptRule)) {
    throw new Error(`The default JavaScript query suite appears incomplete: ${rules.size} SARIF rules.`);
  }
}

function collectRemainingSinks(results) {
  const remaining = [];
  for (const result of results) {
    for (const location of result.locations ?? []) {
      const details = locationDetails(location);
      const key = `${details.uri}:${details.line}`;
      if (BITUNIX_ALERT_SINKS.has(key)) {
        remaining.push(key);
      }
    }
  }
  return [...new Set(remaining)].sort();
}

function collectRemainingSources(results) {
  const remaining = [];
  for (const result of results) {
    for (const location of locationsInResult(result)) {
      const details = locationDetails(location);
      const normalized = path.posix.normalize(details.uri);
      const isBitunixSource = BITUNIX_API_KEY_SOURCE_PATHS.some(
        (sourcePath) => normalized.endsWith(sourcePath),
      );
      if (isBitunixSource && details.snippet.includes("apiKey")) {
        remaining.push(details.uri);
      }
    }
  }
  return [...new Set(remaining)].sort();
}

async function verifyRepository({ filePath, requireDefaultSuite }) {
  const run = getRun(await loadSarif(filePath));
  const rules = new Set(
    (run.tool?.driver?.rules ?? []).map((rule) => rule.id).filter(Boolean),
  );
  assertRuleSelection({ rules, requireDefaultSuite });

  const customResults = (run.results ?? []).filter(
    (result) => result.ruleId === CUSTOM_RULE_ID,
  );
  printResultFlows(customResults);
  log(`Coinzilla replacement-query results: ${customResults.length}`);

  const remainingSinks = collectRemainingSinks(customResults);
  const remainingSources = collectRemainingSources(customResults);
  log(`Original Bitunix alert sinks still reported: ${JSON.stringify(remainingSinks)}`);
  log(`Bitunix apiKey source locations still reported: ${JSON.stringify(remainingSources)}`);
  if (remainingSinks.length > 0 || remainingSources.length > 0) {
    throw new Error("Bitunix API-key signing flow still reported at original alert sinks or source locations.");
  }
}

function hasPositiveFixtureResult(results) {
  for (const result of results) {
    for (const location of locationsInResult(result)) {
      const details = locationDetails(location);
      if (details.uri.includes("password-hash.js")) {
        return true;
      }
    }
  }
  return false;
}

async function verifyPositiveFixture(filePath) {
  const run = getRun(await loadSarif(filePath));
  const results = (run.results ?? []).filter(
    (result) => result.ruleId === CUSTOM_RULE_ID,
  );
  if (results.length === 0 || !hasPositiveFixtureResult(results)) {
    throw new Error("The replacement query did not report the genuine weak password-hash fixture.");
  }
}

function parseArguments(args) {
  const modes = ["--repository", "--repository-custom", "--positive-fixture"];
  const selectedModes = args.filter((arg) => modes.includes(arg));
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (selectedModes.length !== 1 || !filePath) {
    throw new Error("Usage: node verify-sarif.mjs <sarif-path> (--repository|--repository-custom|--positive-fixture)");
  }
  return {
    mode: selectedModes[0],
    filePath,
  };
}

async function main() {
  const { mode, filePath } = parseArguments(process.argv.slice(2));
  if (mode === "--positive-fixture") {
    await verifyPositiveFixture(filePath);
    log("PASS: genuine weak password hashing is still reported.");
    return;
  }

  await verifyRepository({
    filePath,
    requireDefaultSuite: mode === "--repository",
  });
  log(
    mode === "--repository"
      ? "PASS: default queries retained; built-in query replaced; Bitunix signing paths excluded."
      : "PASS: replacement query excludes the original Bitunix alert sinks.",
  );
}

main().catch((error) => {
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
});
