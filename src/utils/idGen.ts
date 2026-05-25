export const generateId = (prefix = ''): string => {
  const rnd = Math.random().toString(36).slice(2, 10)
  const ts = Date.now().toString(36)
  return prefix ? `${prefix}_${ts}${rnd}` : `${ts}${rnd}`
}
