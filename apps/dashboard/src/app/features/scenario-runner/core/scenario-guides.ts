export type ScenarioGuideStepKind = 'start' | 'production-flow' | 'decision' | 'condition' | 'injected-failure' | 'outcome';

export interface ScenarioGuideStep {
  readonly id: string;
  readonly kind: ScenarioGuideStepKind;
  readonly label: string;
  readonly detail: string;
}

export interface ScenarioGuide {
  readonly title: string;
  readonly availability: 'EXECUTABLE' | 'PRELIMINARY';
  readonly purpose: string;
  readonly startingState: string;
  readonly injectedCondition: string;
  readonly expectedOutcome: string;
  readonly limitations: readonly string[];
  readonly steps: readonly ScenarioGuideStep[];
}

const runtimeLimitations = Object.freeze([
  'This is a simulation. Orders go only to a temporary fake exchange, and saved state exists only for this run. It does not prove behavior on a real exchange or durable production storage.',
  'This scenario is only partially verified. A passing run does not prove production readiness, operating-system isolation, exact replay of the original code, or safe retry behavior.',
]);

function runtimeGuide({
  title,
  purpose,
  injectedCondition,
  expectedOutcome,
  path,
}: {
  title: string;
  purpose: string;
  injectedCondition: string;
  expectedOutcome: string;
  path: readonly ScenarioGuideStep[];
}): ScenarioGuide {
  const steps: ScenarioGuideStep[] = [
    {
      id: 'seed',
      kind: 'start',
      label: 'Set up the example',
      detail: 'Prepare a simulated market and account with an existing recovery BUY, the configured legacy position and enough information to evaluate a possible SELL. No live account or exchange is used.',
    },
    {
      id: 'evaluate',
      kind: 'production-flow',
      label: 'Run the Recovery Seller decision',
      detail: 'Pass the market observation through the same production decision and authorization path used by Recovery Seller. The scenario does not replace that logic with a second model.',
    },
    ...path,
    {
      id: 'assertions',
      kind: 'outcome',
      label: 'Check what happened',
      detail: expectedOutcome,
    },
  ];
  return Object.freeze({
    title,
    availability: 'EXECUTABLE',
    purpose,
    startingState: 'The example starts with a completed recovery BUY, the resulting recovery coins, any configured legacy coins, available quote currency and valid market trading rules. It then supplies a current market price. Changes in the input editor affect this run only and are checked before it starts.',
    injectedCondition,
    expectedOutcome,
    limitations: runtimeLimitations,
    steps: Object.freeze(steps),
  });
}

