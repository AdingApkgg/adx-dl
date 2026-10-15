import { z } from "zod";
const date = z.string().datetime();
// Match service validation and PostgreSQL char_length independently of UTF-16 units.
const chartText = z.string().refine((value) => [...value].length <= 120);
const publication = z
  .object({
    versionId: z.string().uuid(),
    title: chartText.refine((value) => value.length > 0),
    artist: chartText,
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
