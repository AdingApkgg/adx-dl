import {
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
export function DifficultyPill({ difficulty, showLabel = false, className }: DifficultyPillProps) {
  const tone = difficultyTone(difficulty);
  const level = difficulty.level?.trim() || `Lv.${difficulty.slot}`;
  const slotLabel = difficultySlotLabel(difficulty);
  const shortName = DIFFICULTY_SHORT_NAME[tone];

  return (
    <span
      title={slotLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
        DIFFICULTY_TONE_CLASS[tone],
        className
      )}
    >
      {/* Color and hover title alone don't convey which difficulty this is;
          always announce the full name (e.g. "Master 13.0"). */}
      <span className="sr-only">{`${slotLabel} `}</span>
      {showLabel && shortName ? <span aria-hidden="true">{shortName}</span> : null}
      {level}
    </span>
  );
}
