type EvidenceRecord = Record<string, unknown>;

export interface ScenarioRunPresentationStep {
  readonly key: string;
  readonly id: string | null;
  readonly kind: string | null;
  readonly label: string | null;
  readonly sourceIndex: number;
  readonly timestamp: string | null;
  readonly sourceEvidence: unknown;
}

export interface ScenarioRunPresentationOrder {
  readonly side: string | null;
  readonly purpose: string | null;
  readonly quantity: string | null;
  readonly price: string | null;
  readonly orderType: string | null;
  readonly submissionOutcome: string | null;
  readonly initialStatus: string | null;
  readonly clientOrderId: string | null;
  readonly brokerOrderId: string | null;
  readonly terminalStatus: string | null;
  readonly executedQuantity: string | null;
  readonly terminalReconciled: boolean | null;
  readonly sourceEvidence: {
    readonly submittedOrder: unknown;
    readonly submissionFact: unknown;
    readonly terminalOrder: unknown;
  };
}

export interface ScenarioRunPresentation {
  readonly rawPayload: unknown;
  readonly rawJson: string;
  readonly identity: {
    readonly runId: string | null;
    readonly strategyId: string | null;
    readonly scenarioId: string | null;
    readonly symbol: string | null;
    readonly venue: string | null;
    readonly executionMode: string | null;
  };
  readonly configuration: unknown;
  readonly configurationSummary: readonly { readonly key: string; readonly value: unknown }[];
  readonly steps: readonly ScenarioRunPresentationStep[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly label?: string;
  }[];
  readonly decision: { readonly outcome: string | null; readonly explanation: string | null; readonly reasonCode: string | null } | null;
  readonly action: unknown;
  readonly orders: readonly ScenarioRunPresentationOrder[];
  readonly cycle: {
    readonly status: string;
    readonly sourceEvidence: unknown;
  };
  readonly cycles: readonly { readonly id: string | null; readonly positionId: string | null; readonly status: string; readonly sourceEvidence: unknown }[];
  readonly outcomes: {
    readonly execution: {
      readonly status: string | null;
      readonly outcome: string | null;
      readonly mode: string | null;
      readonly workerIsolation: string | null;
    };
    readonly assertions: {
      readonly passed: number;
      readonly total: number;
      readonly failed: number;
    } | null;
    readonly lifecycle: {
      readonly orderCount: number;
      readonly terminalOrderCount: number;
      readonly partiallyExecutedOrderCount: number;
    };
    readonly accounting: {
      readonly cycleStatus: string;
      readonly complete: boolean | null;
    };
    readonly safety: {
      readonly stopRecorded: boolean | null;
      readonly marketPaused: boolean | null;
      readonly buyAdmissionBlocked: boolean | null;
      readonly sellAdmissionBlocked: boolean | null;
      readonly pauseReasons: readonly unknown[];
    };
    readonly provenance: {
      readonly verified: boolean | null;
      readonly catalogStatus: string | null;
      readonly buildArtifactSha256: string | null | undefined;
      readonly workerIsolation: string | null;
      readonly missing: readonly unknown[];
      readonly traceCompleteness: string | null;
      readonly catalogSnapshotProvenance: string | null;
    };
  };
}

function asRecord(value: unknown): EvidenceRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as EvidenceRecord;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(record: EvidenceRecord | null, key: string): EvidenceRecord | null {
  return record ? asRecord(record[key]) : null;
}

function readString(record: EvidenceRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readBoolean(record: EvidenceRecord | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === 'string') ?? null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  return values.find((value): value is boolean => typeof value === 'boolean') ?? null;
}

function parseSource(rawPayload: unknown): unknown {
  if (typeof rawPayload !== 'string') {
    return rawPayload;
  }
  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    return null;
  }
}

function serializeSource(rawPayload: unknown): string {
  if (typeof rawPayload === 'string') {
    return rawPayload;
  }
  try {
    return JSON.stringify(rawPayload, null, 2) ?? 'null';
  } catch {
    return '[Source payload could not be serialized.]';
  }
}

