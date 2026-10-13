import { and, eq, isNull, sql } from "drizzle-orm";
import type { StoragePurpose } from "@/shared/storage";
import { files, uploadSessions } from "../db/schema";
import type { DbTransaction } from "../storage/contracts";

export const chartUploadRule = {
  purpose: "chart-source", minSize: 1, maxSize: 67_108_864,
  quota: 268_435_456, partSize: 1_048_576,
  allowedMime: ["application/zip"], recipe: "chart-preview-v1",
  maxPixels: 16_000_000, maxDimension: 8192,
  maxOutputSize: 50_331_648, outputMime: "application/vnd.astrodx.chart-preview",
} as const;

/** Caller owns the user/usage lock. Logical originals and live reservations are separate. */
export async function usageByPurpose(tx: DbTransaction, userId: string, purpose: StoragePurpose) {
  const [used] = await tx.select({ bytes: sql<string>`coalesce(sum(${files.size}),0)` })
    .from(files).where(and(eq(files.ownerId,userId),eq(files.purpose,purpose),
      eq(files.state,"ready"),isNull(files.deletedAt)));
  const [reserved] = await tx.select({ bytes: sql<string>`coalesce(sum(${uploadSessions.reservedBytes}),0)` })
    .from(uploadSessions).where(and(eq(uploadSessions.ownerId,userId),eq(uploadSessions.purpose,purpose)));
  return { usedBytes: Number(used.bytes), reservedBytes: Number(reserved.bytes) };
}
