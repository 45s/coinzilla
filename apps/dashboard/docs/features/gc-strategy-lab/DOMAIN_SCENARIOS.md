# GC Strategy Lab — Domain scenarios

These scenarios describe the proposed Lab interaction and simulator contract. Values are illustrative; strategy outcomes must be confirmed by the actual GC evaluator, not by this document's assumptions.

## Scenario 01 — Inspect a simulated recovery SELL path

**Purpose:** Show the decision path and exact inspector values for a successful evaluation.

### Given
A scenario has simulated accounted BUY inventory, cost basis, a market price and valid metadata/filter inputs. No active simulated SELL is present.

### When
The user runs the scenario and selects a node in the resulting decision diagram.

### Then
The Lab shows only trace/graph steps emitted by the simulation contract, highlights the selected node and its evaluated path, and displays its inputs, calculations, validation, reason and output in the inspector. The result is labelled simulated intent, not exchange acknowledgement.

## Scenario 02 — Existing SELL reservation

**Purpose:** Explain why another recovery SELL is not planned when one is already active.

### Given
The scenario initial state contains an active simulated recovery SELL reservation.

### When
The evaluator runs.

### Then
The actual evaluator's active-order decision is represented in the trace and diagram. No second SELL is invented by the UI. The inspector exposes the evaluator's result.

## Scenario 03 — Quantity/filter disposition

**Purpose:** Inspect blocked or classified residual inventory.

### Given
The scenario has a simulated inventory amount that may be insufficient for quantity/notional/step filters.

### When
The evaluator runs.

### Then
The trace displays the actual evaluator classification/disposition and relevant input/filter values. The diagram shows the evaluated path and outcome; the UI does not calculate a classification independently.

## Scenario 04 — Metadata unavailable

**Purpose:** Make fail-closed behavior visible.

### Given
The scenario's filter/metadata input is marked unavailable or invalid.

### When
The user runs the scenario.

### Then
The Lab displays the evaluator's blocked/failure outcome and reason, marks the corresponding graph node, and does not replace missing metadata with fabricated defaults.

## Scenario 05 — Inject a partial BUY fill

**Purpose:** Explore fill-driven state changes across subsequent evaluation.

### Given
A valid scenario starting state has been loaded.

### When
The user injects a partial BUY fill event.

### Then
The event is appended to the event history, the simulation contract processes it, and subsequent evaluations/trace state reflect only the supported contract result. The event's amount and scenario state are clearly simulated.

## Scenario 06 — Price update and reevaluation

**Purpose:** Explore how market-price inputs affect decisions.

### Given
A scenario has completed one evaluation.

### When
The user injects a market-price update and reevaluates.

### Then
The Lab records the new simulated price event, retains the previous run step/history for navigation as defined by replay semantics, and displays the new evaluated path. No real ticker is queried.

## Scenario 07 — Invalid event rejected

**Purpose:** Prevent malformed inputs from corrupting the run.

### Given
A scenario has a valid state and history.

### When
The user attempts to inject an invalid event (e.g., negative quantity or missing required market identity).

### Then
The event is rejected with a specific validation message. The previously valid scenario state and history remain unchanged.

## Scenario 08 — Simulated rejection

**Purpose:** Inspect an order-submission failure without any real submission.

### Given
The evaluation produced an intent and the simulation contract supports a rejection event.

### When
The user injects a simulated rejection.

### Then
The Lab records a rejection as a simulation event, shows the corresponding failure/outcome trace and inspector details, and clearly distinguishes the simulated rejection from a real broker response.

## Scenario 09 — Step/replay

**Purpose:** Examine the evaluation one step at a time.

### Given
A scenario run contains multiple trace steps and graph nodes.

### When
The user steps forward or selects an earlier step.

### Then
The trace and graph highlight the selected point in history, the inspector displays the associated details, and no new event or evaluation is generated merely by navigating.

## Scenario 10 — Save and reload a scenario

**Purpose:** Reuse reproducible scenario inputs.

### Given
A user has configured a scenario and event sequence.

### When
The user saves, reloads and runs it.

### Then
The stored simulation inputs/events are restored and validated against the storage format version. Invalid or incompatible saved scenarios fail visibly and do not corrupt other saved scenarios. Persistence medium and exact compatibility policy remain open.

## Scenario 11 — Simulation isolation

**Purpose:** Prove no live broker or production side effects are possible.

### Given
The Lab is open and a scenario is configured.

### When
The user runs, steps, injects events, resets or saves the scenario.

### Then
Only simulation-owned state changes. No exchange API, broker, live order, database or production Harvester state is accessed or mutated. Tests verify this boundary.

## Scenario 12 — Diagram rendering failure

**Purpose:** Keep behavior inspection usable if graph layout fails.

### Given
A simulation trace was successfully returned but graph rendering/layout cannot display it.

### When
The Lab renders the result.

### Then
The ordered textual execution trace and calculation inspector remain usable, and graph rendering reports an explicit UI error. The failure does not change simulation state or output.