function readTrace(root: EvidenceRecord | null, runOutput: EvidenceRecord | null): readonly unknown[] {
  const rootTrace = root?.['trace'];
  return Array.isArray(rootTrace) ? rootTrace : asArray(runOutput?.['trace']);
}

function readEdges(root: EvidenceRecord | null, runOutput: EvidenceRecord | null): readonly {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}[] {
  const graph = readRecord(root, 'graph');
  const candidates = [
    root?.['traceEdges'],
    graph?.['edges'],
    readRecord(root, 'traceGraph')?.['edges'],
    runOutput?.['traceEdges'],
    readRecord(runOutput, 'graph')?.['edges'],
    readRecord(runOutput, 'traceGraph')?.['edges'],
  ];
  const sourceEdges = candidates.find(Array.isArray);
  return asArray(sourceEdges).flatMap((value) => {
    const edge = asRecord(value);
    const from = readString(edge, 'from');
    const to = readString(edge, 'to');
    if (!from || !to) {
      return [];
    }
    const label = readString(edge, 'label');
    return [label ? { from, to, label } : { from, to }];
  });
}

function readAssertions(root: EvidenceRecord | null, runOutput: EvidenceRecord | null): {
  readonly passed: number;
  readonly total: number;
  readonly failed: number;
} | null {
  const source = root?.['assertionResults'] ?? runOutput?.['assertionResults'] ?? runOutput?.['assertions'];
  if (!Array.isArray(source)) {
    return null;
  }
  const results = source.map(asRecord);
  return {
    passed: results.filter((item) => readBoolean(item, 'passed') === true).length,
    total: results.length,
    failed: results.filter((item) => readBoolean(item, 'passed') === false).length,
  };
}

function compareDecimalStrings(left: string, right: string): number | null {
  const decimalPattern = /^\\d+(?:\\.\\d+)?$/;
  if (!decimalPattern.test(left) || !decimalPattern.test(right)) {
    return null;
  }
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const normalizedLeftWhole = leftWhole.replace(/^0+(?=\\d)/, '');
  const normalizedRightWhole = rightWhole.replace(/^0+(?=\\d)/, '');
  if (normalizedLeftWhole.length !== normalizedRightWhole.length) {
    return normalizedLeftWhole.length > normalizedRightWhole.length ? 1 : -1;
  }
  if (normalizedLeftWhole !== normalizedRightWhole) {
    return normalizedLeftWhole > normalizedRightWhole ? 1 : -1;
  }
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeftFraction = leftFraction.padEnd(fractionLength, '0');
  const normalizedRightFraction = rightFraction.padEnd(fractionLength, '0');
  if (normalizedLeftFraction === normalizedRightFraction) {
    return 0;
  }
  return normalizedLeftFraction > normalizedRightFraction ? 1 : -1;
}

function isPartialExecution(order: ScenarioRunPresentationOrder): boolean {
  if (order.terminalStatus === null || order.executedQuantity === null || order.quantity === null) {
    return false;
  }
  const executedComparison = compareDecimalStrings(order.executedQuantity, '0');
  const totalComparison = compareDecimalStrings(order.executedQuantity, order.quantity);
  return executedComparison !== null && executedComparison > 0 &&
    totalComparison !== null && totalComparison < 0;
}

