import type { Note } from "@lxns-network/maimai-chart-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "@/paraglide/messages.js";
import { buildDensity, DENSITY_COLORS, type DensityKind, type PreviewRange } from "../lib/chart-preview-practice";
import { previewTime } from "../lib/chart-preview-controls";

const KINDS: DensityKind[] = ["tap", "hold", "slide", "touch", "break"];
const EMPTY_NOTES: Note[] = [];
export function PreviewTimeline({ notes = EMPTY_NOTES, duration, position, range, disabled, onSeek, onRange }: {
  notes?: readonly Note[]; duration: number; position: number; range: PreviewRange | null; disabled: boolean;
  onSeek(seconds: number): void; onRange(range: PreviewRange): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [bucketLimit, setBucketLimit] = useState(160);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) setBucketLimit(Math.max(1, Math.min(600, Math.floor(width / 3))));
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const bins = useMemo(() => buildDensity(notes, duration, bucketLimit), [notes, duration, bucketLimit]);
  const peak = useMemo(() => Math.max(1, ...bins.map(bin => bin.total)), [bins]);
  const bars = useMemo(() => bins.map((bin, index) => {
          let stack = 0;
          return KINDS.map(kind => {
            const height = bin[kind] / peak * 48;
            stack += height;
            return height ? <rect key={`${index}-${kind}`} x={index} y={50 - stack} width={0.85} height={height} fill={DENSITY_COLORS[kind]} /> : null;
          });
        }), [bins, peak]);
  const labels: Record<DensityKind, string> = {
    tap: m.chart_preview_density_tap(), hold: m.chart_preview_density_hold(), slide: m.chart_preview_density_slide(),
    touch: m.chart_preview_density_touch(), break: m.chart_preview_density_break(),
  };
  const percent = (seconds: number) => `${duration > 0 ? Math.max(0, Math.min(100, seconds / duration * 100)) : 0}%`;
  return <div ref={container} className="space-y-2">
    <p className="text-sm font-medium">{m.chart_preview_density()}</p>
    <div className="relative h-16 rounded border bg-muted/30 focus-within:outline-2 focus-within:outline-ring">
      <svg aria-hidden="true" viewBox={`0 0 ${Math.max(1, bins.length)} 50`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-1 h-12 w-full">
        {bars}
      </svg>
      {range ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/15" style={{ left: percent(range.start), width: percent(range.end - range.start) }} /> : null}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: percent(position) }} />
      <input type="range" min={0} max={duration} step={0.01} value={position} disabled={disabled || duration <= 0}
        aria-label={m.chart_seek()} aria-valuetext={`${previewTime(position)} / ${previewTime(duration)}`}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={event => onSeek(Number(event.target.value))} />
    </div>
    <div className="flex justify-between text-xs tabular-nums text-muted-foreground"><span>0:00</span><span>{previewTime(duration)}</span></div>
    <ul aria-label={m.chart_preview_density_legend()} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {KINDS.map(kind => <li key={kind} className="flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: DENSITY_COLORS[kind] }} />{labels[kind]}</li>)}
    </ul>
    {range ? <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">{m.chart_preview_range_a()} · <span className="tabular-nums">{range.start.toFixed(2)}s</span>
        <input type="range" min={0} max={Math.max(0, range.end - Math.min(0.5, duration))} step={0.01} value={range.start} disabled={disabled}
          className="block min-h-11 w-full" onChange={event => onRange({ ...range, start: Number(event.target.value) })} />
      </label>
      <label className="text-sm">{m.chart_preview_range_b()} · <span className="tabular-nums">{range.end.toFixed(2)}s</span>
        <input type="range" min={Math.min(duration, range.start + Math.min(0.5, duration))} max={duration} step={0.01} value={range.end} disabled={disabled}
          className="block min-h-11 w-full" onChange={event => onRange({ ...range, end: Number(event.target.value) })} />
      </label>
    </div> : null}
  </div>;
}
