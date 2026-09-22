import { CONTENT_LOCALES } from "./locales";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/** One array field inside a content file. */
export type LinkArraySpec = {
  /** The JSON key, e.g. "contactChannels". */
  key: string;
  /**
   * Whether entries in this array must carry a `description`. Exactly one
   * array in batch one does not (community's `contactChannels`), so this is a
   * flag rather than two separate entry shapes.
   */
  requireDescription: boolean;
};

const ENTRY_KEYS = ["name", "url", "description"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Error messages are addressed by path (`contactChannels[0].name.ja`) rather
 * than by prose. The dash form indexes them by that exact string to put each
 * message under the input that caused it, so the format is load-bearing —
 * changing it silently detaches every message from its field.
 */
function checkLocalized(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: 必须是对象`);
    return;
  }
  for (const locale of CONTENT_LOCALES) {
    const text = value[locale];
    if (typeof text !== "string" || text.trim() === "") {
      errors.push(`${path}.${locale}: 必须是非空字符串`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!(CONTENT_LOCALES as readonly string[]).includes(key)) {
      errors.push(`${path}.${key}: 不认识的语言键`);
    }
  }
}

function checkUrl(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path}: 必须是非空字符串`);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${path}: 不是合法的 URL`);
    return;
  }
  // Anything that is not http(s) would be rendered into an href on a public
  // page. Keeping the allowlist here rather than in the form means the server
  // enforces it too — the form can be bypassed by posting to the API directly.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    errors.push(`${path}: 只允许 http/https，拿到的是 ${parsed.protocol}`);
  }
}

function checkEntry(value: unknown, path: string, requireDescription: boolean, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: 必须是对象`);
    return;
  }
  checkLocalized(value.name, `${path}.name`, errors);
  checkUrl(value.url, `${path}.url`, errors);

  if (requireDescription) {
    checkLocalized(value.description, `${path}.description`, errors);
  } else if (value.description !== undefined) {
    errors.push(`${path}.description: 这个数组的条目不带 description`);
  }

  for (const key of Object.keys(value)) {
    if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
      errors.push(`${path}.${key}: 不认识的字段`);
    }
  }
}

/**
 * Validates a whole content file against its array specs. Every problem is
 * collected before returning — a form that fixes one error at a time, with a
 * round trip per error, is the thing this avoids.
 */
export function validateLinkListFile(data: unknown, specs: readonly LinkArraySpec[]): ValidationResult {
  if (!isRecord(data)) return { ok: false, errors: ["顶层必须是对象"] };

  const errors: string[] = [];

  for (const spec of specs) {
    const list = data[spec.key];
    if (!Array.isArray(list)) {
      errors.push(`${spec.key}: 必须是数组`);
      continue;
    }
    // An empty array renders an empty section on a public page. No edit we
    // support intends that, so it is a validation error rather than a warning.
    if (list.length === 0) {
      errors.push(`${spec.key}: 至少要有一个条目`);
      continue;
    }
    list.forEach((item, index) => {
      checkEntry(item, `${spec.key}[${index}]`, spec.requireDescription, errors);
    });
  }

  const known = new Set(specs.map((spec) => spec.key));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) errors.push(`${key}: 不认识的字段`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