function buildOrders(runtimeOutput: EvidenceRecord | null): readonly ScenarioRunPresentationOrder[] {
  const submittedOrders = asArray(runtimeOutput?.['submittedOrders']);
  const terminalOrder = readRecord(runtimeOutput, 'terminalSell');
  const terminalClientOrderId = readString(terminalOrder, 'clientOrderId');
  const terminalBrokerOrderId = readString(terminalOrder, 'brokerOrderId');
  const simulationFacts = asArray(runtimeOutput?.['simulationFacts']);

  return submittedOrders.flatMap((sourceOrder) => {
    const order = asRecord(sourceOrder);
    if (!order) {
      return [];
    }
    const clientOrderId = readString(order, 'clientOrderId');
    const brokerOrderId = readString(order, 'brokerOrderId');
    const matchesTerminal = Boolean(
      terminalOrder &&
      ((clientOrderId && terminalClientOrderId === clientOrderId) ||
        (brokerOrderId && terminalBrokerOrderId === brokerOrderId)),
    );
    const matchedTerminal = matchesTerminal ? terminalOrder : null;
    const submissionFact = simulationFacts
      .map(asRecord)
      .find((fact) => {
        const data = readRecord(fact, 'data');
        return Boolean(clientOrderId && readString(data, 'clientOrderId') === clientOrderId &&
          readString(fact, 'factType') === 'ORDER_SUBMISSION_OUTCOME');
      }) ?? null;
    const submissionData = readRecord(submissionFact, 'data');
    const executedQuantity = readString(matchedTerminal, 'executedQuantity');

    return [{
      side: readString(order, 'side'),
      purpose: firstString(readString(order, 'purpose'), readString(submissionData, 'purpose')),
      quantity: readString(order, 'quantity'),
      price: readString(order, 'price'),
      orderType: readString(order, 'type'),
      submissionOutcome: readString(submissionData, 'outcome'),
      initialStatus: readString(order, 'status'),
      clientOrderId,
      brokerOrderId,
      terminalStatus: readString(matchedTerminal, 'orderStatus'),
      executedQuantity,
      terminalReconciled: readBoolean(matchedTerminal, 'terminalReconciled'),
      sourceEvidence: {
        submittedOrder: sourceOrder,
        submissionFact,
        terminalOrder: matchedTerminal,
      },
    }];
  });
}

