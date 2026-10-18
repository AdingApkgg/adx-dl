import { cn } from "@astrodx/ui/lib/utils";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { ChartDifficulty, ChartDifficultySummary, PublicChartDto } from "@/shared/charts";
import { publicListCursors } from "../lib/public-chart-navigation";
import { publicChartAssetUrl } from "../queries/public-charts";

export const PUBLIC_CHART_GRID_CLASS = "grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

// Same slot names and light/dark palette as the web main site's difficulty pills.
const difficultyStyles: Record<ChartDifficulty, { name: string; tone: string }> = {
  1: { name: "", tone: "border-border bg-muted text-muted-foreground" },
  2: { name: "BASIC", tone: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  3: { name: "ADVANCED", tone: "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  4: { name: "EXPERT", tone: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  5: { name: "MASTER", tone: "border-violet-500/45 bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  6: { name: "Re:MASTER", tone: "border-fuchsia-400/45 bg-fuchsia-400/12 text-fuchsia-700 dark:text-fuchsia-200" },
  7: { name: "宴", tone: "border-pink-500/45 bg-pink-500/15 text-pink-700 dark:text-pink-300" },
};

export function publicDifficultyName(difficulty: ChartDifficulty): string {
  return difficultyStyles[difficulty].name || m.chart_difficulty({ difficulty: String(difficulty) });
}
function PublicDifficultyPill({ row }: { row: ChartDifficultySummary }) {
  const style = difficultyStyles[row.difficulty];
  return <span className={cn("inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums", style.tone)}>
    <span>{style.name || m.chart_difficulty({ difficulty: String(row.difficulty) })}</span>
    <span className="break-all">{row.level || "—"}</span>
    {!row.previewSupported ? <span className="font-normal">· {m.chart_unsupported()}</span> : null}
  </span>;
}

export function PublicCover({ chart }: { chart: PublicChartDto }) {
  const [failed, setFailed] = useState(false);
  return <div className="relative aspect-square overflow-hidden border-b border-border/60 bg-muted">
    {chart.summary.hasCover && !failed ? <img src={publicChartAssetUrl(chart.publicId, chart.versionId, "cover")} alt="" loading="lazy" decoding="async" width={512} height={512} className="h-full w-full object-cover" onError={() => setFailed(true)} /> :
      <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">{m.chart_cover()} · {m.chart_missing()}</div>}
  </div>;
}
export function PublicChartCard({ chart, headingLevel = 2 }: { chart: PublicChartDto; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const location = useLocation();
  const href = `${location.pathname}${location.search}`;
  return <Link to={localizeHref(`/charts/${chart.publicId}`)} state={{ publicListHref: href, publicListCursors: publicListCursors(location.state?.publicChartCursors, href) }} className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <PublicCover key={`${chart.id}/${chart.versionId}`} chart={chart} />
    <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 sm:p-4">
      <Heading className="line-clamp-1 font-semibold leading-snug" title={chart.title}>{chart.title}</Heading>
      <p className="line-clamp-1 text-sm text-muted-foreground">{chart.artist || "—"}</p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{m.public_chart_author({ name: chart.author?.name ?? m.public_chart_anonymous() })}</p>
      <ul className="mt-auto flex flex-wrap gap-1.5">{chart.summary.difficulties.map(row => <li key={row.difficulty} className="max-w-full">
        <PublicDifficultyPill row={row} />
      </li>)}</ul>
    </div>
  </Link>;
}
