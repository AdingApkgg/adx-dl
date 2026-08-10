/**
 * Language tagging for catalog strings.
 *
 * 936 of the catalog's titles contain kana, and the default (most-indexed) tree
 * is Chinese — so without a per-element `lang` those Japanese titles render
 * with Simplified-Chinese glyph forms for the Han characters they share, and
 * screen readers read them with a Chinese voice. The font stack in globals.css
 * keys off `:lang(ja)`, which only matches when something actually declares it.
 */

/** Hiragana, katakana (incl. halfwidth) and the prolonged sound mark. */
const KANA = /[ぁ-ゟ゠-ヿｦ-ﾝ]/;

/**
 * `"ja"` for text that is unambiguously Japanese, otherwise undefined so the
 * element simply inherits the document language.
 *
 * Kana is the only reliable signal: a Han-only string could equally be a
 * Chinese title, and mislabelling those would push Chinese titles into Japanese
 * glyph forms — the exact bug in reverse.
 */
export function japaneseTextLang(text: string | null | undefined): "ja" | undefined {
  return text && KANA.test(text) ? "ja" : undefined;
}
