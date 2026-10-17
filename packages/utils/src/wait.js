export const wait = async (ms) => {
  return new Promise((res) => setTimeout(res, ms))
}
