import { createScenarioGraph } from '../domain/scenario-graph';

export function createRecoverySellerGraph() {
  return createScenarioGraph({
    id: 'rs-recovery-cycle-visual',
    title: 'Recovery Seller — recovery cycle',
    description: 'Visual-only explanation of the documented Recovery Seller lifecycle. This graph is not an executable scenario.',
    source: {
      kind: 'rs-domain-specification',
      reference: 'apps/harvester/docs/domain/recovery-seller-domain-specification.md',
    },
    limitations: [
      'Visual explanation only; this graph is not part of the executable Harvester scenario catalogue.',
      'Restart/replay and third-asset commission valuation are outside the current RS runtime acceptance scope.',
      'A terminal non-FILLED SELL or failed profitability gate leaves the cycle unresolved; no retry or replacement policy is implied.',
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Start recovery cycle', description: 'Create a stable cycleId and recovery position identity.', position: { x: 30, y: 210 }, properties: {} },
      { id: 'legacy', type: 'action', label: 'Load authorized legacy basis', description: 'Use explicit original quote investment and base quantity; do not infer ownership from wallet balances.', position: { x: 270, y: 210 }, properties: { authority: 'Explicit operator authorization' } },
      { id: 'custody', type: 'decision', label: 'Required Spot custody available?', description: 'Verify actual unreserved Spot base quantity. EARN or off-Spot quantity is not immediately sellable.', position: { x: 520, y: 210 }, properties: {} },
      { id: 'wait-spot', type: 'wait', label: 'Wait for Spot reconciliation', description: 'Insufficient custody does not authorize adopting other wallet inventory.', position: { x: 790, y: 40 }, properties: {} },
      { id: 'buy', type: 'action', label: 'Submit recovery BUY', description: 'A new BUY lifecycle may start only when the preceding BUY is terminal and reconciled.', position: { x: 790, y: 380 }, properties: {} },
      { id: 'buy-reconcile', type: 'reconciliation', label: 'Reconcile BUY fills and fees', description: 'Apply canonical fills and actual commissions exactly once.', position: { x: 1040, y: 380 }, properties: {} },
      { id: 'sell-gates', type: 'decision', label: 'All SELL gates pass?', description: 'Recovery, applicable legacy and combined-cycle profitability plus ownership, custody, reservation and exchange filters.', position: { x: 1300, y: 380 }, properties: {} },
      { id: 'blocked', type: 'block', label: 'BLOCK / STOP', description: 'Known policy limits may BLOCK without STOP. Global STOP blocks additional BUY spending only; it does not itself prohibit an independently valid first SELL.', position: { x: 1570, y: 40 }, properties: {} },
      { id: 'sell', type: 'action', label: 'Submit the sole cycle SELL', description: 'One SELL order lifecycle per recovery cycle; recovery quantity plus configured legacy sellQuantity.', position: { x: 1570, y: 520 }, properties: { invariant: 'Exactly one SELL lifecycle per cycle' } },
      { id: 'sell-reconcile', type: 'reconciliation', label: 'Reconcile complete SELL fills', description: 'Reconcile terminal order history and canonical fills before publishing accounting or releasing the reservation.', position: { x: 1830, y: 520 }, properties: {} },
      { id: 'terminal', type: 'decision', label: 'Filled, reconciled and profitable?', description: 'A cycle closes only when the sole SELL is FILLED, accounting is committed and every required profitability gate passes.', position: { x: 2090, y: 520 }, properties: {} },
      { id: 'unresolved', type: 'block', label: 'Cycle UNRESOLVED', description: 'A terminal non-FILLED outcome or failed profitability gate does not authorize another SELL or new BUY cycle.', position: { x: 2360, y: 250 }, properties: {} },
      { id: 'closed', type: 'end', label: 'Cycle CLOSED', description: 'A new cycle may follow only after this cycle is CLOSED.', position: { x: 2360, y: 620 }, properties: {} },
    ],
    edges: [
      { id: 'e-start-legacy', from: { nodeId: 'start', portId: 'next' }, to: { nodeId: 'legacy', portId: 'in' } },
      { id: 'e-legacy-custody', from: { nodeId: 'legacy', portId: 'next' }, to: { nodeId: 'custody', portId: 'in' } },
      { id: 'e-custody-no', from: { nodeId: 'custody', portId: 'no' }, to: { nodeId: 'wait-spot', portId: 'in' }, label: 'NO' },
      { id: 'e-custody-yes', from: { nodeId: 'custody', portId: 'yes' }, to: { nodeId: 'buy', portId: 'in' }, label: 'YES' },
      { id: 'e-buy-reconcile', from: { nodeId: 'buy', portId: 'next' }, to: { nodeId: 'buy-reconcile', portId: 'in' } },
      { id: 'e-reconcile-gates', from: { nodeId: 'buy-reconcile', portId: 'next' }, to: { nodeId: 'sell-gates', portId: 'in' } },
      { id: 'e-gates-no', from: { nodeId: 'sell-gates', portId: 'no' }, to: { nodeId: 'blocked', portId: 'in' }, label: 'NO' },
      { id: 'e-gates-yes', from: { nodeId: 'sell-gates', portId: 'yes' }, to: { nodeId: 'sell', portId: 'in' }, label: 'YES' },
      { id: 'e-sell-reconcile', from: { nodeId: 'sell', portId: 'next' }, to: { nodeId: 'sell-reconcile', portId: 'in' } },
      { id: 'e-terminal-check', from: { nodeId: 'sell-reconcile', portId: 'next' }, to: { nodeId: 'terminal', portId: 'in' } },
      { id: 'e-terminal-no', from: { nodeId: 'terminal', portId: 'no' }, to: { nodeId: 'unresolved', portId: 'in' }, label: 'NO' },
      { id: 'e-terminal-yes', from: { nodeId: 'terminal', portId: 'yes' }, to: { nodeId: 'closed', portId: 'in' }, label: 'YES' },
    ],
  });
}
