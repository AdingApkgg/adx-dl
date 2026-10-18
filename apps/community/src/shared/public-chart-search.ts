import { normalizeChartTags } from "./chart-metadata";
import type { ChartDifficulty } from "./charts";
import { isPublicUserId } from "./user-public-id";

export type PublicChartSearchInput = { q?: string; difficulty?: string; sort?: string; author?: string; tag?: string };
export type PublicChartFilters = { q: string; difficulty?: ChartDifficulty; sort: "updated" | "published"; author?: string; tag?: string };
export const PUBLIC_CHART_SEARCH_MAX = 120;
export function parsePublicChartFilters(input: PublicChartSearchInput = {}): PublicChartFilters {
  // Bound before trim too, so padding cannot turn into an unbounded query.
  if ((input.q?.length ?? 0) > PUBLIC_CHART_SEARCH_MAX * 2) throw new RangeError("Invalid search");
  const q = (input.q ?? "").trim();
  if (Array.from(q).length > PUBLIC_CHART_SEARCH_MAX || /[\u0000-\u001f\u007f]/u.test(q)) throw new RangeError("Invalid search");
  const difficulty = input.difficulty || undefined, author = input.author || undefined, sort = input.sort || "updated";
  if (difficulty !== undefined && !/^[1-7]$/.test(difficulty)) throw new RangeError("Invalid difficulty");
  if (sort !== "updated" && sort !== "published") throw new RangeError("Invalid sort");
  if (author !== undefined && !isPublicUserId(author)) throw new RangeError("Invalid author");
  const tag = input.tag ? normalizeChartTags([input.tag])[0]?.key : undefined;
  return { q, ...(tag ? { tag } : {}), ...(difficulty ? { difficulty: Number(difficulty) as ChartDifficulty } : {}), sort, ...(author ? { author } : {}) };
}
export function publicChartFiltersFromParams(params: URLSearchParams): PublicChartFilters {
  return parsePublicChartFilters(Object.fromEntries(["q", "difficulty", "sort", "author", "tag"].map(key => [key, params.get(key) ?? undefined])));
}
export function publicChartSearchParams(filters: PublicChartFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.difficulty) params.set("difficulty", String(filters.difficulty));
  if (filters.sort !== "updated") params.set("sort", filters.sort);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.author) params.set("author", filters.author);
  return params;
}
