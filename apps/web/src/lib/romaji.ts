/**
 * Kana → Hepburn romanisation.
 *
 * Why this exists: roughly a third of the catalog has no Latin entry point at
 * all. Titles are Japanese, `title_en` is empty upstream, and the community
 * alias lists are overwhelmingly Chinese — so an English-speaking visitor
 * typing "gekkou" or "kyuukyoku" gets an empty grid for songs the site
 * definitely has. Transliterating the kana gives those songs a searchable Latin
 * form.
 *
 * Deliberate limits:
 * - Kanji are left as-is. Reading them needs a dictionary, and a wrong reading
 *   is worse than none — the surrounding kana still produce useful substrings.
 * - Output targets *searchability*, not typographic correctness: no macrons, no
 *   apostrophes beyond the ん disambiguator, everything lower-case ASCII.
 */

/** Two-kana digraphs must be tried before single kana. */
const DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  // Extended katakana combinations, written here in their hiragana-folded form.
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", ふゅ: "fyu",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  しぇ: "she", じぇ: "je", ちぇ: "che",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  いぇ: "ye", きぇ: "kye", にぇ: "nye", ひぇ: "hye",
};

const MONOGRAPHS: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  // を is "o" in strict Hepburn, but this table feeds a search box: people type
  // it the way an IME takes it.
  わ: "wa", ゐ: "i", ゑ: "e", を: "wo",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ゔ: "vu",
  // Small kana standing alone (not consumed by a digraph above).
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

const SOKUON = "っ";
const HATSUON = "ん";
const PROLONGED = "ー";

/** Katakana → hiragana, so only one table has to exist. */
function foldToHiragana(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0)!;
    // Katakana block ァ(0x30A1)–ヶ(0x30F6) maps onto hiragana at a -0x60 offset.
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - 0x60);
      continue;
    }
    // Halfwidth katakana and the halfwidth/fullwidth forms block are left to
    // Unicode normalisation by the caller; everything else passes through.
    out += char;
  }
  return out;
}

function isKana(char: string): boolean {
  return char === SOKUON || char === HATSUON || char === PROLONGED || char in MONOGRAPHS;
}

/**
 * Transliterate the kana runs in `input`, leaving every other character
 * (kanji, Latin, punctuation) untouched.
 */
export function kanaToRomaji(input: string): string {
  if (!input) return "";
  const text = foldToHiragana(input.normalize("NFKC"));
  let out = "";
  let index = 0;

  while (index < text.length) {
    const pair = text.slice(index, index + 2);
    const char = text[index];

    if (pair.length === 2 && pair in DIGRAPHS) {
      out += DIGRAPHS[pair];
      index += 2;
      continue;
    }

    if (char === SOKUON) {
      // Gemination: repeat the first consonant of whatever follows. A trailing
      // っ (used as a glottal stop in song titles) has nothing to double.
      const nextPair = text.slice(index + 1, index + 3);
      const next = nextPair in DIGRAPHS ? DIGRAPHS[nextPair] : MONOGRAPHS[text[index + 1]];
      if (next && !"aiueo".includes(next[0])) {
        // "cch" would be wrong for ç-less Hepburn; っち is "tchi".
        out += next.startsWith("ch") ? "t" : next[0];
      }
      index += 1;
      continue;
    }

    if (char === HATSUON) {
      const following = text[index + 1] ?? "";
      const followingRomaji =
        text.slice(index + 1, index + 3) in DIGRAPHS
          ? DIGRAPHS[text.slice(index + 1, index + 3)]
          : (MONOGRAPHS[following] ?? "");
      // Hepburn inserts an apostrophe so "しんいち" is not read as "shi-ni-chi".
      const needsSeparator = /^[aiueoy]/.test(followingRomaji);
      out += needsSeparator ? "n'" : "n";
      index += 1;
      continue;
    }

    if (char === PROLONGED) {
      // Repeat the preceding vowel; a leading ー has nothing to lengthen.
      const previous = out.at(-1) ?? "";
      if ("aiueo".includes(previous)) out += previous;
      index += 1;
      continue;
    }

    if (char in MONOGRAPHS) {
      out += MONOGRAPHS[char];
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Whether a string contains at least one kana character worth transliterating. */
export function hasKana(input: string): boolean {
  const folded = foldToHiragana(input.normalize("NFKC"));
  for (const char of folded) {
    if (isKana(char)) return true;
  }
  return false;
}

/**
 * The searchable Latin form of a title, or "" when transliteration would add
 * nothing (no kana, or the result is indistinguishable from the input).
 */
export function romajiForSearch(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || !hasKana(trimmed)) return "";
  const romaji = kanaToRomaji(trimmed).trim();
  return romaji && romaji !== trimmed ? romaji : "";
}
