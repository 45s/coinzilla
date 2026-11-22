import { strategyMetadataById } from "./strategy-metadata.js"

export const strategyLogMarkers = Object.freeze(
  Object.fromEntries(
    Object.entries(strategyMetadataById).map(([strategyId, metadata]) => [
      strategyId,
      metadata.logMarker,
    ]),
  ),
)
