const createDependencyAdjacency = ({ nodes, edges }) => {
  const adjacency = new Map()
  const reverseAdjacency = new Map()

  for (const node of nodes) {
    if (adjacency.has(node)) {
      throw new Error(`Duplicate dependency graph node: ${node}`)
    }

    adjacency.set(node, [])
    reverseAdjacency.set(node, [])
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
      throw new Error(
        `Dependency edge references unknown module: ${edge.from} -> ${edge.to}`,
      )
    }

    adjacency.get(edge.from).push(edge.to)
    reverseAdjacency.get(edge.to).push(edge.from)
  }

  for (const targets of adjacency.values()) {
    targets.sort()
  }

  for (const sources of reverseAdjacency.values()) {
    sources.sort()
  }

  return {
    adjacency,
    reverseAdjacency,
  }
}

const collectFinishOrder = ({ nodes, adjacency }) => {
  const visited = new Set()
  const finishOrder = []

  for (const node of [...nodes].sort()) {
    if (visited.has(node)) {
      continue
    }

    visited.add(node)
    const pending = [[node, 0]]

    while (pending.length > 0) {
      const frame = pending[pending.length - 1]
      const [current, nextTargetIndex] = frame
      const targets = adjacency.get(current)

      if (nextTargetIndex >= targets.length) {
        finishOrder.push(current)
        pending.pop()
        continue
      }

      const target = targets[nextTargetIndex]
      frame[1] += 1

      if (visited.has(target)) {
        continue
      }

      visited.add(target)
      pending.push([target, 0])
    }
  }

  return finishOrder
}

const addUnvisitedSources = ({ sources, visited, pending }) => {
  for (const source of sources) {
    if (visited.has(source)) {
      continue
    }

    visited.add(source)
    pending.push(source)
  }
}

const collectDependencyCycles = ({ finishOrder, reverseAdjacency, adjacency }) => {
  const visited = new Set()
  const cycles = []

  for (const node of [...finishOrder].reverse()) {
    if (visited.has(node)) {
      continue
    }

    visited.add(node)
    const pending = [node]
    const component = []

    while (pending.length > 0) {
      const current = pending.pop()
      component.push(current)
      addUnvisitedSources({
        sources: reverseAdjacency.get(current),
        visited,
        pending,
      })
    }

    component.sort()
    const hasSelfDependency = (
      component.length === 1 &&
      adjacency.get(component[0]).includes(component[0])
    )

    if (component.length > 1 || hasSelfDependency) {
      cycles.push(component)
    }
  }

  const cycleKeys = cycles.map((component) => component.join("\\0")).sort()
  const cyclesByKey = new Map(
    cycles.map((component) => [component.join("\\0"), component]),
  )

  return cycleKeys.map((key) => cyclesByKey.get(key))
}

/**
 * Find strongly connected components in a module dependency graph.
 *
 * Uses iterative Kosaraju traversal to avoid recursion-depth failures on large
 * workspaces. Each multi-node strongly connected component and each self-edge
 * is returned once; acyclic nodes are omitted.
 *
 * @param {{nodes: string[], edges: Array<{from: string, to: string}>}} graph
 * @returns {string[][]} Sorted module paths for each dependency cycle.
 * @throws {Error} If nodes are duplicated or an edge references an unknown node.
 */
export function findDependencyCycles({ nodes, edges }) {
  const {
    adjacency,
    reverseAdjacency,
  } = createDependencyAdjacency({
    nodes,
    edges,
  })
  const finishOrder = collectFinishOrder({
    nodes,
    adjacency,
  })

  return collectDependencyCycles({
    finishOrder,
    reverseAdjacency,
    adjacency,
  })
}
