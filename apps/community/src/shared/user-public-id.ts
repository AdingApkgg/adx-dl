/** Public user URLs use lossless positive PostgreSQL bigint decimal strings. */
export function isPublicUserId(value: string): boolean {
  return value.length > 0 && value.length <= 19 && !/[^0-9]/.test(value) && value[0] !== "0" &&
    (value.length < 19 || value <= "9223372036854775807");
}
