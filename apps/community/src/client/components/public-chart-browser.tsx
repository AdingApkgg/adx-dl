import { Button } from "@astrodx/ui/components/button";
import { Input } from "@astrodx/ui/components/input";
import { ArrowDownUpIcon, ListFilterIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { publicChartsApi } from "../queries/public-charts";
import { getRenderApi } from "../lib/browser";
import { m } from "@/paraglide/messages.js";
import type { PublicChartsPageDto } from "@/shared/charts";
import { PUBLIC_CHART_SEARCH_MAX, publicChartSearchParams, type PublicChartFilters } from "@/shared/public-chart-search";
import { publicListReturnState, samePublicListScope } from "../lib/public-chart-navigation";
import { PUBLIC_CHART_GRID_CLASS, PublicChartCard, publicDifficultyName } from "./public-chart-card";

export function PublicChartSearchForm({ filters, base }: { filters: PublicChartFilters; base: string }) {
  const navigate = useNavigate();
  const suggestionsId = useId();
  const [tagQuery, setTagQuery] = useState(filters.tag ?? "");
  const [suggestions, setSuggestions] = useState<{ key: string; label: string; count: number }[]>([]);
  const [tagsFailed, setTagsFailed] = useState(false);
  useEffect(() => { setTagQuery(filters.tag ?? ""); }, [filters.tag]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if ([...tagQuery].length > 20) { setSuggestions([]); return; }
      void publicChartsApi(getRenderApi()).tags(tagQuery).then(values => { if (!cancelled) { setSuggestions(values); setTagsFailed(false); } }, () => { if (!cancelled) { setSuggestions([]); setTagsFailed(true); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tagQuery]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string" && value) params.set(key, value);
    if (params.get("sort") === "updated") params.delete("sort");
    const query = params.toString();
    void navigate(base + (query ? `?${query}` : ""));
  }
  const query = publicChartSearchParams(filters).toString();
  return <form key={query} method="get" action={base} onSubmit={submit} role="search" aria-label={m.public_charts_search()} className="space-y-3 rounded-xl border bg-card/80 p-4">
    {filters.author ? <><input type="hidden" name="author" value={filters.author} /><p className="text-sm">{m.public_charts_author_filter({ id: filters.author })}</p></> : null}
    <div className="flex flex-wrap gap-2">
      <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">{m.public_charts_search()}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-3 left-3 size-5 text-muted-foreground" />
        <Input name="q" type="search" defaultValue={filters.q} maxLength={PUBLIC_CHART_SEARCH_MAX * 2} placeholder={m.public_charts_search_hint()} className="min-h-11 pl-10" />
      </label>
      <Button type="submit" className="min-h-11">{m.public_charts_search()}</Button>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">
        <span className="flex items-center gap-1"><ListFilterIcon aria-hidden="true" className="size-4" />{m.chart_difficulties()}</span>
        <select name="difficulty" defaultValue={filters.difficulty ?? ""} className="min-h-11 rounded-md border bg-background px-3">
          <option value="">{m.public_charts_all_difficulties()}</option>
          {([1,2,3,4,5,6,7] as const).map(difficulty => <option key={difficulty} value={difficulty}>{publicDifficultyName(difficulty)}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">
        <span>{m.chart_metadata_tags()}</span><Input name="tag" maxLength={40} value={tagQuery} onChange={event => setTagQuery(event.target.value)} list={suggestionsId} aria-describedby={tagsFailed ? `${suggestionsId}-error` : undefined} className="min-h-11" />
        <datalist id={suggestionsId}>{suggestions.map(tag => <option key={tag.key} value={tag.key}>{tag.label} ({tag.count})</option>)}</datalist>
        {tagsFailed ? <span id={`${suggestionsId}-error`} role="status">{m.chart_metadata_tags_unavailable()}</span> : null}
      </label>
      <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">
        <span className="flex items-center gap-1"><ArrowDownUpIcon aria-hidden="true" className="size-4" />{m.public_charts_sort()}</span>
        <select name="sort" defaultValue={filters.sort} className="min-h-11 rounded-md border bg-background px-3">
          <option value="updated">{m.public_charts_sort_updated()}</option><option value="published">{m.public_charts_sort_published()}</option>
        </select>
      </label>
      {query ? <Button asChild variant="ghost" className="min-h-11"><Link to={base}>{m.public_charts_clear()}</Link></Button> : null}
    </div>
  </form>;
}

export function PublicChartBrowser({ page, filters, base, headingLevel = 2 }: {
  page: PublicChartsPageDto; filters: PublicChartFilters; base: string; headingLevel?: 2 | 3;
}) {
  const location = useLocation();
  const current = `${location.pathname}${location.search}`;
  const origin = publicListReturnState(location.state);
  const candidates: unknown[] = Array.isArray(location.state?.publicChartCursors) ? location.state.publicChartCursors.slice(-100) : [];
  const cursors = candidates.filter(href => samePublicListScope(href, current));
  const params = publicChartSearchParams(filters);
  // An author page scopes queries server-side; its identity is already in the pathname.
  if (/\/u\//.test(base)) params.delete("author");
  const query = params.toString(), first = base + (query ? `?${query}` : "");
  const nextParams = new URLSearchParams(params);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);
  const hasCursor = new URLSearchParams(location.search).has("cursor");
  return <div className="space-y-5">
    {page.items.length ? <ul className={PUBLIC_CHART_GRID_CLASS}>{page.items.map(chart => <li key={chart.id}><PublicChartCard chart={chart} headingLevel={headingLevel} /></li>)}</ul>
      : <p role="status" className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{filters.q || filters.tag || filters.difficulty || filters.sort !== "updated" ? m.public_charts_no_results() : m.public_charts_empty()}</p>}
    <nav aria-label={m.public_charts_pagination()} className="flex flex-wrap gap-3">
      {hasCursor ? <Button asChild variant="outline" className="min-h-11"><Link to={cursors.at(-1) ?? first} state={{ ...origin, publicChartCursors: cursors.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
      {page.nextCursor ? <Button asChild variant="outline" className="min-h-11"><Link to={`${base}?${nextParams}`} state={{ ...origin, publicChartCursors: [...cursors, current] }}>{m.chart_next()}</Link></Button> : null}
    </nav>
  </div>;
}
