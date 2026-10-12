/** UTC calendar date as YYYY-MM-DD — shared business day for daily order numbers. */
export const businessDateUtc = (now: number = Date.now()): string =>
  new Date(now).toISOString().slice(0, 10)
