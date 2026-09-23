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
 * Whether a template may be written straight into the editor, or the visitor
 * has to be asked first.
 *
 * Both the direct click and the poll-until-Artalk-mounts path go through this:
 * the poll used to write unconditionally, which destroyed an unsent draft that
 * Artalk had restored while we were waiting for it.
 */
export function decideInsert(
  editorValue: string,
  template: string,
  force: boolean
): "apply" | "confirm" {
  if (force) return "apply";
  return editorValue.trim() && editorValue !== template ? "confirm" : "apply";
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
