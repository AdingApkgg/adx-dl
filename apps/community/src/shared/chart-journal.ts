import { z } from "zod";
const date = z.string().datetime();
const publication = z
  .object({
    versionId: z.string().uuid(),
    title: z.string().min(1).max(120),
    artist: z.string().max(120),
    publishedAt: date,
    updatedAt: date,
  })
  .strict();
export const permissionFact = z
  .object({
    version: z.literal(1),
    chartId: z.string().uuid(),
    revision: z.number().int().min(1).max(2147483647),
    publication: publication.nullable(),
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
