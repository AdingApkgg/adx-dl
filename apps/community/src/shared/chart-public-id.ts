/** Canonical decimal URLs and lossless JSON for PostgreSQL bigint identity values. */
export function isPublicChartId(value: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < 19 || value <= "9223372036854775807");
}