function createPreliminaryGuide(): ScenarioGuide {
  const steps: ScenarioGuideStep[] = [
    { id: 'start', kind: 'start', label: 'Supply recovery and legacy profitability inputs', detail: 'Enter the recovery costs and proceeds, the legacy holding's average cost and quantity sold, its proceeds, and the minimum profit required.' },
    { id: 'calculate', kind: 'decision', label: 'Call calculateRecoverySellerProfitability', detail: 'The runner invokes the pure production helper; recovery, legacy and combined-cycle gates are evaluated independently.' },
    { id: 'outcome', kind: 'outcome', label: 'Check the calculated profit against the expected values', detail: 'The check compares the calculated recovery, legacy and combined results with the expected values.' },
  ];
  return Object.freeze({
    title: 'Check three independent profit requirements',
    availability: 'PRELIMINARY',
    purpose: 'Compare recovery-profitability, legacy-profitability and combined-cycle profitability gates. This candidate calls one pure production calculation only; it does not run the Recovery Seller lifecycle.',
    startingState: 'The example gives recovery and legacy costs and proceeds separately. The minimum profit is an amount in the market's quote currency.',
    injectedCondition: 'Nothing happens in the trading lifecycle. The example sends only the supplied numbers to the profit calculation.',
    expectedOutcome: 'The calculation reports recovery profit, legacy profit and combined-cycle profit separately. The example checks that each one meets its own required minimum.',
    limitations: Object.freeze([
      'PRELIMINARY and non-executable: this is a helper-only projection, not an executable production runtime scenario.',
      'It does not create an order, call a broker, reconcile a fill, mutate a cycle or prove STOP/admission behavior.',
    ]),
    steps: Object.freeze(steps),
  });
}

const guides: Readonly<Record<string, ScenarioGuide>> = Object.freeze({
  'RS-RUNTIME-SELL-SUBMISSION-001': runtimeGuide({
    title: 'Submit one recovery SELL',
    purpose: 'Prove that an eligible recovery position produces one authorized SELL and that the normal submission path records and reserves it.',
    injectedCondition: 'No failure is injected. The simulated exchange accepts the planned SELL.',
    expectedOutcome: 'One SELL intent is submitted; the simulated broker acknowledges it; the outcome is recorded and the SELL-cycle reservation matches the acknowledged order identity.',
    path: [
      { id: 'authorize', kind: 'decision', label: 'Authorize the recovery SELL', detail: 'Check recovery position, order ownership, account snapshot, STOP state and market rules.' },
      { id: 'submit', kind: 'production-flow', label: 'Save the SELL request → exchange accepts it → save the result → reserve the cycle', detail: 'The production order submitter runs its normal intent/outcome callbacks and reserves the cycle against the acknowledged order.' },
    ],
  }),
  'RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save SELL intention — do not place order',
    purpose: 'Prove that the broker is never called when the SELL submission intent cannot be recorded first.',
    injectedCondition: 'The simulated store refuses to save the SELL request before it is sent.',
    expectedOutcome: 'No broker placement call and no SELL reservation; STOP is recorded and BUY admission is blocked.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Reach the pre-broker intent barrier', detail: 'The system tries to save the SELL request before contacting the simulated exchange.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL intent persistence fails', detail: 'Saving the SELL request fails before the simulated exchange is contacted.' },
      { id: 'closed', kind: 'outcome', label: 'Fail closed before broker placement', detail: 'No broker call or reservation is allowed; STOP evidence and blocked BUY admission are expected.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'SELL accepted, but its result cannot be saved',
    purpose: 'Prove that a broker-acknowledged SELL is guarded when its submission outcome cannot be recorded.',
    injectedCondition: 'The simulated exchange accepts the SELL, but the store refuses to save the acceptance result.',
    expectedOutcome: 'The reservation remains; STOP is recorded; BUY admission is blocked while SELL admission remains allowed.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated broker acknowledges the SELL', detail: 'The simulated exchange confirms that it accepted the SELL after the request was saved.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome persistence fails', detail: 'Saving the exchange's acceptance result fails.' },
      { id: 'guard', kind: 'outcome', label: 'Retain reservation and latch STOP', detail: 'Do not treat the acknowledgement as fully recorded; preserve the reservation and block new BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'SELL result and STOP cannot be saved — block trading',
    purpose: 'Prove fail-closed admission when both the broker acknowledgement outcome and the STOP fact cannot be persisted.',
    injectedCondition: 'The store refuses to save both the SELL acceptance result and the safety STOP record.',
    expectedOutcome: 'The SELL reservation remains; both BUY and SELL admission checks are blocked. The failed STOP append is not described as durable.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated broker acknowledges the SELL', detail: 'The normal submission path has crossed the simulated broker boundary.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome and STOP persistence fail', detail: 'Saving the exchange result fails, and saving the safety STOP also fails.' },
      { id: 'blocked', kind: 'outcome', label: 'Keep account admission blocked', detail: 'The reservation remains and both BUY and SELL admission checks report blocked; the STOP fact itself was not persisted.' },
    ],
  }),
  'RS-RUNTIME-SELL-BROKER-EXCEPTION-001': runtimeGuide({
    title: 'Broker response is unknown — keep SELL unresolved',
    purpose: 'Prove that an exception during broker placement is treated as an unknown outcome, not as a safe rejection.',
    injectedCondition: 'The simulated exchange connection throws an error while the SELL is being sent. The runner cannot tell whether the exchange accepted it.',
    expectedOutcome: 'The submission remains unresolved; STOP is recorded; reservation is retained; BUY is blocked and SELL remains allowed.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Persist SELL intent', detail: 'The required pre-broker intent is recorded.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker placement throws', detail: 'The simulated exchange call errors. The runner cannot know whether an order was accepted.' },
      { id: 'unknown', kind: 'outcome', label: 'Keep outcome UNKNOWN and guard BUY', detail: 'Latch STOP and retain the reservation; do not retry or relabel the unknown outcome as rejected.' },
    ],
  }),
  'RS-RUNTIME-SELL-RESERVATION-FAILURE-001': runtimeGuide({
    title: 'Cannot reserve the recovery SELL',
    purpose: 'Prove the safety response when the callback that reserves the sole active recovery SELL fails.',
    injectedCondition: 'The step that records which SELL owns the recovery cycle returns an error.',
    expectedOutcome: 'Reservation is not reported as retained; STOP is recorded and BUY admission is blocked. Inspect run evidence for the exact broker submission outcome.',
    path: [
      { id: 'submit', kind: 'production-flow', label: 'Reach the sole-SELL reservation callback', detail: 'After submission, the system tries to reserve this SELL as the only SELL for the recovery cycle.' },
      { id: 'failure', kind: 'injected-failure', label: 'Sole-SELL reservation callback fails', detail: 'The reservation step returns an error instead of confirming the reservation.' },
      { id: 'guard', kind: 'outcome', label: 'Do not claim a retained reservation', detail: 'The expected state records reservation failure, raises STOP and blocks BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-REJECTION-001': runtimeGuide({
    title: 'Exchange rejects the recovery SELL',
    purpose: 'Prove that an explicit broker rejection is distinguished from acknowledgement and triggers the expected safety response.',
    injectedCondition: 'The simulated exchange explicitly refuses the SELL.',
    expectedOutcome: 'No accepted submitted order is reported; STOP evidence is recorded and the reservation is retained as asserted by this scenario.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Persist intent and call simulated broker', detail: 'The submitter reaches the broker boundary after the pre-submission intent step.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker rejects the SELL', detail: 'The broker returns a rejection instead of an acknowledged order.' },
      { id: 'guard', kind: 'outcome', label: 'Record rejection and safety response', detail: 'Assert no accepted order, STOP fact recorded and reservation retained; this is not a real exchange rejection.' },
    ],
  }),
  'RS-RUNTIME-SELL-PARTIAL-CANCEL-001': runtimeGuide({
    title: 'SELL partly fills, then is cancelled',
    purpose: 'Prove that a partially executed SELL which later becomes CANCELED is reconciled using its fill, not treated as a zero-fill cancellation.',
    injectedCondition: 'After accepting the SELL, the simulated exchange reports that 2.5 units were sold and then the remaining order was cancelled. The 2.5-unit amount is only this example's input.',
    expectedOutcome: 'The terminal order is reconciled and accounting is applied for the supplied fill; the cycle remains UNRESOLVED, not complete.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'partial', kind: 'condition', label: 'Partial fill, then terminal CANCELED', detail: 'In this example, 2.5 units are sold at the submitted price and the remaining order is cancelled. This amount is example data, not a general rule.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and mixed-position accounting', detail: 'The normal order-update and Recovery Seller accounting process records the sold quantity and the final cancelled status.' },
      { id: 'cycle', kind: 'outcome', label: 'Keep the cycle UNRESOLVED', detail: 'Cancellation is not a zero-fill result, and partial execution does not prove the recovery cycle is complete.' },
    ],
  }),
  'RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001': runtimeGuide({
    title: 'SELL fills, but misses the profit target',
    purpose: 'Prove the behavior when a SELL is fully FILLED but its resulting profitability is below the required target.',
    injectedCondition: 'The simulated exchange reports the entire SELL as filled, but the resulting profit is below the configured minimum.',
    expectedOutcome: 'The full fill is reconciled, profitability eligibility is false, and the safety workflow latches STOP.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'fill', kind: 'condition', label: 'Supply a fully FILLED SELL below target', detail: 'The runner creates a terminal FILLED order and canonical fill for the under-target case.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and profitability', detail: 'The normal order-update and accounting process records the completed sale and checks the resulting profit.' },
      { id: 'stop', kind: 'outcome', label: 'Latch account STOP', detail: 'The under-target result is ineligible; a FILLED order alone is not a successful recovery cycle.' },
    ],
  }),
  'RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save SELL reconciliation — keep cycle unresolved',
    purpose: 'Prove that a FILLED SELL is not treated as reconciled when persisting its terminal reconciliation fact fails.',
    injectedCondition: 'The simulated exchange reports a completed SELL, but the store refuses to save that the fill and accounting were reconciled.',
    expectedOutcome: 'Reconciliation is not marked successful; the event workflow fails closed; STOP and market pause are recorded in run state; reservation remains.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Receive terminal FILLED order and fill', detail: 'Send the terminal order and canonical fill through the production order-event workflow.' },
      { id: 'failure', kind: 'injected-failure', label: 'Terminal reconciliation persistence fails', detail: 'After receiving the completed sale, the store refuses to save the reconciliation result.' },
      { id: 'guard', kind: 'outcome', label: 'Fail closed and retain reservation', detail: 'Expect unreconciled terminal state, STOP, market pause, blocked BUY admission and retained SELL reservation.' },
    ],
  }),
  'RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save STOP after an under-target SELL',
    purpose: 'Prove that failure to persist account STOP after an under-target FILLED SELL does not permit a subsequent action.',
    injectedCondition: 'The simulated exchange completes a SELL below the profit target. Saving the STOP record then fails, and the example checks whether another action can proceed.',
    expectedOutcome: 'The STOP fact is not claimed as persisted; follow-up dispatch is blocked and no second action/order is submitted.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Reconcile an under-target FILLED SELL', detail: 'The production order-event and accounting workflows determine the terminal cycle outcome.' },
      { id: 'failure', kind: 'injected-failure', label: 'Account STOP persistence fails', detail: 'The run-local store rejects SAFETY_BLOCKER_RAISED after the under-target fill.' },
      { id: 'follow-up', kind: 'decision', label: 'Attempt a follow-up evaluation', detail: 'The example tries another market evaluation at a lower simulated price to check that no second action is allowed.' },
      { id: 'blocked', kind: 'outcome', label: 'No follow-up action is submitted', detail: 'The expected result is a blocked follow-up dispatch with no second action or order; STOP persistence itself remains failed.' },
    ],
  }),
  'RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001': runtimeGuide({
    title: 'STOP blocks BUY, but allows an eligible first SELL',
    purpose: 'Prove the direction-specific STOP rule: new BUY spending is blocked while an eligible first recovery SELL may still be submitted.',
    injectedCondition: 'The example starts with an active STOP record, then checks whether a valid recovery SELL is still allowed.',
    expectedOutcome: 'One eligible SELL is submitted; STOP status is STOPPED; BUY admission is blocked and SELL admission is permitted.',
    path: [
      { id: 'stop', kind: 'condition', label: 'Persist STOP before dispatch', detail: 'The scenario latches STOP before evaluating the market observation.' },
      { id: 'admission', kind: 'decision', label: 'Evaluate direction-specific admission', detail: 'The normal safety check decides whether STOP allows the proposed recovery action.' },
      { id: 'sell', kind: 'outcome', label: 'Allow eligible SELL; block BUY', detail: 'The result should allow the eligible recovery SELL but block any new BUY spending.' },
    ],
  }),
  'RS-004-011': createPreliminaryGuide(),
});

export function getScenarioGuide(scenarioId: string): ScenarioGuide | null {
  return guides[scenarioId] ?? null;
}

export function getScenarioGuideTitle(scenarioId: string): string | null {
  return guides[scenarioId]?.title ?? null;
}
