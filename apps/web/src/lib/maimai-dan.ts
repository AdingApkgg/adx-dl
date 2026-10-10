import courses from "@/data/maimai-dan-cn-2026.json";
import { cabinetBucket, type CatalogCardEntry } from "./catalog-shared";

export type DanChart = { songId: string; slot: number };
export type DanCourse = { id: string; name: string; charts: readonly DanChart[] };

/** CN 2026 (PRiSM PLUS). Source and license: data/maimai-dan-cn-2026.md. */
export const DAN_COURSES: readonly DanCourse[] = courses;
export const DAN_COURSE_VERSION = "舞萌DX 2026";

type DanEntry = Pick<CatalogCardEntry, "short_id" | "cabinet" | "difficulties">;

function matchesDanChart(entry: DanEntry, chart: DanChart): boolean {
  const cabinet = Number(chart.songId) >= 10000 ? "DX" : "SD";
  return entry.short_id === chart.songId &&
    cabinetBucket(entry.cabinet) === cabinet &&
    entry.difficulties.some((difficulty) => difficulty.slot === chart.slot);
}

export function getEntryDanIds(entry: DanEntry): string[] {
  return DAN_COURSES
    .filter((course) => course.charts.some((chart) => matchesDanChart(entry, chart)))
    .map((course) => course.id);
}

export function parseDanIds(raw: string | null): ReadonlySet<string> {
  const known = new Set(DAN_COURSES.map((course) => course.id));
  return new Set((raw ?? "").split(",").map((id) => id.trim()).filter((id) => known.has(id)));
}

/** Keep all four positions visible even on a scoped page with missing charts. */
export function resolveDanCourse<T extends DanEntry>(course: DanCourse, entries: readonly T[]) {
  return course.charts.map((chart, index) => {
    const entry = entries.find((entry) => matchesDanChart(entry, chart)) ?? null;
    return {
      ...chart,
      order: index + 1,
      entry,
      difficulty: entry?.difficulties.find((difficulty) => difficulty.slot === chart.slot) ?? null,
    };
  });
}

/** A course keeps its official order; unrelated persisted selections stay after it. */
export function orderCatalogByDan<T extends DanEntry>(entries: readonly T[], courses: readonly DanCourse[]): T[] {
  const order = new Map<T, number>();
  for (const course of courses) {
    for (const chart of resolveDanCourse(course, entries)) {
      if (chart.entry && !order.has(chart.entry)) order.set(chart.entry, order.size);
    }
  }
  return [...entries].sort((a, b) => (order.get(a) ?? order.size) - (order.get(b) ?? order.size));
}
