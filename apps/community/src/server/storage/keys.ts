const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function normalizeOriginalName(name: string): string {
  const basename = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
  // Strip Unicode control and formatting characters, then bound by code points.
  const safe = [...basename.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, 255).join("");
  return safe === "" || safe === "." || safe === ".." ? "file" : safe;
}
export function objectKey(hash: string): string {
  if (!HASH.test(hash)) throw new TypeError("Invalid SHA-256");
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}
export function temporaryKey(uploadId: string, index: number, attemptId: string): string {
  if (!UUID.test(uploadId) || !UUID.test(attemptId) || !Number.isInteger(index) || index < 0 || index > 114) {
    throw new TypeError("Invalid temporary object identity");
  }
  return `tmp/${uploadId}/${index}/${attemptId}`;
}
