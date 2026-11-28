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
    { id: 'start', kind: 'start', label: 'Supply recovery and legacy profitability inputs', detail: 'Enter the recovery costs and proceeds, the legacy holding\'s average cost and quantity sold, its proceeds, and the minimum profit required.' },
    { id: 'calculate', kind: 'decision', label: 'Calculate the three profit results', detail: 'The production calculation checks recovery profit, legacy profit and total cycle profit separately.' },
    { id: 'outcome', kind: 'outcome', label: 'Check the calculated profit against the expected values', detail: 'The check compares the calculated recovery, legacy and combined results with the expected values.' },
  ];
  return Object.freeze({
    title: 'Check three independent profit requirements',
    availability: 'PRELIMINARY',
    purpose: 'This example checks three separate profit requirements. It calls the production profit calculation only; it does not run a BUY, SELL or recovery cycle.',
    startingState: 'The example gives recovery and legacy costs and proceeds separately. The minimum profit is an amount in the market\'s quote currency.',
    injectedCondition: 'Nothing happens in the trading lifecycle. The example sends only the supplied numbers to the profit calculation.',
    expectedOutcome: 'The calculation reports recovery profit, legacy profit and combined-cycle profit separately. The example checks that each one meets its own required minimum.',
    limitations: Object.freeze([
      'Preliminary example only: it calculates profit but does not run the Recovery Seller trading process.',
      'It does not create an order, contact an exchange, process a fill, change a recovery cycle or test STOP behavior.',
    ]),
    steps: Object.freeze(steps),
  });
}

