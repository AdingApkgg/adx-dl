import { z } from "zod";
import { normalizeChartTags } from "./chart-metadata";
import { isPublicChartId } from "./chart-public-id";
const date = z.string().datetime();
// Match service validation and PostgreSQL char_length independently of UTF-16 units.
const chartText = z.string().refine((value) => [...value].length <= 120);
const publication = z
  .object({
    versionId: z.string().uuid(),
    title: chartText.refine((value) => value.length > 0),
    artist: chartText,
    description: z.string().refine(value => [...value].length <= 2000).default(""),
    credits: z.string().refine(value => [...value].length <= 1000).default(""),
    releaseNote: z.string().refine(value => [...value].length <= 1000).default(""),
    tags: z.array(z.object({ key: z.string(), label: z.string() }).strict()).max(8).refine(tags => {
      try { return JSON.stringify(normalizeChartTags(tags.map(tag => tag.label))) === JSON.stringify(tags); } catch { return false; }
    }).default([]),
    publishedAt: date,
    updatedAt: date,
  })
  .strict();
export const moderationFact = z.object({
  revision: z.number().int().min(1).max(2147483647),
  actorId: z.string().min(1).max(128),
  actorPublicId: z.string().refine(isPublicChartId),
  reason: z.string().refine(value => value.trim().length > 0 && [...value].length <= 500),
  createdAt: date,
  publication,
  author: z.object({ publicId: z.string().refine(isPublicChartId), name: z.string().min(1).max(120) }).strict().nullable(),
}).strict();
export const permissionFact = z
  .object({
    version: z.literal(1),
    chartId: z.string().uuid(),
    // Absent only in legacy facts; allocation survives missing charts and later withdrawal.
    publicId: z.string().refine(isPublicChartId).optional(),
    revision: z.number().int().min(1).max(2147483647),
    publication: publication.nullable(),
    moderation: moderationFact.optional(),
  })
  .strict();
export const retentionFact = z
  .object({
    version: z.literal(1),
    retained: z.array(permissionFact.extend({ publication })).max(50),
  })
  .strict();
export type PermissionFact = z.infer<typeof permissionFact>;
export type RetentionFact = z.infer<typeof retentionFact>;
export type ChartJournalPayload = PermissionFact | RetentionFact;
