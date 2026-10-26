import { toResult } from "@coinzilla/utils"

export function validateSettings({ symbol, settings }) {
  const errors = []

  if (
    !Number.isFinite(settings?.priceStep) ||
    settings.priceStep <= 0 ||
    settings.priceStep >= 1
  ) {
    errors.push(new Error(`${symbol}: priceStep must be between 0 and 1`))
  }

  if (
    !Number.isFinite(settings?.orderQuantity) ||
    settings.orderQuantity <= 0
  ) {
    errors.push(new Error(`${symbol}: orderQuantity must be positive`))
  }

  return toResult({ errors })
}
