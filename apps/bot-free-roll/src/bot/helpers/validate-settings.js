import { toResult } from "@coinzilla/utils"

export function validateSettings({ symbol, settings }) {
  const errors = []

  if (
    !Number.isFinite(settings?.priceStepPercent) ||
    settings.priceStepPercent <= 0 ||
    settings.priceStepPercent >= 100
  ) {
    errors.push(new Error(`${symbol}: priceStepPercent must be greater than 0 and less than 100`))
  }

  if (
    !Number.isFinite(settings?.orderQuantity) ||
    settings.orderQuantity <= 0
  ) {
    errors.push(new Error(`${symbol}: orderQuantity must be positive`))
  }

  return toResult({ errors })
}
