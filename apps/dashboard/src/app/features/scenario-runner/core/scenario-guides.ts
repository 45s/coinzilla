export type ScenarioGuideStepKind = 'start' | 'production-flow' | 'decision' | 'condition' | 'injected-failure' | 'outcome';

export interface ScenarioGuideStep {
  readonly id: string;
  readonly kind: ScenarioGuideStepKind;
  readonly label: string;
  readonly detail: string;
}

export interface ScenarioGuide {
  readonly availability: 'EXECUTABLE' | 'PRELIMINARY';
  readonly purpose: string;
  readonly startingState: string;
  readonly injectedCondition: string;
  readonly expectedOutcome: string;
  readonly limitations: readonly string[];
  readonly steps: readonly ScenarioGuideStep[];
}

const runtimeLimitations = Object.freeze([
  'Simulation-only: the run uses a run-local simulated broker and in-memory operational store. It does not prove real exchange behavior or durable production persistence.',
  'The runtime catalogue status is PARTIAL. Passing assertions do not prove production readiness, trusted OS isolation, exact replay provenance or runner retry/idempotency.',
]);

function runtimeGuide({
  purpose,
  injectedCondition,
  expectedOutcome,
  path,
}: {
  purpose: string;
  injectedCondition: string;
  expectedOutcome: string;
  path: readonly ScenarioGuideStep[];
}): ScenarioGuide {
  return Object.freeze({
    availability: 'EXECUTABLE',
    purpose,
    startingState: 'The runner seeds a filled Recovery Seller BUY and accounted recovery inventory, the configured legacy position, a quote balance, validated market metadata/filters and a fresh market-price observation. The input editor shows the run-local defaults; overrides are validated before execution.',
    injectedCondition,
    expectedOutcome,
    limitations: runtimeLimitations,
    steps: Object.freeze([
      {
        id: 'seed',
        kind: 'start',
        label: 'Seed isolated scenario state',
        detail: 'Create the run-local market, account snapshot, filled recovery BUY/fill, legacy position, accounting workflow and simulated infrastructure.',
      },
      {
        id: 'evaluate',
        kind: 'production-flow',
        label: 'Evaluate through production Recovery Seller flow',
        detail: 'Dispatch the market observation through the runtime evaluator, action authorizer and SELL planner. The diagram does not reimplement their calculations.',
      },
      ...path,
      {
        id: 'assertions',
        kind: 'outcome',
        label: 'Compare actual output with scenario expectations',
        detail: expectedOutcome,
      },
    ]),
  });
}

