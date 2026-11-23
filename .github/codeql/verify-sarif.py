#!/usr/bin/env python3
"""Assert the CodeQL query experiment preserves password-hash coverage."""

import argparse
import json
import sys
from pathlib import PurePosixPath

CUSTOM_RULE_ID = "coinzilla/js-insufficient-password-hash"
BUILTIN_RULE_ID = "js/insufficient-password-hash"
BITUNIX_API_KEY_SOURCE_PATHS = (
    "packages/brokers/scripts/bitunix/operator/order-probe-attempt.js",
    "packages/brokers/scripts/bitunix/operator/order-probe-attempt.test.js",
    "packages/brokers/src/infrastructure/bitunix/spot/api/rest-client.js",
    "packages/brokers/src/infrastructure/bitunix/spot/api/websocket-client.js",
    "packages/brokers/src/infrastructure/bitunix/spot/auth/create-rest-signature.js",
    "packages/brokers/src/infrastructure/bitunix/spot/auth/create-websocket-signature.js",
    "packages/brokers/src/infrastructure/bitunix/spot/broker.js",
)
BITUNIX_ALERT_SINKS = {
    (
        "packages/brokers/src/infrastructure/bitunix/spot/auth/create-rest-signature.js",
        75,
    ),
    (
        "packages/brokers/src/infrastructure/bitunix/spot/auth/create-websocket-signature.js",
        63,
    ),
}


def load_sarif(path):
    with open(path, encoding="utf-8") as sarif_file:
        return json.load(sarif_file)


def get_run(sarif):
    runs = sarif.get("runs", [])
    if len(runs) != 1:
        raise AssertionError(f"Expected one SARIF run, received {len(runs)}")
    return runs[0]


def result_uris(result):
    for location in result.get("locations", []):
        uri = location.get("physicalLocation", {}).get("artifactLocation", {}).get("uri")
        if uri:
            yield uri.replace("\\", "/")

    for code_flow in result.get("codeFlows", []):
        for thread_flow in code_flow.get("threadFlows", []):
            for thread_location in thread_flow.get("locations", []):
                uri = (
                    thread_location.get("location", {})
                    .get("physicalLocation", {})
                    .get("artifactLocation", {})
                    .get("uri")
                )
                if uri:
                    yield uri.replace("\\", "/")


def location_details(location):
    sarif_location = location.get("location", location)
    physical = sarif_location.get("physicalLocation", {})
    uri = physical.get("artifactLocation", {}).get("uri", "<no-uri>").replace("\\", "/")
    line = physical.get("region", {}).get("startLine")
    snippet = physical.get("region", {}).get("snippet", {}).get("text", "")
    message = sarif_location.get("message", {}).get("text", "")
    return uri, line, snippet, message


def describe_location(location):
    uri, line, snippet, message = location_details(location)
    detail = f"{uri}:{line if line is not None else '?'}"
    if message:
        detail += f" ({message})"
    if snippet:
        detail += f" :: {snippet.strip()}"
    return detail


def result_source_locations(result):
    for code_flow in result.get("codeFlows", []):
        for thread_flow in code_flow.get("threadFlows", []):
            locations = thread_flow.get("locations", [])
            if locations:
                yield location_details(locations[0])


def print_result_flows(results):
    for index, result in enumerate(results, start=1):
        print(f"Custom result {index} primary locations:")
        for location in result.get("locations", []):
            print(f"  primary: {describe_location(location)}")
        for flow_index, code_flow in enumerate(result.get("codeFlows", []), start=1):
            for thread_index, thread_flow in enumerate(code_flow.get("threadFlows", []), start=1):
                print(f"  code flow {flow_index}.{thread_index}:")
                for location_index, thread_location in enumerate(
                    thread_flow.get("locations", []), start=1
                ):
                    print(
                        f"    {location_index}: "
                        f"{describe_location(thread_location)}"
                    )


def verify_repository(path, require_default_suite=True):
    run = get_run(load_sarif(path))
    rules = {
        rule.get("id")
        for rule in run.get("tool", {}).get("driver", {}).get("rules", [])
        if rule.get("id")
    }

    print(f"Repository SARIF rule count: {len(rules)}")
    print(f"Coinzilla replacement query selected: {CUSTOM_RULE_ID in rules}")
    print(f"Built-in query selected: {BUILTIN_RULE_ID in rules}")

    if CUSTOM_RULE_ID not in rules:
        raise AssertionError("The Coinzilla replacement query was not selected.")
    if BUILTIN_RULE_ID in rules:
        raise AssertionError("The original built-in query was not excluded.")
    if require_default_suite and (
        len(rules) < 80
        or not any(
            rule_id.startswith("js/") and rule_id != BUILTIN_RULE_ID
            for rule_id in rules
        )
    ):
        raise AssertionError(
            f"The default JavaScript query suite appears incomplete: {len(rules)} SARIF rules."
        )

    custom_results = [
        result
        for result in run.get("results", [])
        if result.get("ruleId") == CUSTOM_RULE_ID
    ]
    print_result_flows(custom_results)
    print(f"Coinzilla replacement-query results: {len(custom_results)}")

    remaining_alert_sinks = []
    remaining_api_key_sources = []
    for result in custom_results:
        for location in result.get("locations", []):
            uri, line, _, _ = location_details(location)
            if (uri, line) in BITUNIX_ALERT_SINKS:
                remaining_alert_sinks.append(f"{uri}:{line}")

        for uri, _, snippet, _ in result_source_locations(result):
            if (
                any(str(PurePosixPath(uri)).endswith(path) for path in BITUNIX_API_KEY_SOURCE_PATHS)
                and "apiKey" in snippet
            ):
                remaining_api_key_sources.append(uri)

    print(f"Original Bitunix alert sinks still reported: {sorted(set(remaining_alert_sinks))}")
    print(f"Bitunix apiKey source locations still reported: {sorted(set(remaining_api_key_sources))}")
    if remaining_alert_sinks or remaining_api_key_sources:
        raise AssertionError(
            "Bitunix API-key signing flow still reported at original alert sinks or source locations."
        )


def verify_positive_fixture(path):
    run = get_run(load_sarif(path))
    results = [
        result
        for result in run.get("results", [])
        if result.get("ruleId") == CUSTOM_RULE_ID
    ]
    if not results:
        raise AssertionError(
            "The replacement query did not report the genuine password-hash fixture."
        )

    if not any(
        "password-hash.js" in uri
        for result in results
        for uri in result_uris(result)
    ):
        raise AssertionError(
            "The replacement query result did not include the positive fixture path."
        )


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--repository", action="store_true")
    group.add_argument("--repository-custom", action="store_true")
    group.add_argument("--positive-fixture", action="store_true")
    parser.add_argument("sarif_path")
    args = parser.parse_args()

    try:
        if args.repository or args.repository_custom:
            verify_repository(
                args.sarif_path,
                require_default_suite=args.repository,
            )
            if args.repository:
                print("PASS: default queries retained; built-in query replaced; Bitunix signing paths excluded.")
            else:
                print("PASS: replacement query excludes the original Bitunix alert sinks.")
        else:
            verify_positive_fixture(args.sarif_path)
            print("PASS: genuine weak password hashing is still reported.")
    except (AssertionError, KeyError, TypeError, ValueError) as error:
        print(f"::error::{error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
