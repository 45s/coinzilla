const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/

function parse(value) {
  if (typeof value !== "string") throw new TypeError("Decimal values must be strings")
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) throw new TypeError(`Invalid decimal value: ${value}`)
  const fraction = match[3] ?? ""
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`)
  return { coefficient, scale: fraction.length }
}

function format(coefficient, scale) {
  const negative = coefficient < 0n
  let digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0")
  if (scale > 0) {
    const split = digits.length - scale
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`
    digits = digits.replace(/0+$/, "").replace(/\.$/, "")
  }
  return `${negative && coefficient !== 0n ? "-" : ""}${digits}`
}

function align(left, right) {
  const a = parse(left)
  const b = parse(right)
  const scale = Math.max(a.scale, b.scale)
  return {
    a: a.coefficient * 10n ** BigInt(scale - a.scale),
    b: b.coefficient * 10n ** BigInt(scale - b.scale),
    scale,
  }
}

export function compareDecimal(left, right) {
  const { a, b } = align(left, right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function addDecimal(left, right) {
  const { a, b, scale } = align(left, right)
  return format(a + b, scale)
}

export function subtractDecimal(left, right) {
  const { a, b, scale } = align(left, right)
  if (a < b) throw new RangeError("Decimal subtraction would produce a negative value")
  return format(a - b, scale)
}

export function multiplyDecimal(left, right) {
  const a = parse(left)
  const b = parse(right)
  return format(a.coefficient * b.coefficient, a.scale + b.scale)
}
