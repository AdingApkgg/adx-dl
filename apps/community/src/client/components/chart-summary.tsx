import { m } from "@/paraglide/messages.js";
import { PlayCircleIcon } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { hardestDifficulties, publicDifficultyName } from "./public-chart-card";
import type { ChartDifficulty, ChartImportSummary } from "@/shared/charts";

function warningMessage(code: string): string {
  switch (code) {
    case "LEGACY_SINGLE_DIFFICULTY": return m.chart_warning_legacy();
    case "EMPTY_DIFFICULTY": return m.chart_warning_empty();
    case "PREVIEW_UNSUPPORTED":
    case "UNKNOWN_TOKEN":
    case "NOTE_OUT_OF_RANGE":
    case "MISSING_START_BPM": return m.chart_warning_unsupported();
    case "AUDIO_MISSING": return m.chart_warning_audio();
    case "ASSET_NOT_PREVIEWED": return m.chart_warning_asset();
    case "WARNINGS_TRUNCATED": return m.chart_warning_truncated();
    default: return code;
  }
}

function NoteCountBar({ count, maximum }: { count: number; maximum: number }) {
  return (
    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
      <ResponsiveContainer width="100%" height={8}>
        <BarChart
          accessibilityLayer={false}
          data={[{ count }]}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis type="number" domain={[0, maximum]} hide />
          <YAxis type="category" hide />
          <Bar dataKey="count" fill="var(--primary)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartSummary({ summary, onPreview }: { summary: ChartImportSummary; onPreview?: (difficulty: ChartDifficulty) => void }) {
  const difficulties = hardestDifficulties(summary.difficulties);
  const maximum = Math.max(0, ...difficulties.map(({ noteCount }) => noteCount ?? 0));

  return <div className="space-y-3 text-sm">
    <dl className="grid grid-cols-2 gap-2">
      <div className="min-w-0 rounded-md border border-border bg-background p-2.5">
        <dt className="text-muted-foreground">{m.chart_audio()}</dt>
        <dd className="mt-1 [overflow-wrap:anywhere]">{summary.audio ? summary.audio.mime : m.chart_silent()}</dd>
      </div>
      <div className="min-w-0 rounded-md border border-border bg-background p-2.5">
        <dt className="text-muted-foreground">{m.chart_cover()}</dt>
        <dd className="mt-1">{summary.hasCover ? m.chart_present() : m.chart_missing()}</dd>
      </div>
    </dl>
    <ul className={onPreview ? "community-difficulty-grid" : "space-y-1"}>
      {difficulties.map((difficulty) => {
        const name = publicDifficultyName(difficulty.difficulty);
        const level = difficulty.level || "—";
        const count = difficulty.noteCount;
        if (!onPreview) return (
          <li key={difficulty.difficulty}>
            {m.chart_difficulty({ difficulty: String(difficulty.difficulty) })} · {level}
            {difficulty.designer ? ` · ${m.chart_metadata_designer()}: ${difficulty.designer}` : ""}
            {count === null || difficulty.durationMs === null ? ` · ${m.chart_metadata_unknown()}` : ""}
            {count !== null ? ` · ${m.chart_notes({ count: String(count) })}` : ""}
            {difficulty.durationMs !== null ? ` · ${Math.ceil(difficulty.durationMs / 1000)} s` : ""}
            {!difficulty.previewSupported ? ` · ${m.chart_unsupported()}` : ""}
          </li>
        );
        return (
          <li key={difficulty.difficulty} data-difficulty-slot={difficulty.difficulty} className="community-difficulty-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{name}</span>
              <span className="rounded-md bg-secondary px-2 font-semibold tabular-nums">{level}</span>
            </div>
            <div className="space-y-1.5">
              {count !== null && maximum > 0 ? <NoteCountBar count={count} maximum={maximum} /> : null}
              <div className="flex flex-wrap justify-between gap-x-2 text-muted-foreground">
                <span>{count === null ? m.chart_metadata_unknown() : m.chart_notes({ count: String(count) })}</span>
                {difficulty.durationMs !== null ? <span>{Math.ceil(difficulty.durationMs / 1000)} s</span> : null}
              </div>
            </div>
            {difficulty.designer ? <p className="border-t border-border pt-2 text-muted-foreground">{m.chart_metadata_designer()}: {difficulty.designer}</p> : null}
            {difficulty.previewSupported ? (
              <button type="button" className="community-inline-action" aria-label={m.ui_preview_difficulty({name})} onClick={() => onPreview(difficulty.difficulty)}>
                <PlayCircleIcon aria-hidden="true" className="size-4" />{m.public_chart_preview_action()}
              </button>
            ) : <span className="community-status">{m.chart_unsupported()}</span>}
          </li>
        );
      })}
    </ul>
    {summary.warnings.length ? <div role="status" className="rounded-md border p-3">
      <p>{m.chart_warnings()}</p>
      <ul>{summary.warnings.map((warning, index) => <li key={index}>
        {warningMessage(warning.code)}{warning.difficulty ? ` · ${m.chart_difficulty({ difficulty: String(warning.difficulty) })}` : ""}
      </li>)}</ul>
    </div> : null}
  </div>;
}
