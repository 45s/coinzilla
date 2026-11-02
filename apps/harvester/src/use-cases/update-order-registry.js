import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { OrderRegistry } from "../domain/orders/order-registry.js"

export function updateOrderRegistry({ registry, order } = {}) {
  try {
    if (!(registry instanceof OrderRegistry)) {
      throw new TypeError("updateOrderRegistry requires an OrderRegistry")
    }
    if (!(order instanceof CanonicalOrder)) {
      throw new TypeError("updateOrderRegistry requires a canonical order")
    }
    const result = registry.applyUpdate({ order })
    return toResult({
      data: {
        registry: result.registry,
        applied: result.applied,
        duplicate: result.duplicate,
        stale: result.stale === true,
        unknown: result.unknown,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
