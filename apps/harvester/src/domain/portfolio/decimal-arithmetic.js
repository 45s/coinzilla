const parseDecimal = ({ value, field }) => {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(field + " must be a decimal string")
  }
  const negative = value.startsWith("-")
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ""] = unsigned.split(".")
  return {
    coefficient: BigInt(whole + fraction) * (negative ? -1n : 1n),
    scale: fraction.length,
  }
}

const formatDecimal = ({ coefficient, scale }) => {
  const negative = coefficient < 0n
  const absolute = negative ? -coefficient : coefficient
  const digits = absolute.toString().padStart(scale + 1, "0")
  const decimal = scale === 0 ? digits : digits.slice(0, -scale) + "." + digits.slice(-scale)
  const normalized = decimal.includes(".")
    ? decimal.replace(/0+$/, "").replace(/\.$/, "")
    : decimal
  return (negative && absolute !== 0n ? "-" : "") + normalized
}

export function addDecimalStrings({ left, right } = {}) {
  const a = parseDecimal({ value: left, field: "left" })
  const b = parseDecimal({ value: right, field: "right" })
  const scale = Math.max(a.scale, b.scale)
  return formatDecimal({
    coefficient:
      a.coefficient * 10n ** BigInt(scale - a.scale) +
      b.coefficient * 10n ** BigInt(scale - b.scale),
    scale,
  })
}

export function subtractDecimalStrings({ left, right } = {}) {
  const b = parseDecimal({ value: right, field: "right" })
  return addDecimalStrings({
    left,
    right: formatDecimal({ coefficient: -b.coefficient, scale: b.scale }),
  })
}

export function negateDecimalString({ value } = {}) {
  const parsed = parseDecimal({ value, field: "value" })
  return formatDecimal({ coefficient: -parsed.coefficient, scale: parsed.scale })
}
