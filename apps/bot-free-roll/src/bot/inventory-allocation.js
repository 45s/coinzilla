import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"

// Move exactly one configured keepQuantity from active strategy inventory
// into permanently retained free inventory after a profitable recovery cycle.
// Any additional unsold quantity remains active for the next cycle.
export function allocateFreeInventory({ activeQuantity, freeQuantity, keepQuantity }) {
  const values = { activeQuantity, freeQuantity, keepQuantity }
  for (const [name, value] of Object.entries(values)) {
    assertDecimalString(value, name)
  }

  if (
    compareDecimal({ left: activeQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: freeQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: activeQuantity, right: keepQuantity }) < 0
  ) {
    throw new Error("Invalid free-inventory allocation")
  }

  return {
    allocatedQuantity: keepQuantity,
    activeQuantity: subtractDecimal({ left: activeQuantity, right: keepQuantity }),
    freeQuantity: addDecimal({ left: freeQuantity, right: keepQuantity }),
  }
}