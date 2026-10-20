import { m } from "@/paraglide/messages.js";
import { PlayCircleIcon } from "lucide-react";
import { publicDifficultyName } from "./public-chart-card";
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

export function ChartSummary({ summary, onPreview }: { summary: ChartImportSummary; onPreview?: (difficulty: ChartDifficulty) => void }) {
  return <div className="space-y-3 text-sm">
    <dl className="grid grid-cols-2 gap-2">
      <dt>{m.chart_audio()}</dt><dd>{summary.audio ? summary.audio.mime : m.chart_silent()}</dd>
      <dt>{m.chart_cover()}</dt><dd>{summary.hasCover ? m.chart_present() : m.chart_missing()}</dd>
    </dl>
    <ul className={onPreview ? "community-difficulty-grid" : "space-y-1"}>
      {summary.difficulties.map((difficulty) => <li key={difficulty.difficulty} className={onPreview ? "community-difficulty-card" : undefined}>
        {onPreview ? <div className="community-section-heading"><span className="font-semibold">{publicDifficultyName(difficulty.difficulty)} · {difficulty.level ?? "—"}</span>{difficulty.previewSupported ? <button type="button" className="community-inline-action" aria-label={m.ui_preview_difficulty({name:publicDifficultyName(difficulty.difficulty)})} onClick={() => onPreview(difficulty.difficulty)}><PlayCircleIcon aria-hidden="true" className="size-4"/>{m.public_chart_preview_action()}</button> : <span className="community-status">{m.chart_unsupported()}</span>}</div> : null}
        {!onPreview ? <>{m.chart_difficulty({ difficulty: String(difficulty.difficulty) })} · {difficulty.level ?? "—"}</> : null}
        {difficulty.designer ? ` · ${m.chart_metadata_designer()}: ${difficulty.designer}` : ""}
        {difficulty.noteCount === null || difficulty.durationMs === null ? ` · ${m.chart_metadata_unknown()}` : ""}
        {difficulty.noteCount !== null ? ` · ${m.chart_notes({ count: String(difficulty.noteCount) })}` : ""}
        {difficulty.durationMs !== null ? ` · ${Math.ceil(difficulty.durationMs / 1000)} s` : ""}
        {!difficulty.previewSupported ? ` · ${m.chart_unsupported()}` : ""}
      </li>)}
    </ul>
    {summary.warnings.length ? <div role="status" className="rounded-md border p-3">
      <p>{m.chart_warnings()}</p>
      <ul>{summary.warnings.map((warning, index) => <li key={index}>
        {warningMessage(warning.code)}{warning.difficulty ? ` · ${m.chart_difficulty({ difficulty: String(warning.difficulty) })}` : ""}
      </li>)}</ul>
    </div> : null}
  </div>;
}
