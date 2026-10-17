export const capitalize = (s) =>
  s
    .trim()
    .split()
    .map((c) => c.toUpperCase())
    .join()
