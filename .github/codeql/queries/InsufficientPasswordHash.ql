/**
 * @name Coinzilla password hashing with insufficient computational effort
 * @description Detects weak password hashing using the upstream CodeQL password sources and sinks.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 8.1
 * @precision high
 * @id coinzilla/js-insufficient-password-hash
 * @tags security
 *       external/cwe/cwe-916
 */

import javascript
import semmle.javascript.security.dataflow.InsufficientPasswordHashCustomizations

module CoinzillaInsufficientPasswordHashConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) {
    source instanceof InsufficientPasswordHash::Source
  }

  predicate isSink(DataFlow::Node sink) {
    sink instanceof InsufficientPasswordHash::Sink
  }

  predicate isBarrier(DataFlow::Node node) {
    node instanceof InsufficientPasswordHash::Sanitizer
  }

  predicate observeDiffInformedIncrementalMode() { any() }
}

module CoinzillaInsufficientPasswordHashFlow =
  TaintTracking::Global<CoinzillaInsufficientPasswordHashConfig>;

import CoinzillaInsufficientPasswordHashFlow::PathGraph

from CoinzillaInsufficientPasswordHashFlow::PathNode source,
     CoinzillaInsufficientPasswordHashFlow::PathNode sink
where CoinzillaInsufficientPasswordHashFlow::flowPath(source, sink)
select sink.getNode(), source, sink, "Password from $@ is hashed insecurely.", source.getNode(),
  source.getNode().(InsufficientPasswordHash::Source).describe()