const guides: Readonly<Record<string, ScenarioGuide>> = Object.freeze({
  'RS-RUNTIME-SELL-SUBMISSION-001': runtimeGuide({
    title: 'Submit one recovery SELL',
    purpose: 'This example follows a recovery position that is allowed to sell. It checks that exactly one SELL is sent, accepted and assigned to the recovery cycle.',
    injectedCondition: 'No failure is injected. The simulated exchange accepts the planned SELL.',
    expectedOutcome: 'Exactly one SELL is sent to the simulated exchange. Its acceptance is saved, and the recovery cycle is reserved for that order.',
    path: [
      { id: 'authorize', kind: 'decision', label: 'Authorize the recovery SELL', detail: 'Check recovery position, order ownership, account snapshot, STOP state and market rules.' },
      { id: 'submit', kind: 'production-flow', label: 'Save the SELL request → exchange accepts it → save the result → reserve the cycle', detail: 'The production order submitter runs its normal intent/outcome callbacks and reserves the cycle against the acknowledged order.' },
    ],
  }),
  'RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save SELL intention — do not place order',
    purpose: 'This example checks that the system does not send a SELL if it cannot first save a record that the sale is about to happen.',
    injectedCondition: 'The simulated store refuses to save the SELL request before it is sent.',
    expectedOutcome: 'No SELL is sent and no SELL reservation is created. A STOP is recorded, and new BUY spending is blocked.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Reach the pre-broker intent barrier', detail: 'The system tries to save the SELL request before contacting the simulated exchange.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL intent persistence fails', detail: 'Saving the SELL request fails before the simulated exchange is contacted.' },
      { id: 'closed', kind: 'outcome', label: 'Fail closed before broker placement', detail: 'No broker call or reservation is allowed; STOP evidence and blocked BUY admission are expected.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'SELL accepted, but its result cannot be saved',
    purpose: 'This example checks what happens when the simulated exchange accepts a SELL but the system cannot save that acceptance.',
    injectedCondition: 'The simulated exchange accepts the SELL, but the store refuses to save the acceptance result.',
    expectedOutcome: 'Keep the SELL reserved and record STOP. Block new BUY spending, but continue to allow an eligible recovery SELL.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated exchange accepts the SELL', detail: 'The simulated exchange confirms that it accepted the SELL after the request was saved.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome persistence fails', detail: 'Saving the exchange\'s acceptance result fails.' },
      { id: 'guard', kind: 'outcome', label: 'Retain reservation and latch STOP', detail: 'Do not treat the acknowledgement as fully recorded; preserve the reservation and block new BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'SELL result and STOP cannot be saved — block trading',
    purpose: 'This example checks that trading stays blocked if the system cannot save either the exchange\'s SELL acceptance or the STOP record.',
    injectedCondition: 'The store refuses to save both the SELL acceptance result and the safety STOP record.',
    expectedOutcome: 'Keep the SELL reservation. Block both new BUY and SELL submissions. Do not claim that STOP was saved, because that save failed.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Simulated broker acknowledges the SELL', detail: 'The normal submission path has crossed the simulated broker boundary.' },
      { id: 'failure', kind: 'injected-failure', label: 'SELL outcome and STOP persistence fail', detail: 'Saving the exchange result fails, and saving the safety STOP also fails.' },
      { id: 'blocked', kind: 'outcome', label: 'Keep account admission blocked', detail: 'The reservation remains and both BUY and SELL admission checks report blocked; the STOP fact itself was not persisted.' },
    ],
  }),
  'RS-RUNTIME-SELL-BROKER-EXCEPTION-001': runtimeGuide({
    title: 'Broker response is unknown — keep SELL unresolved',
    purpose: 'This example checks that a connection error while sending a SELL is treated as unknown. The system must not assume the exchange rejected it.',
    injectedCondition: 'The simulated exchange connection throws an error while the SELL is being sent. The runner cannot tell whether the exchange accepted it.',
    expectedOutcome: 'Keep the SELL unresolved and its reservation in place. Record STOP and block new BUY spending. Do not send a replacement SELL.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Save the SELL request', detail: 'The required pre-broker intent is recorded.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker placement throws', detail: 'The simulated exchange call errors. The runner cannot know whether an order was accepted.' },
      { id: 'unknown', kind: 'outcome', label: 'Keep the result unknown and block new BUY spending', detail: 'Latch STOP and retain the reservation; do not retry or relabel the unknown outcome as rejected.' },
    ],
  }),
  'RS-RUNTIME-SELL-RESERVATION-FAILURE-001': runtimeGuide({
    title: 'Cannot reserve the recovery SELL',
    purpose: 'This example checks the safety response when the system cannot reserve the only SELL allowed for this recovery cycle.',
    injectedCondition: 'The step that records which SELL owns the recovery cycle returns an error.',
    expectedOutcome: 'Do not report a successful reservation. Record STOP and block new BUY spending. Inspect the run evidence to see whether the simulated exchange accepted the SELL.',
    path: [
      { id: 'submit', kind: 'production-flow', label: 'Reach the sole-SELL reservation callback', detail: 'After submission, the system tries to reserve this SELL as the only SELL for the recovery cycle.' },
      { id: 'failure', kind: 'injected-failure', label: 'The recovery SELL cannot be reserved', detail: 'The reservation step returns an error instead of confirming the reservation.' },
      { id: 'guard', kind: 'outcome', label: 'Do not claim a retained reservation', detail: 'The expected state records reservation failure, raises STOP and blocks BUY admission.' },
    ],
  }),
  'RS-RUNTIME-SELL-REJECTION-001': runtimeGuide({
    title: 'Exchange rejects the recovery SELL',
    purpose: 'This example checks that an explicit exchange rejection is handled differently from an accepted SELL.',
    injectedCondition: 'The simulated exchange explicitly refuses the SELL.',
    expectedOutcome: 'Do not report an accepted SELL. Record STOP and keep the reservation state exactly as shown by the run.',
    path: [
      { id: 'intent', kind: 'production-flow', label: 'Save the SELL request and contact the simulated exchange', detail: 'The submitter reaches the broker boundary after the pre-submission intent step.' },
      { id: 'failure', kind: 'injected-failure', label: 'Simulated broker rejects the SELL', detail: 'The broker returns a rejection instead of an acknowledged order.' },
      { id: 'guard', kind: 'outcome', label: 'Record rejection and safety response', detail: 'Assert no accepted order, STOP fact recorded and reservation retained; this is not a real exchange rejection.' },
    ],
  }),
  'RS-RUNTIME-SELL-PARTIAL-CANCEL-001': runtimeGuide({
    title: 'SELL partly fills, then is cancelled',
    purpose: 'This example checks that coins already sold are still counted when the remaining SELL order is later cancelled.',
    injectedCondition: 'After accepting the SELL, the simulated exchange reports that 2.5 units were sold and then the remaining order was cancelled. The 2.5-unit amount is only this example\'s input.',
    expectedOutcome: 'Account for the 2.5 units already sold. Keep the recovery cycle unresolved; a partial sale followed by cancellation is not a completed recovery.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'partial', kind: 'condition', label: 'Some coins sell; the remaining order is cancelled', detail: 'In this example, 2.5 units are sold at the submitted price and the remaining order is cancelled. This amount is example data, not a general rule.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and mixed-position accounting', detail: 'The normal order-update and Recovery Seller accounting process records the sold quantity and the final cancelled status.' },
      { id: 'cycle', kind: 'outcome', label: 'Keep the cycle UNRESOLVED', detail: 'Cancellation is not a zero-fill result, and partial execution does not prove the recovery cycle is complete.' },
    ],
  }),
  'RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001': runtimeGuide({
    title: 'SELL fills, but misses the profit target',
    purpose: 'This example checks what happens when the entire SELL completes but the profit is less than the configured minimum.',
    injectedCondition: 'The simulated exchange reports the entire SELL as filled, but the resulting profit is below the configured minimum.',
    expectedOutcome: 'Record the completed sale and its actual result. Because the profit target was missed, latch STOP instead of marking the recovery successful.',
    path: [
      { id: 'ack', kind: 'production-flow', label: 'Acknowledge the planned SELL', detail: 'The simulated broker returns the open SELL order.' },
      { id: 'fill', kind: 'condition', label: 'The entire SELL completes below the profit target', detail: 'The runner creates a terminal FILLED order and canonical fill for the under-target case.' },
      { id: 'reconcile', kind: 'production-flow', label: 'Reconcile fill and profitability', detail: 'The normal order-update and accounting process records the completed sale and checks the resulting profit.' },
      { id: 'stop', kind: 'outcome', label: 'Latch account STOP', detail: 'The under-target result is ineligible; a FILLED order alone is not a successful recovery cycle.' },
    ],
  }),
  'RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save SELL reconciliation — keep cycle unresolved',
    purpose: 'This example checks that a completed SELL is not treated as fully processed if the system cannot save its reconciliation.',
    injectedCondition: 'The simulated exchange reports a completed SELL, but the store refuses to save that the fill and accounting were reconciled.',
    expectedOutcome: 'Do not mark the sale as reconciled. Keep the reservation, block further activity, and show that saving the reconciliation failed.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Receive the completed SELL and its fill', detail: 'Send the terminal order and canonical fill through the production order-event workflow.' },
      { id: 'failure', kind: 'injected-failure', label: 'Saving the completed SELL reconciliation fails', detail: 'After receiving the completed sale, the store refuses to save the reconciliation result.' },
      { id: 'guard', kind: 'outcome', label: 'Fail closed and retain reservation', detail: 'Expect unreconciled terminal state, STOP, market pause, blocked BUY admission and retained SELL reservation.' },
    ],
  }),
  'RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001': runtimeGuide({
    title: 'Cannot save STOP after an under-target SELL',
    purpose: 'This example checks that a missed profit target still blocks another action even if saving the STOP record itself fails.',
    injectedCondition: 'The simulated exchange completes a SELL below the profit target. Saving the STOP record then fails, and the example checks whether another action can proceed.',
    expectedOutcome: 'Do not claim STOP was saved. Even so, block the follow-up action and submit no second order.',
    path: [
      { id: 'fill', kind: 'production-flow', label: 'Record a completed SELL that missed its profit target', detail: 'The production order-event and accounting workflows determine the terminal cycle outcome.' },
      { id: 'failure', kind: 'injected-failure', label: 'Saving the STOP record fails', detail: 'The run-local store rejects SAFETY_BLOCKER_RAISED after the under-target fill.' },
      { id: 'follow-up', kind: 'decision', label: 'Attempt a follow-up evaluation', detail: 'The example tries another market evaluation at a lower simulated price to check that no second action is allowed.' },
      { id: 'blocked', kind: 'outcome', label: 'No follow-up action is submitted', detail: 'The expected result is a blocked follow-up dispatch with no second action or order; STOP persistence itself remains failed.' },
    ],
  }),
  'RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001': runtimeGuide({
    title: 'STOP blocks BUY, but allows an eligible first SELL',
    purpose: 'This example checks the direction of the STOP rule: it blocks new BUY spending, but does not automatically block an eligible first recovery SELL.',
    injectedCondition: 'The example starts with an active STOP record, then checks whether a valid recovery SELL is still allowed.',
    expectedOutcome: 'The eligible recovery SELL is allowed. New BUY spending remains blocked while STOP is active.',
    path: [
      { id: 'stop', kind: 'condition', label: 'Start with STOP already active', detail: 'The scenario latches STOP before evaluating the market observation.' },
      { id: 'admission', kind: 'decision', label: 'Check whether STOP allows this action', detail: 'The normal safety check decides whether STOP allows the proposed recovery action.' },
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
