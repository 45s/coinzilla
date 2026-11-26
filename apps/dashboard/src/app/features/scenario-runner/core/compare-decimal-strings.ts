interface DecimalComparisonInput {
  readonly left: string;
  readonly right: string;
}

function compareBigInt({ left, right }: { left: bigint; right: bigint }) {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

export function compareDecimalStrings({ left, right }: DecimalComparisonInput): number {
  const [leftWhole, leftFraction = ""] = left.split(".")
  const [rightWhole, rightFraction = ""] = right.split(".")
  const wholeComparison = compareBigInt({
    left: BigInt(leftWhole),
    right: BigInt(rightWhole),
  })
  if (wholeComparison !== 0) {
    return wholeComparison
  }
  const precision = Math.max(leftFraction.length, rightFraction.length)
  return compareBigInt({
    left: BigInt(leftFraction.padEnd(precision, "0") || "0"),
    right: BigInt(rightFraction.padEnd(precision, "0") || "0"),
  })
}
