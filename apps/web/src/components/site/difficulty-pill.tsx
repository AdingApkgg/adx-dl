import {
  DIFFICULTY_TONE_CLASS,
  difficultySlotLabel,
  difficultyTone,
  type CatalogDifficulty,
} from "@/lib/catalog-shared";
import { cn } from "@/lib/utils";

type DifficultyPillProps = {
  difficulty: CatalogDifficulty;
  className?: string;
};

// A level chip tinted by the maimai difficulty color (Basic→Utage).
export function DifficultyPill({ difficulty, className }: DifficultyPillProps) {
  const tone = difficultyTone(difficulty);
  const label = difficulty.level?.trim() || `Lv.${difficulty.slot}`;

  return (
    <span
      title={difficultySlotLabel(difficulty)}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
        DIFFICULTY_TONE_CLASS[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
