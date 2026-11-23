/**
 * @name Coinzilla password hashing with insufficient computational effort
 * @description Detects weak password hashing while excluding only the known Bitunix API-key identifier sources used for request signing.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 8.1
 * @precision high
 * @id coinzilla/js-insufficient-password-hash
 * @tags security
 *       external/cwe/cwe-916
 */

import javascript
import semmle.javascript.security.SensitiveActions
import semmle.javascript.security.dataflow.InsufficientPasswordHashCustomizations

/**
 * Keep the upstream password-hash sources, sinks, and sanitizer semantics.
 * The only source refinement is the known Bitunix API-key identifier input.
 */
module CoinzillaInsufficientPasswordHashConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) {
    source instanceof InsufficientPasswordHash::Source and
    not isBitunixApiKeyIdentifierSource(source)
  }

  predicate isSink(DataFlow::Node sink) {
    sink instanceof InsufficientPasswordHash::Sink
  }

  predicate isBarrier(DataFlow::Node node) {
    node instanceof InsufficientPasswordHash::Sanitizer
  }

  predicate observeDiffInformedIncrementalMode() { any() }
}

/**
 * Bitunix's API key is an exchange-issued identifier included in the
 * exchange-mandated per-request signing preimage. It is not a user password
 * or a stored password verifier. Limit this exception to apiKey accesses in
 * the two Bitunix Spot client modules that own those protocol flows. All
 * other password-like sources remain in scope.
 *
 * The expression checks intentionally mirror the upstream
 * SensitiveVariableAccess constructor: VarAccess.getName() or
 * DataFlow::PropRead.getPropertyName().
 */
private predicate isBitunixApiKeyIdentifierSource(DataFlow::Node source) {
  source instanceof SensitiveVariableAccess and
  source.getLocation().getFile().getRelativePath() in [
    "packages/brokers/scripts/bitunix/operator/order-probe-attempt.js",
    "packages/brokers/scripts/bitunix/operator/order-probe-attempt.test.js",
    "packages/brokers/src/infrastructure/bitunix/spot/api/rest-client.js",
    "packages/brokers/src/infrastructure/bitunix/spot/api/websocket-client.js",
    "packages/brokers/src/infrastructure/bitunix/spot/auth/create-rest-signature.js",
    "packages/brokers/src/infrastructure/bitunix/spot/auth/create-websocket-signature.js",
    "packages/brokers/src/infrastructure/bitunix/spot/broker.js"
  ] and
  (
    source.asExpr().(VarAccess).getName() = "apiKey"
    or
    exists(DataFlow::PropRead property |
      source = property and
      property.getPropertyName() = "apiKey"
    )
  )
}

module CoinzillaInsufficientPasswordHashFlow =
  TaintTracking::Global<CoinzillaInsufficientPasswordHashConfig>;

import CoinzillaInsufficientPasswordHashFlow::PathGraph

from CoinzillaInsufficientPasswordHashFlow::PathNode source,
     CoinzillaInsufficientPasswordHashFlow::PathNode sink
where CoinzillaInsufficientPasswordHashFlow::flowPath(source, sink)
select sink.getNode(), source, sink, "Password from $@ is hashed insecurely.", source.getNode(),
  source.getNode().(InsufficientPasswordHash::Source).describe()
