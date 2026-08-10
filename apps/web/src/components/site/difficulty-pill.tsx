import {
  difficultyDisplayLevel,
  DIFFICULTY_TONE_CLASS,
  difficultySlotLabel,
  difficultyTone,
  type CatalogDifficulty,
  type DifficultyTone,
} from "@/lib/catalog-shared";
import { cn } from "@/lib/utils";

type DifficultyPillProps = {
  difficulty: CatalogDifficulty;
  /** Render the visible short difficulty name next to the level (needs room). */
  showLabel?: boolean;
  /** Also show the raw catalog value (the 定数, e.g. "13.7") after the level. */
  showConstant?: boolean;
  className?: string;
};

// Compact visible forms of the official difficulty names (proper nouns shared
// across locales, so they stay out of the i18n dictionary).
const DIFFICULTY_SHORT_NAME: Record<DifficultyTone, string> = {
  basic: "BAS",
  advanced: "ADV",
  expert: "EXP",
  master: "MAS",
  remaster: "Re:MAS",
  utage: "宴",
  default: "",
};

// A level chip tinted by the maimai difficulty color (Basic→Utage).
export function DifficultyPill({
  difficulty,
  showLabel = false,
  showConstant = false,
  className,
}: DifficultyPillProps) {
  const tone = difficultyTone(difficulty);
  const raw = difficulty.level?.trim() || "";
  // The catalog stores chart constants ("13.7") and unverified markers ("13+?"),
  // but every filter in the browse UI speaks display levels ("13+") — quoting
  // the constant as the headline made the two surfaces look like different data.
  // Non-numeric levels (and UTAGE oddities) have no display form: keep the raw
  // string as-is rather than inventing one.
  const display = difficultyDisplayLevel(raw);
  const primary = display ?? raw ?? "";
  const constant = showConstant && display && raw !== display ? raw : null;
  const slotLabel = difficultySlotLabel(difficulty);
  const shortName = DIFFICULTY_SHORT_NAME[tone];

  return (
    <span
      title={raw ? `${slotLabel} ${raw}` : slotLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
        DIFFICULTY_TONE_CLASS[tone],
        className
      )}
    >
      {/* Color and hover title alone don't convey which difficulty this is;
          always announce the full name (e.g. "Master 13+"). */}
      <span className="sr-only">{`${slotLabel} `}</span>
      {showLabel && shortName ? <span aria-hidden="true">{shortName}</span> : null}
      {primary || `Lv.${difficulty.slot}`}
      {constant ? <span className="font-normal opacity-70">{constant}</span> : null}
    </span>
  );
}
