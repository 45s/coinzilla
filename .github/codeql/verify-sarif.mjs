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

function* resultUris(result) {
  for (const location of result.locations ?? []) {
    const uri = location.physicalLocation?.artifactLocation?.uri;
    if (uri) yield uri.replaceAll("\\", "/");
  }
  for (const codeFlow of result.codeFlows ?? []) {
    for (const threadFlow of codeFlow.threadFlows ?? []) {
      for (const threadLocation of threadFlow.locations ?? []) {
        const uri = threadLocation.location?.physicalLocation?.artifactLocation?.uri;
        if (uri) yield uri.replaceAll("\\", "/");
      }
    }
  }
}

function locationDetails(location) {
  const sarifLocation = location.location ?? location;
  const physical = sarifLocation.physicalLocation ?? {};
  const uri = (physical.artifactLocation?.uri ?? "<no-uri>").replaceAll("\\", "/");
  return {
    uri,
    line: physical.region?.startLine,
    snippet: physical.region?.snippet?.text ?? "",
    message: sarifLocation.message?.text ?? "",
  };
}

function describeLocation(location) {
  const { uri, line, snippet, message } = locationDetails(location);
  let detail = `${uri}:${line ?? "?"}`;
  if (message) detail += ` (${message})`;
  if (snippet) detail += ` :: ${snippet.trim()}`;
  return detail;
}

function* resultSourceLocations(result) {
  for (const codeFlow of result.codeFlows ?? []) {
    for (const threadFlow of codeFlow.threadFlows ?? []) {
      const locations = threadFlow.locations ?? [];
      if (locations.length > 0) yield locationDetails(locations[0]);
    }
  }
}

function printResultFlows(results) {
  results.forEach((result, index) => {
    console.log(`Custom result ${index + 1} primary locations:`);
    for (const location of result.locations ?? []) {
      console.log(`  primary: ${describeLocation(location)}`);
    }
    (result.codeFlows ?? []).forEach((codeFlow, flowIndex) => {
      (codeFlow.threadFlows ?? []).forEach((threadFlow, threadIndex) => {
        console.log(`  code flow ${flowIndex + 1}.${threadIndex + 1}:`);
        (threadFlow.locations ?? []).forEach((threadLocation, locationIndex) => {
          console.log(`    ${locationIndex + 1}: ${describeLocation(threadLocation)}`);
        });
      });
    });
  });
}

async function verifyRepository(filePath, requireDefaultSuite = true) {
  const run = getRun(await loadSarif(filePath));
  const rules = new Set(
    (run.tool?.driver?.rules ?? []).map((rule) => rule.id).filter(Boolean),
  );
  console.log(`Repository SARIF rule count: ${rules.size}`);
  console.log(`Coinzilla replacement query selected: ${rules.has(CUSTOM_RULE_ID)}`);
  console.log(`Built-in query selected: ${rules.has(BUILTIN_RULE_ID)}`);

  if (!rules.has(CUSTOM_RULE_ID)) {
    throw new Error("The Coinzilla replacement query was not selected.");
  }
  if (rules.has(BUILTIN_RULE_ID)) {
    throw new Error("The original built-in query was not excluded.");
  }
  if (
    requireDefaultSuite &&
    (rules.size < 80 || ![...rules].some((id) => id.startsWith("js/") && id !== BUILTIN_RULE_ID))
  ) {
    throw new Error(`The default JavaScript query suite appears incomplete: ${rules.size} SARIF rules.`);
  }

  const customResults = (run.results ?? []).filter((result) => result.ruleId === CUSTOM_RULE_ID);
  printResultFlows(customResults);
  console.log(`Coinzilla replacement-query results: ${customResults.length}`);

  const remainingAlertSinks = [];
  const remainingApiKeySources = [];
  for (const result of customResults) {
    for (const location of result.locations ?? []) {
      const { uri, line } = locationDetails(location);
      if (BITUNIX_ALERT_SINKS.has(`${uri}:${line}`)) {
        remainingAlertSinks.push(`${uri}:${line}`);
      }
    }
    for (const { uri, snippet } of resultSourceLocations(result)) {
      const normalized = path.posix.normalize(uri);
      if (
        BITUNIX_API_KEY_SOURCE_PATHS.some((sourcePath) => normalized.endsWith(sourcePath)) &&
        snippet.includes("apiKey")
      ) {
        remainingApiKeySources.push(uri);
      }
    }
  }

  console.log(`Original Bitunix alert sinks still reported: ${JSON.stringify([...new Set(remainingAlertSinks)].sort())}`);
  console.log(`Bitunix apiKey source locations still reported: ${JSON.stringify([...new Set(remainingApiKeySources)].sort())}`);
  if (remainingAlertSinks.length > 0 || remainingApiKeySources.length > 0) {
    throw new Error("Bitunix API-key signing flow still reported at original alert sinks or source locations.");
  }
}

async function verifyPositiveFixture(filePath) {
  const run = getRun(await loadSarif(filePath));
  const results = (run.results ?? []).filter((result) => result.ruleId === CUSTOM_RULE_ID);
  if (results.length === 0) {
    throw new Error("The replacement query did not report the genuine password-hash fixture.");
  }
  if (!results.some((result) => [...resultUris(result)].some((uri) => uri.includes("password-hash.js")))) {
    throw new Error("The replacement query result did not include the positive fixture path.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modes = ["--repository", "--repository-custom", "--positive-fixture"];
  const selectedModes = args.filter((arg) => modes.includes(arg));
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (selectedModes.length !== 1 || !filePath) {
    throw new Error("Usage: node verify-sarif.mjs <sarif-path> (--repository|--repository-custom|--positive-fixture)");
  }

  const [mode] = selectedModes;
  if (mode === "--repository" || mode === "--repository-custom") {
    await verifyRepository(filePath, mode === "--repository");
    console.log(
      mode === "--repository"
        ? "PASS: default queries retained; built-in query replaced; Bitunix signing paths excluded."
        : "PASS: replacement query excludes the original Bitunix alert sinks.",
    );
  } else {
    await verifyPositiveFixture(filePath);
    console.log("PASS: genuine weak password hashing is still reported.");
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
