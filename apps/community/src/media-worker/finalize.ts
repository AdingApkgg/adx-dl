import { and, eq } from "drizzle-orm";
import {
  blobBlocks,
  blobs,
  blobDerivatives,
  derivedObjects,
  files,
  storageUsage,
  uploadSessions,
} from "../server/db/schema";
import type {
  StorageContext,
  StorageJobData,
} from "../server/storage/contracts";
import { StorageError } from "../server/storage/errors";
import { withProcessingUpload } from "../server/storage/objects";
import { rejectUpload } from "../server/storage/uploads";
/** Makes the logical file ready, private and unattached; only an explicit save may publish it. */
export async function finalizeUpload(
  ctx: StorageContext,
  data: StorageJobData,
): Promise<void> {
  try {
    await withProcessingUpload(
      ctx,
      data,
      async ({ tx, session, file, accounting: { usage }, now }) => {
        if (session.expiresAt <= now)
          throw new StorageError(410, "UPLOAD_EXPIRED");
        if (session.purpose !== "avatar")
          throw new StorageError(400, "PURPOSE_NOT_AVAILABLE");
        if (
          (
            await tx
              .select()
              .from(blobBlocks)
              .where(eq(blobBlocks.sha256, session.expectedSha256))
          ).length
        )
          throw new StorageError(400, "HASH_BLOCKED");
        const [blob] = await tx
          .select()
          .from(blobs)
          .where(eq(blobs.id, file.blobId))
          .for("update");
        const [recipe] = await tx
          .select()
          .from(blobDerivatives)
          .where(
            and(
              eq(blobDerivatives.sourceBlobId, blob.id),
              eq(blobDerivatives.recipe, "avatar-v1"),
              eq(blobDerivatives.recipeBuild, ctx.config.recipeBuild),
            ),
          )
          .for("update");
        if (
          blob.state !== "ready" ||
          recipe?.state !== "ready" ||
          !recipe.derivedObjectId
        )
          throw new StorageError(503, "STORAGE_BUSY");
        const [output] = await tx
          .select()
          .from(derivedObjects)
          .where(eq(derivedObjects.id, recipe.derivedObjectId))
          .for("update");
        if (output.state !== "ready")
          throw new StorageError(503, "STORAGE_BUSY");
        if (session.reservedBytes !== file.size)
          throw new StorageError(503, "STORAGE_INCONSISTENT");
        await tx
          .update(storageUsage)
          .set({
            usedBytes: usage.usedBytes + file.size,
            reservedBytes: usage.reservedBytes - session.reservedBytes,
            activeUploads: usage.activeUploads - 1,
            updatedAt: now,
          })
          .where(eq(storageUsage.userId, session.ownerId));
        await tx
          .update(files)
          .set({
            state: "ready",
            retainedUntil: new Date(now.getTime() + 86400000),
          })
          .where(eq(files.id, file.id));
        await tx
          .update(uploadSessions)
          .set({ state: "ready", reservedBytes: 0, updatedAt: now })
          .where(eq(uploadSessions.id, session.id));
      },
    );
  } catch (error) {
    if (
      error instanceof StorageError &&
      ["UPLOAD_EXPIRED", "HASH_BLOCKED", "PURPOSE_NOT_AVAILABLE"].includes(
        error.code,
      )
    ) {
      await rejectUpload(ctx, data, error.code);
      return;
    }
    throw error;
  }
}
