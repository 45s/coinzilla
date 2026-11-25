# Strategy Scenario Explorer — domain scenarios

These scenarios describe the RS-first registry visualization and later runtime-simulation capability. The original simulated-evaluation scenarios below are future execution-contract scenarios (not part of initial registry-only implementation).

## Future execution scenario 01 — Inspect a simulated recovery SELL path

**Purpose:** Show the decision path and exact inspector values for a successful evaluation.

### Given
A scenario has simulated accounted BUY inventory, cost basis, a market price and valid metadata/filter inputs. No active simulated SELL is present.

### When
The user runs the scenario and selects a node in the resulting decision diagram.

### Then
The Lab shows only trace/graph steps emitted by the simulation contract, highlights the selected node and its evaluated path, and displays its inputs, calculations, validation, reason and output in the inspector. The result is labelled simulated intent, not exchange acknowledgement.

## Future execution scenario 02 — Existing SELL reservation

**Purpose:** Explain why another recovery SELL is not planned when one is already active.

### Given
The scenario initial state contains an active simulated recovery SELL reservation.

### When
The evaluator runs.

### Then
The actual evaluator's active-order decision is represented in the trace and diagram. No second SELL is invented by the UI. The inspector exposes the evaluator's result.

## Future execution scenario 03 — Quantity/filter disposition

**Purpose:** Inspect blocked or classified residual inventory.

### Given
The scenario has a simulated inventory amount that may be insufficient for quantity/notional/step filters.

### When
The evaluator runs.

### Then
The trace displays the actual evaluator classification/disposition and relevant input/filter values. The diagram shows the evaluated path and outcome; the UI does not calculate a classification independently.

## Future execution scenario 04 — Metadata unavailable

**Purpose:** Make fail-closed behavior visible.

### Given
The scenario's filter/metadata input is marked unavailable or invalid.

### When
The user runs the scenario.

### Then
The Lab displays the evaluator's blocked/failure outcome and reason, marks the corresponding graph node, and does not replace missing metadata with fabricated defaults.

## Future execution scenario 05 — Inject a partial BUY fill

**Purpose:** Explore fill-driven state changes across subsequent evaluation.

### Given
A valid scenario starting state has been loaded.

### When
The user injects a partial BUY fill event.

### Then
The event is appended to the event history, the simulation contract processes it, and subsequent evaluations/trace state reflect only the supported contract result. The event's amount and scenario state are clearly simulated.

## Future execution scenario 06 — Price update and reevaluation

**Purpose:** Explore how market-price inputs affect decisions.

### Given
A scenario has completed one evaluation.

### When
The user injects a market-price update and reevaluates.

### Then
The Lab records the new simulated price event, retains the previous run step/history for navigation as defined by replay semantics, and displays the new evaluated path. No real ticker is queried.

## Future execution scenario 07 — Invalid event rejected

**Purpose:** Prevent malformed inputs from corrupting the run.

### Given
A scenario has a valid state and history.

### When
The user attempts to inject an invalid event (e.g., negative quantity or missing required market identity).

### Then
The event is rejected with a specific validation message. The previously valid scenario state and history remain unchanged.

## Future execution scenario 08 — Simulated rejection

**Purpose:** Inspect an order-submission failure without any real submission.

### Given
The evaluation produced an intent and the simulation contract supports a rejection event.

### When
The user injects a simulated rejection.

### Then
The Lab records a rejection as a simulation event, shows the corresponding failure/outcome trace and inspector details, and clearly distinguishes the simulated rejection from a real broker response.

## Future execution scenario 09 — Step/replay

**Purpose:** Examine the evaluation one step at a time.

### Given
A scenario run contains multiple trace steps and graph nodes.

### When
The user steps forward or selects an earlier step.

### Then
The trace and graph highlight the selected point in history, the inspector displays the associated details, and no new event or evaluation is generated merely by navigating.

## Future execution scenario 10 — Save and reload a scenario

**Purpose:** Reuse reproducible scenario inputs.

### Given
A user has configured a scenario and event sequence.

### When
The user saves, reloads and runs it.

### Then
The stored simulation inputs/events are restored and validated against the storage format version. Invalid or incompatible saved scenarios fail visibly and do not corrupt other saved scenarios. Persistence medium and exact compatibility policy remain open.

## Future execution scenario 11 — Simulation isolation

**Purpose:** Prove no live broker or production side effects are possible.

### Given
The Lab is open and a scenario is configured.

### When
The user runs, steps, injects events, resets or saves the scenario.

### Then
Only simulation-owned state changes. No exchange API, broker, live order, database or production Harvester state is accessed or mutated. Tests verify this boundary.

## Future execution scenario 12 — Diagram rendering failure

**Purpose:** Keep behavior inspection usable if graph layout fails.

### Given
A simulation trace was successfully returned but graph rendering/layout cannot display it.

### When
The Lab renders the result.

### Then
The ordered textual execution trace and calculation inspector remain usable, and graph rendering reports an explicit UI error. The failure does not change simulation state or output.


## RS Registry Explorer scenarios — initial scope

### RS Explorer 01 — Browse scenario families and records
**Given** the registry export contains scenario records across families.

**When** a user opens the Explorer and selects a family or record.

**Then** all records in the registry are discoverable, record identifiers/names/statuses are displayed from source data, and selecting a record opens its detail/diagram. The UI does not hardcode a family count.

### RS Explorer 02 — Reconstruct Given/When/Then
**Given** a record with inputs, ordered steps, expected results and mustNot clauses.

**When** its behavior diagram is opened.

**Then** nodes and ordering reproduce those source fields faithfully; missing or malformed fields are explicit; no invented decision branches or strategy calculations are added.

### RS Explorer 03 — Inspect a subcase and test mapping
**Given** a record has subcases and test mappings.

**When** the user selects a subcase or test-reference node.

**Then** the inspector shows exact mapping/status/evidence fields and safely navigable references. TEST-MAPPED is not represented as CI pass or VERIFIED.

### RS Explorer 04 — Trace a shared rule or invariant
**Given** multiple scenario records refer to a shared rule, invariant, source or test mapping.

**When** the user selects the shared relationship node.

**Then** the graph/list shows only registry-backed relationships and allows navigation to each linked scenario. Unmapped relationships are not inferred.

### RS Explorer 05 — Filters and family overview
**Given** registry data is available.

**When** the user filters by family, priority, layer, status or identifier, or opens the family overview.

**Then** graph/list/summary update from registry data, with counts computed dynamically; no source data is changed and reset affects only UI filters/selection.

### RS Explorer 06 — Missing mapping or blocker
**Given** a scenario record has an explicit blocker, partial status or missing relationship.

**When** the user inspects the record or relationship graph.

**Then** the blocker/status/missing link is visible and not interpreted as a verified strategy outcome or silently hidden.

### RS Explorer 07 — Diagram layout failure
**Given** registry data is readable but graph layout fails.

**When** the visualization attempts to render.

**Then** record text, navigation list and inspector remain usable, and the rendering failure is explicit.

### RS Explorer 08 — Registry source unavailable or incompatible
**Given** the stable registry export/API is unavailable, invalid or incompatible.

**When** Explorer loads.

**Then** it shows an explicit unavailable/schema error and does not silently substitute fixtures, omit records, or import private Harvester test modules into the browser.
