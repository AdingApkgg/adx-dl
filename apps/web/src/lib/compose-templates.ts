import { getDictionary, type Locale } from "@/lib/i18n";

export type ComposeKind = "survey" | "post";

const COMPOSE_KINDS: readonly ComposeKind[] = ["survey", "post"];

/** Narrows `?compose=`. Anything unrecognised is dropped rather than guessed at. */
export function parseComposeParam(value: string | null): ComposeKind | null {
  return COMPOSE_KINDS.find((kind) => kind === value) ?? null;
}

export function buildTemplate(kind: ComposeKind, locale: Locale): string {
  return getDictionary(locale).guestbook.compose.templates[kind];
}

/**
 * Where the caret belongs after the template is inserted: just past the first
 * field's colon, so the visitor starts typing an answer rather than hunting for
 * the spot. Both the ASCII `:` (en) and the fullwidth `：` (zh/ja) count, and the
 * search starts after the heading line so the heading itself can hold neither.
 */
export function firstFieldOffset(template: string): number {
  const bodyStart = template.indexOf("\n");
  if (bodyStart === -1) {
    return template.length;
  }
  const match = /[:：]/.exec(template.slice(bodyStart));
  if (!match) {
    return template.length;
  }
  return bodyStart + match.index + 1;
}
