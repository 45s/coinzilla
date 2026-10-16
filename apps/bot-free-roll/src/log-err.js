export function logErr({ where, error }) {
  console.error({
    where,
    error,
    err: JSON.stringify(error, null, 2),
  })
}