const guides: Readonly<Record<string, ScenarioGuide>> = Object.freeze({
  'RS-RUNTIME-SELL-SUBMISSION-001': runtimeGuide({
    purpose: 'Prove that an eligible recovery position produces one authorized SELL and that the normal submission path records and reserves it.',
    injectedCondition: 'No failure is injected. The run-local simulated broker acknowledges the planned SELL.',
    expectedOutcome: 'One SELL intent is submitted; the simulated broker acknowledges it; the outcome is recorded and the SELL-cycle reservation matches the acknowledged order identity.',
    path: [
      { id: 'authorize', kind: 'decision', label: 'Authorize the recovery SELL', detail: 'Check recovery position, order ownership, account snapshot, STOP state and market rules.' },
      { id: 'submit', kind: 'production-flow', label: 'Persist intent → broker ACK → persist outcome → reserve cycle', detail: 'The production order submitter runs its normal intent/outcome callbacks and reserves the cycle against the acknowledged order.' },
    ],
  }),
  'RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001': runtimeGuide({
    purpose: 'Prove that the broker is never called when the SELL submission intent cannot be recorded first.',
    injectedCondition: 'The run-local store rejects the ORDER_SUBMISSION_INTENT append.',
    expectedOutcome: 'No broker placement call and no SELL reservation; STOP is recorded and BUY admission is blocked.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Reach the pre-broker intent barrier', detail: 'The submitter attempts to persist ORDER_SUBMISSION_INTENT before calling the broker.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL intent persistence fails', detail: 'The store rejects ORDER_SUBMISSION_INTENT before any broker placement call.' },
      { id: 'closed', kind: 'outcome', label: 'Fail closed before broker placement', detail: 'No broker call or reservation is allowed; STOP evidence and blocked BUY admission are expected.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001': runtimeGuide({
    purpose: 'Prove that a broker-acknowledged SELL is guarded when its submission outcome cannot be recorded.',
    injectedCondition: 'The simulated broker acknowledges the SELL, then the store rejects ORDER_SUBMISSION_OUTCOME.',
    expectedOutcome: 'The reservation remains; STOP is recorded; BUY admission is blocked while SELL admission remains allowed.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated broker acknowledges the SELL', detail: 'The broker boundary returns an acknowledged order after intent persistence.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome persistence fails', detail: 'The store rejects ORDER_SUBMISSION_OUTCOME after the simulated acknowledgement.' },
      { id: 'guard', kind: 'outcome', label: 'Retain reservation and latch STOP', detail: 'Do not treat the acknowledgement as fully recorded; preserve the reservation and block new BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    purpose: 'Prove fail-closed admission when both the broker acknowledgement outcome and the STOP fact cannot be persisted.',
    injectedCondition: 'The store rejects ORDER_SUBMISSION_OUTCOME and also rejects SAFETY_BLOCKER_RAISED.',
    expectedOutcome: 'The SELL reservation remains; both BUY and SELL admission checks are blocked. The failed STOP append is not described as durable.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated broker acknowledges the SELL', detail: 'The normal submission path has crossed the simulated broker boundary.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome and STOP persistence fail', detail: 'The store rejects ORDER_SUBMISSION_OUTCOME and then rejects SAFETY_BLOCKER_RAISED.' },
      { id: 'blocked', kind: 'outcome', label: 'Keep account admission blocked', detail: 'The reservation remains and both BUY and SELL admission checks report blocked; the STOP fact itself was not persisted.' },
    ],
  }),
  'RS-RUNTIME-SELL-BROKER-EXCEPTION-001': runtimeGuide({
    purpose: 'Prove that an exception during broker placement is treated as an unknown outcome, not as a safe rejection.',
    injectedCondition: 'The simulated broker throws while placing the SELL, so acceptance is unknown.',
    expectedOutcome: 'The submission remains unresolved; STOP is recorded; reservation is retained; BUY is blocked and SELL remains allowed.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Persist SELL intent', detail: 'The required pre-broker intent is recorded.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker placement throws', detail: 'The broker call throws and the runner cannot infer whether an external order was accepted.' },
      { id: 'unknown', kind: 'outcome', label: 'Keep outcome UNKNOWN and guard BUY', detail: 'Latch STOP and retain the reservation; do not retry or relabel the unknown outcome as rejected.' },
    ],
  }),
  'RS-RUNTIME-SELL-RESERVATION-FAILURE-001': runtimeGuide({
    purpose: 'Prove the safety response when the callback that reserves the sole active recovery SELL fails.',
    injectedCondition: 'The scenario-specific onSellReserved callback returns a simulated failure.',
    expectedOutcome: 'Reservation is not reported as retained; STOP is recorded and BUY admission is blocked. Inspect run evidence for the exact broker submission outcome.',
    path: [
      { id: 'submit', kind: 'production-flow', label: 'Reach the sole-SELL reservation callback', detail: 'The order submitter invokes the reservation callback as part of completing the SELL submission path.' },
      { id: 'failure', kind: 'injected-failure', label: 'Sole-SELL reservation callback fails', detail: 'The scenario callback returns an error instead of a successful reservation result.' },
      { id: 'guard', kind: 'outcome', label: 'Do not claim a retained reservation', detail: 'The expected state records reservation failure, raises STOP and blocks BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-REJECTION-001': runtimeGuide({
    purpose: 'Prove that an explicit broker rejection is distinguished from acknowledgement and triggers the expected safety response.',
    injectedCondition: 'The simulated broker returns a rejected SELL submission.',
    expectedOutcome: 'No accepted submitted order is reported; STOP evidence is recorded and the reservation is retained as asserted by this scenario.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Persist intent and call simulated broker', detail: 'The submitter reaches the broker boundary after the pre-submission intent step.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker rejects the SELL', detail: 'The broker returns a rejection instead of an acknowledged order.' },
      { id: 'guard', kind: 'outcome', label: 'Record rejection and safety response', detail: 'Assert no accepted order, STOP fact recorded and reservation retained; this is not a real exchange rejection.' },
    ],
  }),
  'RS-RUNTIME-SELL-PARTIAL-CANCEL-001': runtimeGuide({
    purpose: 'Prove that a partially executed SELL which later becomes CANCELED is reconciled using its fill, not treated as a zero-fill cancellation.',
    injectedCondition: 'After simulated acknowledgement, the runner supplies a terminal CANCELED order with a 2.5-unit partial fill in the default fixture.',
    expectedOutcome: 'The terminal order is reconciled and accounting is applied for the supplied fill; the cycle remains UNRESOLVED, not complete.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'partial', kind: 'condition', label: 'Partial fill, then terminal CANCELED', detail: 'The fixture supplies a 2.5-unit fill at the submitted price and a terminal CANCELED order; this quantity is fixture data, not a universal rule.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and mixed-position accounting', detail: 'The production order-event and Recovery Seller accounting workflows reconcile the canonical fill and terminal order.' },
      { id: 'cycle', kind: 'outcome', label: 'Keep the cycle UNRESOLVED', detail: 'Cancellation is not a zero-fill result, and partial execution does not prove the recovery cycle is complete.' },
    ],
  }),
  'RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001': runtimeGuide({
    purpose: 'Prove the behavior when a SELL is fully FILLED but its resulting profitability is below the required target.',
    injectedCondition: 'The runner supplies a terminal FILLED SELL and canonical fill whose resulting profitability is below the configured threshold.',
    expectedOutcome: 'The full fill is reconciled, profitability eligibility is false, and the safety workflow latches STOP.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'fill', kind: 'condition', label: 'Supply a fully FILLED SELL below target', detail: 'The runner creates a terminal FILLED order and canonical fill for the under-target case.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and profitability', detail: 'The production order-event and accounting workflows process the terminal order and evaluate the cycle result.' },
      { id: 'stop', kind: 'outcome', label: 'Latch account STOP', detail: 'The under-target result is ineligible; a FILLED order alone is not a successful recovery cycle.' },
    ],
  }),
  'RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001': runtimeGuide({
    purpose: 'Prove that a FILLED SELL is not treated as reconciled when persisting its terminal reconciliation fact fails.',
    injectedCondition: 'The runner supplies a terminal FILLED SELL, then the store rejects RECOVERY_SELLER_MIXED_SELL_RECONCILED.',
    expectedOutcome: 'Reconciliation is not marked successful; the event workflow fails closed; STOP and market pause are recorded in run state; reservation remains.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Receive terminal FILLED order and fill', detail: 'Send the terminal order and canonical fill through the production order-event workflow.' },
      { id: 'failure', kind: 'injected-failure', label: 'Terminal reconciliation persistence fails', detail: 'The store rejects RECOVERY_SELLER_MIXED_SELL_RECONCILED after the terminal fill is staged.' },
      { id: 'guard', kind: 'outcome', label: 'Fail closed and retain reservation', detail: 'Expect unreconciled terminal state, STOP, market pause, blocked BUY admission and retained SELL reservation.' },
    ],
  }),
  'RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    purpose: 'Prove that failure to persist account STOP after an under-target FILLED SELL does not permit a subsequent action.',
    injectedCondition: 'The runner supplies a fully FILLED SELL below target, the store rejects SAFETY_BLOCKER_RAISED, and a follow-up evaluation is attempted.',
    expectedOutcome: 'The STOP fact is not claimed as persisted; follow-up dispatch is blocked and no second action/order is submitted.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Reconcile an under-target FILLED SELL', detail: 'The production order-event and accounting workflows determine the terminal cycle outcome.' },
      { id: 'failure', kind: 'injected-failure', label: 'Account STOP persistence fails', detail: 'The run-local store rejects SAFETY_BLOCKER_RAISED after the under-target fill.' },
      { id: 'follow-up', kind: 'decision', label: 'Attempt a follow-up evaluation', detail: 'The runner dispatches another evaluation at a lower simulated market price to verify admission remains blocked.' },
      { id: 'blocked', kind: 'outcome', label: 'No follow-up action is submitted', detail: 'The expected result is a blocked follow-up dispatch with no second action or order; STOP persistence itself remains failed.' },
    ],
  }),
  'RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001': runtimeGuide({
    purpose: 'Prove the direction-specific STOP rule: new BUY spending is blocked while an eligible first recovery SELL may still be submitted.',
    injectedCondition: 'A STOP is persisted in the run-local store before normal production dispatch is evaluated.',
    expectedOutcome: 'One eligible SELL is submitted; STOP status is STOPPED; BUY admission is blocked and SELL admission is permitted.',
    path: [
      { id: 'stop', kind: 'condition', label: 'Persist STOP before dispatch', detail: 'The scenario latches STOP before evaluating the market observation.' },
      { id: 'admission', kind: 'decision', label: 'Evaluate direction-specific admission', detail: 'The production authorizer applies the STOP gate to the proposed recovery action.' },
      { id: 'sell', kind: 'outcome', label: 'Allow eligible SELL; block BUY', detail: 'The expected action is SELL, with BUY admission blocked and SELL admission not blocked.' },
    ],
  }),
  'RS-004-011': Object.freeze({
    availability: 'PRELIMINARY',
    purpose: 'Compare recovery-profitability, legacy-profitability and combined-cycle profitability gates. This candidate calls one pure production calculation only; it does not run the Recovery Seller lifecycle.',
    startingState: 'The input supplies separate recovery cost/proceeds and legacy average-cost/debit/proceeds values plus minProfit as an absolute quote-asset amount.',
    injectedCondition: 'No runtime event is injected; the helper receives only the explicit profitability input values.',
    expectedOutcome: 'The helper returns recovery, legacy and combined-cycle calculations, and the assertion compares all three eligibility gates with expected values.',
    limitations: Object.freeze([
      'PRELIMINARY and non-executable: this is a helper-only projection, not an executable production runtime scenario.',
      'It does not create an order, call a broker, reconcile a fill, mutate a cycle or prove STOP/admission behavior.',
    ]),
    steps: Object.freeze([
      { id: 'start', kind: 'start', label: 'Supply recovery and legacy profitability inputs', detail: 'Provide recovery cost basis/net proceeds, legacy average cost/base debit/net proceeds and quote-asset minProfit.' },
      { id: 'calculate', kind: 'decision', label: 'Call calculateRecoverySellerProfitability', detail: 'The runner invokes the pure production helper; recovery, legacy and combined-cycle gates are evaluated independently.' },
      { id: 'outcome', kind: 'outcome', label: 'Compare helper output with expected values', detail: 'The single assertion compares the helper result with expected recovery, legacy and cycle profitability breakdowns.' },
    ]),
  }),
});

export function getScenarioGuide(scenarioId: string): ScenarioGuide | null {
  return guides[scenarioId] ?? null;
}