export function createScenarioRunPresentation(rawPayload: unknown): ScenarioRunPresentation {
  const parsedSource = parseSource(rawPayload);
  const root = asRecord(parsedSource);
  const run = readRecord(root, 'run') ?? root;
  const runOutput = readRecord(run, 'output');
  const runtimeOutput = readRecord(runOutput, 'output') ?? runOutput;
  const input = readRecord(run, 'input') ?? readRecord(runOutput, 'input');
  const execution = readRecord(root, 'execution');
  const replayProvenance = readRecord(run, 'replayProvenance') ?? readRecord(root, 'replayProvenance') ?? readRecord(runOutput, 'replayProvenance');
  const provenanceIdentity = readRecord(replayProvenance, 'identity');
  const catalog = readRecord(root, 'scenarioCatalogSnapshot');
  const terminalOrder = readRecord(runtimeOutput, 'terminalSell');
  const cycleState = readRecord(terminalOrder, 'cycleState') ?? readRecord(runtimeOutput, 'cycleState');
  const cycleStatus = firstString(readString(cycleState, 'status'), readString(runtimeOutput, 'cycleStatus')) ?? 'UNAVAILABLE';
  const simulationFacts = asArray(runtimeOutput?.['simulationFacts']);
  const hasSafetyFact = simulationFacts.some((value) =>
    readString(asRecord(value), 'factType') === 'SAFETY_BLOCKER_RAISED');
  const stopRecorded = firstBoolean(
    readBoolean(runtimeOutput, 'stopFactAppended'),
    readBoolean(terminalOrder, 'stopFactAppended'),
    hasSafetyFact ? true : null,
  );
  const orders = buildOrders(runtimeOutput);
  const decisionSource = readRecord(runtimeOutput, 'decision');
  const configurationSummary = ['investment', 'quoteBalanceFree', 'orderQuantity', 'sellQuantity', 'keepQuantity', 'minProfit', 'marketPrice', 'makerPercent', 'takerPercent', 'minQuantity', 'minNotional', 'priceIncrement', 'quantityIncrement']
    .filter((key) => input !== null && Object.prototype.hasOwnProperty.call(input, key))
    .map((key) => ({ key, value: input?.[key] }));
  const artifactHashValue = provenanceIdentity?.['buildArtifactSha256'];
  const buildArtifactSha256 = typeof artifactHashValue === 'string' || artifactHashValue === null
    ? artifactHashValue
    : undefined;
  const steps = readTrace(root, runOutput).map((value, index): ScenarioRunPresentationStep => {
    const step = asRecord(value);
    const id = readString(step, 'id');
    const kind = readString(step, 'kind');
    return {
      key: id ?? `source-step-${index}`,
      id,
      kind,
      label: readString(step, 'label'),
      sourceIndex: index,
      timestamp: firstString(readString(step, 'at'), readString(step, 'timestamp'), readString(step, 'occurredAt'), readString(step, 'createdAt')),
      sourceEvidence: value,
    };
  });
  const provenanceVerified = readBoolean(replayProvenance, 'verified');
  const executionMode = firstString(
    readString(root, 'executionMode'),
    readString(execution, 'mode'),
    readString(run, 'executionMode'),
    readString(runOutput, 'executionMode'),
  );
  const runStatus = readString(run, 'status');
  const assertions = readAssertions(root, runOutput);
  const terminalOrderCount = orders.filter((order) => order.terminalStatus !== null).length;
  const partiallyExecutedOrderCount = orders.filter(isPartialExecution).length;
  const pauseReasons = asArray(terminalOrder?.['pauseReasons'] ?? runtimeOutput?.['pauseReasons']);

  return {
    rawPayload,
    rawJson: serializeSource(rawPayload),
    identity: {
      runId: readString(run, 'runId'),
      strategyId: readString(run, 'strategyId'),
      scenarioId: readString(run, 'scenarioId'),
      symbol: firstString(readString(input, 'symbol'), readString(runOutput, 'symbol')),
      venue: firstString(readString(input, 'venue'), readString(runOutput, 'venue')),
      executionMode,
    },
    configuration: input,
    configurationSummary,
    steps,
    edges: readEdges(root, runOutput),
    decision: decisionSource ? {
      outcome: readString(decisionSource, 'outcome'),
      explanation: readString(decisionSource, 'explanation'),
      reasonCode: readString(decisionSource, 'reasonCode'),
    } : null,
    action: runtimeOutput?.['action'] ?? null,
    orders,
    cycle: {
      status: cycleStatus,
      sourceEvidence: cycleState,
    },
    cycles: [],
    outcomes: {
      execution: {
        status: runStatus,
        outcome: readString(execution, 'outcome'),
        mode: executionMode,
        workerIsolation: firstString(readString(execution, 'workerIsolation'), readString(runOutput, 'workerIsolation')),
      },
      assertions,
      lifecycle: {
        orderCount: orders.length,
        terminalOrderCount,
        partiallyExecutedOrderCount,
      },
      accounting: {
        cycleStatus,
        complete: cycleStatus === 'COMPLETED' ? true : cycleStatus === 'UNRESOLVED' ? false : null,
      },
      safety: {
        stopRecorded,
        marketPaused: firstBoolean(
          readBoolean(terminalOrder, 'marketPaused'),
          readBoolean(runtimeOutput, 'marketPaused'),
        ),
        buyAdmissionBlocked: firstBoolean(
          readBoolean(terminalOrder, 'buyAdmissionBlocked'),
          readBoolean(runtimeOutput, 'buyAdmissionBlocked'),
        ),
        sellAdmissionBlocked: firstBoolean(
          readBoolean(terminalOrder, 'sellAdmissionBlocked'),
          readBoolean(runtimeOutput, 'sellAdmissionBlocked'),
        ),
        pauseReasons,
      },
      provenance: {
        verified: provenanceVerified,
        catalogStatus: readString(catalog, 'status'),
        buildArtifactSha256,
        workerIsolation: firstString(readString(execution, 'workerIsolation'), readString(runOutput, 'workerIsolation')),
        missing: asArray(replayProvenance?.['missing']),
        traceCompleteness: readString(root, 'traceCompleteness'),
        catalogSnapshotProvenance: readString(root, 'scenarioCatalogSnapshotProvenance'),
      },
    },
  };
}
