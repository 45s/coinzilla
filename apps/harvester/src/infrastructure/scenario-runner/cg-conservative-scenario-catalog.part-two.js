export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_TWO = [
  {
    "id": "CON-DECISION-001",
    "title": "Conservative decisions emit only permitted BUY and recovery SELL intents",
    "category": "strategy-decisions",
    "priority": "P0",
    "description": "Evaluate entry, trailing, active-position, investment-cap, and safety gates using the real Conservative policy.",
    "tags": [
      "decision",
      "buy",
      "sell",
      "safety"
    ],
    "preconditions": [
      "A normalized market, Conservative pair configuration, current market data, and exchange filters are available.",
      "Portfolio, active orders, and account commitments are authoritative for the evaluated market."
    ],
    "initialState": {
      "portfolio": "empty or holding a partially recovered position",
      "activeOrders": "none or acknowledged strategy-owned orders",
      "marketData": "fresh"
    },
    "inputEvents": [
      {
        "type": "MARKET_SNAPSHOT",
        "sequence": 1
      },
      {
        "type": "STRATEGY_EVALUATION",
        "sequence": 2
      }
    ],
    "expectedState": {
      "strategy": "returns a domain decision without mutating authoritative accounting state",
      "portfolio": "unchanged by evaluation alone"
    },
    "expectedOrders": [
      {
        "side": "BUY",
        "purpose": "STANDING_BUY",
        "condition": "all entry and account gates pass"
      },
      {
        "side": "SELL",
        "purpose": "RECOVERY_SELL",
        "condition": "a recovery position has executable sellable inventory"
      }
    ],
    "expectedSideEffects": {
      "duplicateOrForbiddenIntent": false,
      "brokerSubmissionDuringPureEvaluation": false
    },
    "invariants": [
      "An active BUY or safety gate prevents an unsafe additional BUY.",
      "A recovery SELL decision is derived from the authoritative position basis and current filters.",
      "Evaluation does not mutate Portfolio, Position, or RecoveryLedger."
    ],
    "relatedRequirements": [
      "CON-SPEC-3.1",
      "CON-SPEC-3.2",
      "CON-SPEC-3.7",
      "CON-SPEC-8.1"
    ],
    "relatedCriticalBehaviors": [
      "STRATEGY_BUY_SELL_SAFETY_GATES"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Existing policy tests are linked; the full decision equivalence classes still need assertion-by-assertion review."
  },
  {
    "id": "CON-ERROR-001",
    "title": "Unknown submission, cancellation, and incomplete broker history remain fail-closed",
    "category": "exchange-failures",
    "priority": "P0",
    "description": "Cover exchange rejection, timeout with unknown outcome, cancellation races, incomplete fill history, and evidence-backed recovery.",
    "tags": [
      "exchange-error",
      "unknown-outcome",
      "reconciliation",
      "fail-closed"
    ],
    "preconditions": [
      "Broker operations are represented by deterministic offline test doubles.",
      "Order identity and durable submission intent are available to the application workflow."
    ],
    "initialState": {
      "order": "pending, open, or cancellation requested",
      "brokerOutcome": "may be rejected, delayed, unknown, or partially observed"
    },
    "inputEvents": [
      {
        "type": "SUBMISSION_TIMEOUT",
        "sequence": 1
      },
      {
        "type": "CANCELLATION_TIMEOUT",
        "sequence": 2
      },
      {
        "type": "BROKER_HISTORY_INCOMPLETE",
        "sequence": 3
      }
    ],
    "expectedState": {
      "unknownOutcome": "retained as unknown and blocked pending authoritative reconciliation",
      "rejection": "treated as a known terminal outcome",
      "missingFillEvidence": "prevents replacement or completion"
    },
    "expectedSideEffects": {
      "blindRetry": false,
      "replacementBeforeReconciliation": false,
      "duplicateOrderSubmission": false
    },
    "invariants": [
      "An unknown exchange outcome is not treated as a rejection or success.",
      "No blind retry occurs while the exchange outcome is unknown.",
      "A cancellation race is resolved using all authoritative fills before replacement."
    ],
    "relatedRequirements": [
      "CON-SPEC-5.2",
      "CON-SPEC-5.3",
      "CON-SPEC-8.2"
    ],
    "relatedCriticalBehaviors": [
      "ORDER_SUBMISSION_UNKNOWN",
      "CANCELLATION_UNKNOWN_OUTCOMES",
      "BROKER_HISTORY_RECONCILIATION"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Submission, cancellation, and broker-history tests are linked; the full exchange failure matrix remains under review."
  },
  {
    "id": "CON-EVENT-001",
    "title": "Duplicate, delayed, conflicting, and reordered exchange events cannot corrupt order state",
    "category": "event-reliability",
    "priority": "P0",
    "description": "Cover duplicate order updates, duplicate fills, conflicting execution evidence, out-of-order transitions, REST/stream overlap, and missing history.",
    "tags": [
      "events",
      "deduplication",
      "ordering",
      "reconciliation"
    ],
    "preconditions": [
      "Exchange event identities and canonical order/fill projections are available.",
      "The same market/order may be observed through stream and REST reconciliation paths."
    ],
    "initialState": {
      "orderRegistry": "contains known canonical orders and accepted fills",
      "eventDelivery": "may be duplicated, delayed, reordered, or conflicting"
    },
    "inputEvents": [
      {
        "type": "DUPLICATE_FILL_EVENT",
        "sequence": 1
      },
      {
        "type": "STALE_ORDER_UPDATE",
        "sequence": 2
      },
      {
        "type": "CONFLICTING_EXECUTION_EVIDENCE",
        "sequence": 3
      },
      {
        "type": "REST_STREAM_OVERLAP",
        "sequence": 4
      }
    ],
    "expectedState": {
      "acceptedFills": "each canonical execution is applied once",
      "orderLifecycle": "does not regress on stale or reordered updates",
      "conflict": "rejected without partial accounting mutation"
    },
    "expectedSideEffects": {
      "duplicateAccounting": false,
      "duplicateCycleCompletion": false,
      "staleOrderReactivation": false
    },
    "invariants": [
      "A fill identity cannot be applied twice.",
      "Conflicting evidence for the same identity is rejected.",
      "Out-of-order events cannot move a terminal order back to an executable state."
    ],
    "relatedRequirements": [
      "CON-SPEC-2.2",
      "CON-SPEC-6.3"
    ],
    "relatedCriticalBehaviors": [
      "FILL_IDENTITY_DEDUPLICATION",
      "ORDER_IDENTITY_TRANSITIONS",
      "BROKER_HISTORY_RECONCILIATION"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Duplicate, identity, and reconciliation tests are linked; delayed and missing-evidence permutations remain under review."
  },
  {
    "id": "CON-FEE-001",
    "title": "Base, quote, and third-asset commissions preserve exact net inventory and quote economics",
    "category": "fees-commission-assets",
    "priority": "P0",
    "description": "Cover BUY and SELL commissions charged in base, quote, and a third asset, including quote valuation of third-asset fees and fail-closed missing valuation.",
    "tags": [
      "fees",
      "commission",
      "base-asset",
      "quote-asset",
      "third-asset"
    ],
    "preconditions": [
      "Each canonical Fill carries its actual commission amount and commission asset.",
      "A third-asset commission is accepted only when its quote valuation is available."
    ],
    "initialState": {
      "feePolicy": "configured fee reserve is separate from actual commission facts",
      "assets": "base, quote, and optional third commission asset are explicit"
    },
    "inputEvents": [
      {
        "type": "BUY_FILL_WITH_BASE_COMMISSION",
        "sequence": 1
      },
      {
        "type": "BUY_FILL_WITH_QUOTE_COMMISSION",
        "sequence": 2
      },
      {
        "type": "SELL_FILL_WITH_THIRD_ASSET_COMMISSION",
        "sequence": 3
      },
      {
        "type": "THIRD_ASSET_VALUATION_MISSING",
        "sequence": 4
      }
    ],
    "expectedState": {
      "baseCommission": "reduces net acquired base or increases net base disposed as appropriate",
      "quoteCommission": "changes quote cash flow and quote recovery basis",
      "thirdAssetCommission": "is valued in quote or rejected when valuation evidence is absent"
    },
    "expectedAccounting": {
      "actualCommission": "uses exchange-reported amount and asset",
      "feeReserve": "used only for order planning, never substituted for actual accounting"
    },
    "expectedSideEffects": {
      "unvaluedThirdAssetAccepted": false,
      "feeCountedTwice": false
    },
    "invariants": [
      "Commission asset identity is never inferred from the market pair.",
      "Actual commission facts are applied exactly once.",
      "Missing third-asset valuation fails closed before recovery economics are accepted."
    ],
    "relatedRequirements": [
      "CON-SPEC-2.3",
      "CON-SPEC-4.7"
    ],
    "relatedCriticalBehaviors": [
      "EXACT_FINANCIAL_ACCOUNTING"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Actual commission and valuation tests are linked; the complete base/quote/third-asset cross-product remains subject to review."
  }
]
