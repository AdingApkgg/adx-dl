import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { FAVORITE_LIMIT, type FavoritesPage, type FavoriteState } from "@/shared/community-social";
import { isPublicChartId } from "@/shared/chart-public-id";
import { chartFavorites } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { getPublicChart, getPublicChartsByIds } from "../charts/publication";
import { requireActiveSocialUser, socialPage, withSocialUser, type SocialPageInput } from "./social-page";
function number(id: string): bigint { if (!isPublicChartId(id)) throw new HTTPException(400); return BigInt(id); }
export async function favoriteState(ctx: StorageContext, userId: string, id: string): Promise<FavoriteState> {
  const publicId = number(id); await requireActiveSocialUser(ctx.db, userId);
  const [row] = await ctx.db.select({ id: chartFavorites.id }).from(chartFavorites).where(and(eq(chartFavorites.userId, userId), eq(chartFavorites.publicId, publicId)));
  return { favorited: Boolean(row) };
}
export async function addFavorite(ctx: StorageContext, userId: string, id: string): Promise<FavoriteState> {
  number(id);
  const chart = await getPublicChart(ctx, id);
  await withSocialUser(ctx.db, userId, async tx => {
    const [existing] = await tx.select({ id: chartFavorites.id }).from(chartFavorites).where(and(eq(chartFavorites.userId, userId), eq(chartFavorites.chartId, chart.id)));
    if (existing) return;
    const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(chartFavorites).where(eq(chartFavorites.userId, userId));
    if (count.count >= FAVORITE_LIMIT) throw new StorageError(409, "FAVORITE_LIMIT");
    await tx.insert(chartFavorites).values({ userId, chartId: chart.id, publicId: BigInt(chart.publicId) }).onConflictDoNothing();
  });
  return { favorited: true };
}
export async function removeFavorite(ctx: StorageContext, userId: string, id: string): Promise<FavoriteState> {
  const publicId = number(id);
  await withSocialUser(ctx.db, userId, async tx => { await tx.delete(chartFavorites).where(and(eq(chartFavorites.userId, userId), eq(chartFavorites.publicId, publicId))); });
  return { favorited: false };
}
export async function listFavorites(ctx: StorageContext, userId: string, input: SocialPageInput = {}): Promise<FavoritesPage> {
  await requireActiveSocialUser(ctx.db, userId);
  const page = socialPage(input, `favorites:${userId}`), t = chartFavorites;
  const rows = await ctx.db.select().from(t).where(and(eq(t.userId, userId), page.cursor ? or(lt(t.createdAt, new Date(page.cursor.at)), and(eq(t.createdAt, new Date(page.cursor.at)), lt(t.id, page.cursor.id))) : undefined))
    .orderBy(desc(t.createdAt), desc(t.id)).limit(page.limit + 1);
  const selected = rows.slice(0, page.limit), visible = new Map((await getPublicChartsByIds(ctx, selected.map(row => row.chartId))).map(chart => [chart.id, chart]));
  const last = selected.at(-1);
  return { items: selected.map(row => ({ publicId: row.publicId.toString(), addedAt: row.createdAt.toISOString(), chart: visible.get(row.chartId) ?? null })),
    nextCursor: rows.length > page.limit && last ? page.encode(last.createdAt, last.id) : null };
}
